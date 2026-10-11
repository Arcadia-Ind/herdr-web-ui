/**
 * Shared setup and utilities for split ui-regression scripts.
 * Each script creates its own isolated session with fresh workspaces and server.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { createServer } from "../server/index.ts";
import { herdrRpc, workspaceCreate, workspaceClose } from "../server/herdr/client.ts";
import type { SessionSnapshot, WorkspaceCreated } from "../shared/protocol.ts";
import { UsageService } from "../server/usage.ts";
import { assertCspClean, watchCsp } from "./csp-violations.ts";
import type { CspWatch } from "./csp-violations.ts";
import { browserEvidencePage, browserEvidenceTracing, startBrowserEvidence } from "./browser-evidence.ts";
import type { BrowserEvidenceSession } from "./browser-evidence.ts";

/** WebKit's IME commit: an Enter keydown after compositionend, isComposing false, key code 229 */
export const IME_ENTER = { key: "Enter", code: "Enter", keyCode: 229, which: 229, bubbles: true, cancelable: true };

/** how long a send that should not happen gets to show up */
export const NO_SEND_WAIT_MS = 400;

/** Poll every 50ms until the condition is true or 15s elapses. */
export async function until(check: () => boolean | Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
    await Bun.sleep(50);
  }
}

export interface TestSession {
  root: string;
  server: ReturnType<typeof createServer>;
  origin: string;
  browser: Browser;
  workspaces: string[];
  worktreeWorkspaces: string[];
  paneA: string;
  paneB: string;
  releases: Array<() => void>;
  errors: string[];
  csp: CspWatch[];
  evidenceSessions: BrowserEvidenceSession[];
  evidenceDirectory: string | undefined;
  evidenceTrace: boolean;
}

export interface CreateSessionOptions {
  /** Prefix for the temp directory name */
  name?: string;
  /** Server token, empty string for no auth */
  token?: string;
  /** Number of initial workspaces to create (default 2) */
  workspaceCount?: 2 | 1;
  /** Label suffix for workspaces */
  labelSuffix?: string;
}

/**
 * Creates a fresh test session with browser, server, and workspaces.
 * Call this at the start of each regression script.
 */
export async function createTestSession(options: CreateSessionOptions = {}): Promise<TestSession> {
  const {
    name = "herdr-web-ui-browser",
    token = "",
    workspaceCount = 2,
    labelSuffix = "browser",
  } = options;

  const root = realpathSync(mkdtempSync(join(tmpdir(), `${name}-`)));
  const workspaces: string[] = [];
  const worktreeWorkspaces: string[] = [];
  const releases: Array<() => void> = [];
  const errors: string[] = [];
  const csp: CspWatch[] = [];
  const evidenceSessions: BrowserEvidenceSession[] = [];
  const evidenceDirectory = process.env.CHECK_BROWSER_EVIDENCE_DIR;
  const evidenceTrace = process.env.CHECK_BROWSER_EVIDENCE_TRACE === "1";

  const panes: string[] = [];
  for (let i = 0; i < workspaceCount; i++) {
    const suffix = String.fromCharCode(97 + i); // 'a', 'b', etc.
    const cwd = join(root, suffix);
    mkdirSync(cwd);
    const result = await workspaceCreate({ cwd, label: `herdr-web-ui-test-${labelSuffix}-${suffix}` });
    workspaces.push(result.workspace.workspace_id);
    panes.push(result.root_pane.pane_id);
  }

  const server = createServer({
    port: 0,
    hostname: "127.0.0.1",
    token,
    stateDir: join(root, "push"),
    usage: new UsageService(undefined, []),
  });
  const origin = `http://127.0.0.1:${server.port}`;

  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? "/opt/google/chrome/chrome",
    headless: true,
    args: ["--no-sandbox", "--accept-lang=en-US"],
  });

  return {
    root,
    server,
    origin,
    browser,
    workspaces,
    worktreeWorkspaces,
    paneA: panes[0]!,
    paneB: panes[1] ?? panes[0]!,
    releases,
    errors,
    csp,
    evidenceSessions,
    evidenceDirectory,
    evidenceTrace,
  };
}

/**
 * Creates a new page with the standard desktop viewport and language settings.
 */
export async function createDesktopPage(
  session: TestSession,
  options: { panes?: string[]; watchCsp?: boolean } = {}
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await session.browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript((panes) => {
    if (!localStorage.getItem("herdr-web-ui:settings")) {
      localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en" }));
    }
    for (const id of panes) {
      localStorage.setItem(`herdr-web-ui:view:${id}`, "chat");
    }
  }, options.panes ?? [session.paneA, session.paneB]);

  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  page.on("pageerror", (error) => session.errors.push(error.message));

  if (options.watchCsp !== false) {
    session.csp.push(await watchCsp(page));
  }

  return { context, page };
}

/**
 * Creates a mobile page context with touch support.
 */
export async function createMobilePage(
  session: TestSession,
  options: { pane?: string; storageUnavailable?: boolean } = {}
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await session.browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  if (options.storageUnavailable) {
    await context.addInitScript(() => {
      Storage.prototype.getItem = () => {
        throw new DOMException("Storage unavailable", "SecurityError");
      };
    });
  } else {
    await context.addInitScript(() => {
      if (!localStorage.getItem("herdr-web-ui:settings")) {
        localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en" }));
      }
    });
  }

  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  page.on("pageerror", (error) => session.errors.push(error.message));
  session.csp.push(await watchCsp(page));

  return { context, page };
}

/**
 * Watches browser evidence for a page in a scenario.
 */
export async function watchBrowserEvidence(
  session: TestSession,
  context: BrowserContext,
  page: Page,
  scenario: string
): Promise<BrowserEvidenceSession | undefined> {
  if (!session.evidenceDirectory) return undefined;
  const evidence = await startBrowserEvidence({
    page: browserEvidencePage(page),
    tracing: browserEvidenceTracing(context),
    directory: session.evidenceDirectory,
    script: "ui-regression",
    scenario,
    trace: session.evidenceTrace,
  });
  session.evidenceSessions.push(evidence);
  return evidence;
}

/**
 * Cleans up all resources from a test session.
 * Call this in a finally block.
 */
export async function closeTestSession(session: TestSession, repo?: string | null): Promise<void> {
  // Finish all evidence sessions
  for (const evidence of session.evidenceSessions) {
    await evidence.finish();
  }

  // Release all held resources
  for (const release of session.releases) {
    release();
  }

  // Close browser
  await session.browser?.close();

  // Stop server
  session.server?.stop();

  // Clean up worktree workspaces
  if (repo) {
    const repoRoot = realpathSync(repo);
    const { sessionSnapshot } = await import("../server/herdr/client.ts");
    const snapshot = await sessionSnapshot().catch(() => null);
    for (const workspace of snapshot?.workspaces ?? []) {
      if (
        workspace.worktree?.is_linked_worktree &&
        workspace.worktree.repo_root === repoRoot &&
        !session.worktreeWorkspaces.includes(workspace.workspace_id)
      ) {
        session.worktreeWorkspaces.push(workspace.workspace_id);
      }
    }
  }

  for (const id of session.worktreeWorkspaces) {
    await herdrRpc("worktree.remove", { workspace_id: id, force: true }).catch(() => undefined);
    await workspaceClose(id).catch(() => undefined);
  }

  // Clean up regular workspaces
  for (const id of session.workspaces) {
    await workspaceClose(id);
  }

  // Remove temp directory
  rmSync(session.root, { recursive: true, force: true });
}

/**
 * Asserts that no CSP violations occurred and no page errors happened.
 */
export function assertClean(session: TestSession, label: string): void {
  assert.equal(session.errors.length, 0, session.errors.join("\n"));
  assertCspClean(session.csp, label);
}

/**
 * Reports an agent state change for a pane.
 */
export async function reportAgent(
  paneId: string,
  state: "working" | "blocked" | "idle" | "done"
): Promise<void> {
  await herdrRpc("pane.report_agent", {
    pane_id: paneId,
    source: "manual",
    agent: "claude",
    state,
  });
}

/**
 * Creates WebSocket route hooks for tracking messages.
 */
export interface WsTracker {
  inputs: Array<{ type: "input" | "submit"; pane_id: string; text: string; delivery?: string }>;
  pendingActions: Array<{ pane_id: string; pending_id: string; action: string }>;
  inputStates: Map<string, { ready: boolean; at: number; socket: import("playwright-core").WebSocket }>;
  sockets: import("playwright-core").WebSocket[];
  painted: Set<string>;
  pendingReady: (pane: string) => Promise<void>;
}

export function createWsTracker(page: Page): WsTracker {
  const inputs: WsTracker["inputs"] = [];
  const pendingActions: WsTracker["pendingActions"] = [];
  const inputStates = new Map<string, { ready: boolean; at: number; socket: import("playwright-core").WebSocket }>();
  const sockets: import("playwright-core").WebSocket[] = [];
  const painted = new Set<string>();

  const pendingReady = (pane: string) =>
    until(() => {
      const state = inputStates.get(pane);
      return (
        state?.ready === true &&
        state.socket === sockets.at(-1) &&
        !state.socket.isClosed() &&
        Date.now() - state.at >= 500
      );
    }, `stable pending attachment of ${pane}`);

  page.on("websocket", (socket) => {
    sockets.push(socket);
    socket.on("framereceived", ({ payload }) => {
      const message = JSON.parse(String(payload));
      if (message.type === "pty-data") painted.add(message.pane_id);
      if (message.type === "input-ready") {
        inputStates.set(message.pane_id, { ready: message.ready !== false, at: Date.now(), socket });
      }
    });
    socket.on("framesent", ({ payload }) => {
      const message = JSON.parse(String(payload));
      if (message.type === "input" || message.type === "submit") inputs.push(message);
      if (message.type === "pending-action") pendingActions.push(message);
      if (message.type === "attach" || message.type === "detach") {
        inputStates.set(message.pane_id, { ready: false, at: Date.now(), socket });
      }
    });
  });

  return { inputs, pendingActions, inputStates, sockets, painted, pendingReady };
}

/**
 * Selects a pane by clicking its row and waiting for the conversation log.
 */
export async function selectPane(page: Page, paneId: string): Promise<void> {
  await page.locator(`.pane-select[title^="${paneId} —"]`).click();
  await page.getByRole("log", { name: `conversation of ${paneId}`, exact: true }).waitFor();
}
