/**
 * UI regression tests: Pending protocol, queue, session creation, worktree, tabs.
 * Part 4 of the split ui-regression suite.
 */
import "./test-herdr.ts";
import assert from "node:assert/strict";
import { copyFileSync, chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { herdrRpc, sessionSnapshot, workspaceCreate, workspaceClose } from "../server/herdr/client.ts";
import type { PaneMoved, WorkspaceCreated, WorktreeOpened } from "../shared/protocol.ts";
import { checkFolderFilter } from "./folder-filter-regression.ts";
import { openSettingsPage } from "./settings-page.ts";
import { watchCsp, assertCspClean } from "./csp-violations.ts";
import {
  createTestSession,
  closeTestSession,
  createDesktopPage,
  watchBrowserEvidence,
  until,
  createWsTracker,
  selectPane,
  reportAgent,
  IME_ENTER,
  NO_SEND_WAIT_MS,
  type TestSession,
} from "./ui-regression-shared.ts";

const session = await createTestSession({ name: "herdr-web-ui-session", labelSuffix: "session" });
const { root, origin, browser, workspaces, worktreeWorkspaces, paneA, paneB, csp, errors } = session;

let repo: string | null = null;

try {
  const { context, page } = await createDesktopPage(session, { panes: [paneA, paneB] });
  const pageEvidence = await watchBrowserEvidence(session, context, page, "session-main");
  const { inputs, pendingActions, inputStates, sockets, painted, pendingReady } = createWsTracker(page);

  const workspaceGroup = (workspaceId: string) => page.locator(`.workspace-group[data-workspace="${workspaceId}"]`);
  const workspaceHeader = (workspaceId: string) => workspaceGroup(workspaceId).locator(":scope > .workspace-header");

  // Set up WS routing for held responses
  let holdSubmitResult = false;
  let releaseSubmitResult: (() => void) | null = null;
  let holdSnapshot = false;
  let releaseSnapshot: (() => void) | null = null;
  const routed: Array<{ close: () => Promise<void> }> = [];
  await page.routeWebSocket(/\/ws(?:\?|$)/, (socket) => {
    routed.push(socket);
    const upstream = socket.connectToServer();
    upstream.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (holdSnapshot && message.type === "snapshot") {
        holdSnapshot = false;
        const release = () => { socket.send(raw); releaseSnapshot = null; };
        releaseSnapshot = release;
        session.releases.push(release);
      } else if (holdSubmitResult && message.type === "submit-result") {
        holdSubmitResult = false;
        const release = () => { socket.send(raw); releaseSubmitResult = null; };
        releaseSubmitResult = release;
        session.releases.push(release);
      } else socket.send(raw);
    });
  });

  await page.goto(`${origin}/?pane=${encodeURIComponent(paneA)}`);
  await page.locator(".conn-live").waitFor();
  await until(() => painted.has(paneA), "owned pane paint");
  const composer = page.getByRole("textbox", { name: "Message", exact: true });
  await composer.waitFor();

  // Pending protocol tests
  const pendingCwd = join(root, "pending");
  mkdirSync(pendingCwd);
  const pendingWorkspace = await workspaceCreate({ cwd: pendingCwd, label: "herdr-web-ui-test-browser-pending" });
  workspaces.push(pendingWorkspace.workspace.workspace_id);
  const pendingPane = pendingWorkspace.root_pane.pane_id;
  const pendingProgram = join(root, "claude");
  copyFileSync(process.execPath, pendingProgram);
  chmodSync(pendingProgram, 0o755);
  const pendingLog = join(root, "pending-input.jsonl");
  const pendingScreen = join(root, "pending-screen.txt");
  writeFileSync(pendingScreen, "");
  const pendingScript = join(root, "pending-agent.cjs");
  writeFileSync(pendingScript, `const fs=require("node:fs");const log=process.argv[2],screen=process.argv[3];process.stdin.setRawMode(true);process.stdin.resume();process.stdout.write("\\x1b[?2004h\\n› Message\\n",()=>fs.writeFileSync(log,""));process.stdin.on("data",c=>{if(c.includes(3))process.exit(0);fs.appendFileSync(log,JSON.stringify(c.toString("utf8"))+"\\n");});let shown="";setInterval(()=>{const next=fs.readFileSync(screen,"utf8");if(next!==shown){shown=next;process.stdout.write("\\x1b[2J\\x1b[H"+next);}},20);`);
  await herdrRpc("pane.send_text", { pane_id: pendingPane, text: `'${pendingProgram}' '${pendingScript}' '${pendingLog}' '${pendingScreen}'\n` });
  await until(() => existsSync(pendingLog), "pending byte recorder started");
  const pendingBytes = () => readFileSync(pendingLog, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as string).join("");
  const reportPending = (state: string) => herdrRpc("pane.report_agent", { pane_id: pendingPane, source: "manual", agent: "claude", state });
  await reportPending("working");
  await page.locator(`.pane-select[title^="${pendingPane} —"]`).click();
  await page.getByRole("group", { name: "Pane view", exact: true }).getByRole("button", { name: "Chat", exact: true }).click();
  await page.locator('.composer-status[data-status="working"]').waitFor();
  await until(async () => await page.locator(".composer-agent-label").innerText() === "Claude", "foreground agent identity reached the composer");
  await pendingReady(pendingPane);
  const pendingRows = page.locator(".pending-messages .pending-message");
  const queuedTexts = ["first pending browser message", "# second pending message", "# third pending message"];

  for (const [index, text] of queuedTexts.entries()) {
    await composer.fill(text);
    assert.equal(await page.getByRole("button", { name: "Stop agent", exact: true }).count(), 0, "typing replaces Stop with Send");
    assert.equal(await page.getByRole("button", { name: "Queue message", exact: true }).count(), 0, "there is no separate Queue control");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await until(async () => await pendingRows.count() === index + 1 && await composer.inputValue() === "", "server accepted pending input");
    assert.equal(inputs.at(-1)?.pane_id, pendingPane);
    assert.equal(inputs.at(-1)?.delivery, "queue");
  }
  assert.deepEqual(await pendingRows.locator(".pending-message-bubble").allTextContents(), queuedTexts);
  assert.equal(pendingBytes(), "", "accepted pending messages have not reached the pty");
  assert.equal(await page.getByRole("button", { name: "Stop agent", exact: true }).count(), 1, "empty working composer returns to Stop");
  assert.equal(await page.locator(".composer-action").count(), 1, "one primary action");

  const actionsBeforeTextClick = pendingActions.length;
  await pendingRows.locator(".pending-message-bubble").first().click();
  await page.waitForTimeout(NO_SEND_WAIT_MS);
  assert.equal(pendingActions.length, actionsBeforeTextClick, "pending message text is selectable, not a send action");
  assert.equal(pendingBytes(), "");
  await reportPending("blocked");
  await page.locator('.composer-status[data-status="blocked"]').waitFor();
  await page.waitForTimeout(NO_SEND_WAIT_MS);
  assert.equal(pendingBytes(), "", "blocked status never advances pending input");
  assert.equal(await pendingRows.count(), 3);
  await reportPending("working");
  await page.locator('.composer-status[data-status="working"]').waitFor();
  await pendingRows.first().getByRole("button", { name: /^Send now:/ }).press("Enter");
  await until(async () => await pendingRows.count() === 2 && pendingBytes().endsWith("\r"), "explicit Send now delivered one item");
  assert.equal(pendingBytes(), `\u001b[200~${queuedTexts[0]}\u001b[201~\r`);
  assert.equal(pendingActions.at(-1)?.pane_id, pendingPane);
  assert.equal(await pendingRows.first().getByRole("button", { name: /^Send now:/ }).evaluate((button) => button === document.activeElement), true, "focus handed to the next pending action");

  // Reconnect test
  const sentBeforeSnapshot = inputs.length;
  const socketsBeforeReconnect = sockets.length;
  holdSnapshot = true;
  await routed.at(-1)!.close();
  await until(() => releaseSnapshot !== null, "the reconnect's snapshot was held back");
  await until(() => sockets.length > socketsBeforeReconnect, "the page opened its new connection");
  await pendingReady(pendingPane);
  assert.equal(await page.locator('.pending-message[data-state="uncertain"]').count(), 2, "the lost connection's rows are no longer its own");
  await composer.fill("sent before the snapshot");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  assert.equal(inputs.length, sentBeforeSnapshot, "the message waits for the snapshot");
  releaseSnapshot!();
  await until(async () => await page.locator('.pending-message[data-state="queued"]').count() === 1, "the message sent before the snapshot is a live pending row");
  assert.equal(inputs.at(-1)?.delivery, "queue");
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await until(async () => await pendingRows.count() === 2, "the live row was discarded on the bridge");
  await page.reload();
  await page.locator(".conn-live").waitFor();
  await until(async () => await pendingRows.count() === 2, "saved pending copies restored");
  assert.deepEqual(await pendingRows.locator(".pending-message-bubble").allTextContents(), queuedTexts.slice(1));
  assert.equal(await page.locator('.pending-message[data-state="uncertain"]').count(), 2, "reload removes connection proof");
  await reportPending("idle");
  await page.locator('.composer-status:not([data-status="working"])').waitFor();
  await page.waitForTimeout(NO_SEND_WAIT_MS);
  for (let left = 2; left > 0; left--) {
    await page.getByRole("button", { name: "Discard saved copy", exact: true }).first().click();
    await until(async () => await pendingRows.count() === left - 1, "discard saved copy");
  }
  console.log("PASS Send queues server-owned input, explicit Send now delivers once, and reload/readiness never replay uncertain copies");

  // Legacy held rows
  await page.locator(`.pane-select[title^="${paneA} —"]`).click();
  const report = (state: string) => herdrRpc("pane.report_agent", { pane_id: paneA, source: "manual", agent: "claude", state });
  await report("working");
  await page.evaluate(({ pane, texts }: { pane: string; texts: string[] }) => {
    localStorage.setItem(`herdr-web-ui:queue:${pane}`, JSON.stringify({ version: 1, messages: texts.map((text, index) => ({ id: `legacy-browser-${index}`, text })) }));
  }, { pane: paneA, texts: ["printf 'browser-queue-ok\\n'", "# second queued message", "# third queued message"] });
  await page.reload();
  await page.locator(".conn-live").waitFor();
  await until(async () => await page.locator(".composer-queue-text").count() === 3, "legacy held rows restored");
  assert.equal(await composer.inputValue(), "");
  assert.equal(await page.getByRole("button", { name: "Stop agent", exact: true }).count(), 1);

  // Chat width settings
  const chatWidth = async (name: string): Promise<void> => {
    await page.keyboard.press("ControlOrMeta+Shift+Comma");
    await openSettingsPage(page, "Chat");
    await page.getByRole("group", { name: "Chat width", exact: true }).getByRole("button", { name, exact: true }).click();
    await page.getByRole("button", { name: "Close settings", exact: true }).click();
  };
  const laneColumn = async (): Promise<{ x: number; width: number; pane: number }> => {
    const pane = await page.locator(".terminal-stack.is-chat").boundingBox();
    const card = await page.locator(".composer-surface").boundingBox();
    assert.ok(pane && card);
    return { x: Math.round(card.x), width: Math.round(card.width), pane: Math.round(pane.width) };
  };
  const floor = await laneColumn();
  assert.equal(floor.width, 820);
  await chatWidth("Narrow");
  assert.deepEqual(await laneColumn(), floor);
  await chatWidth("Wide");
  const gutters = await laneColumn();
  assert.equal(gutters.width, gutters.pane - 32, "the wide lane is wider than this pane");
  await chatWidth("Default");
  assert.deepEqual(await laneColumn(), floor);

  // Queue tests
  await page.locator(".composer-queue-text").nth(1).fill("# edited second message");
  await page.reload();
  await page.locator(".conn-live").waitFor();
  await until(async () => await page.locator(".composer-queue-text").count() === 3, "queue restored");
  assert.equal(await page.locator(".composer-queue-text").nth(1).inputValue(), "# edited second message");
  const lens = page.getByRole("group", { name: "Pane view", exact: true });
  await lens.getByRole("button", { name: "Terminal", exact: true }).click();
  await until(async () => await page.locator(".composer-queue").count() === 0, "queue hidden in terminal lens");
  await lens.getByRole("button", { name: "Chat", exact: true }).click();
  await until(async () => await page.locator(".composer-queue-text").count() === 3, "queue back in chat lens");
  await page.getByRole("button", { name: "Discard", exact: true }).nth(2).click();
  const inputCount = inputs.length;
  await report("blocked");
  await page.locator('.composer-status[data-status="blocked"]').waitFor();
  await Bun.sleep(300);
  assert.equal(inputs.length, inputCount, "approval state must hold the queue");
  await report("idle");
  await Bun.sleep(300);
  assert.equal(inputs.length, inputCount, "a status change must not dispatch held input");
  await page.getByRole("button", { name: "Send now", exact: true }).first().click();
  await until(() => inputs.length > inputCount, "explicit queue send");
  assert.equal(inputs.at(-1)?.pane_id, paneA);
  await until(async () => await page.locator(".composer-queue-text").count() === 1, "only sent item removed");
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await page.locator(".composer-queue-text").waitFor({ state: "hidden" });
  console.log("PASS queue held through status changes and explicitly sent to its owner");

  // Quick replies
  const quickRow = async (show: boolean): Promise<void> => {
    await page.keyboard.press("ControlOrMeta+Shift+Comma");
    await openSettingsPage(page, "Chat");
    const toggle = page.getByRole("switch", { name: "Show above the message box", exact: true });
    if ((await toggle.getAttribute("aria-checked")) !== String(show)) await toggle.click();
    await page.getByRole("button", { name: "Close settings", exact: true }).click();
  };
  assert.equal(await page.locator(".composer-quick").count(), 0);
  await quickRow(true);
  await composer.fill("draft stays");
  const quickCount = inputs.length;
  await page.getByRole("group", { name: "Quick replies", exact: true }).getByRole("button", { name: "continue", exact: true }).click();
  await until(() => inputs.length > quickCount, "quick reply send");
  assert.equal(inputs.at(-1)?.pane_id, paneA);
  assert.match(inputs.at(-1)!.text, /^continue/);
  assert.equal(await composer.inputValue(), "draft stays");
  await quickRow(false);
  await composer.fill("");
  console.log("PASS quick replies send as typed, queue mid-turn, and leave the draft");

  // Composer IME
  await composer.fill("한글 조합");
  const imeInputs = inputs.length;
  await composer.dispatchEvent("keydown", IME_ENTER);
  await page.waitForTimeout(NO_SEND_WAIT_MS);
  assert.equal(inputs.length, imeInputs);
  assert.equal(await composer.inputValue(), "한글 조합");
  await composer.fill("");
  console.log("PASS the composer keeps an IME's committing Enter");

  // Drafts stay with panes
  await composer.fill("draft for A");
  await selectPane(page, paneB);
  assert.equal(await composer.inputValue(), "");
  await composer.fill("draft for B");
  await selectPane(page, paneA);
  assert.equal(await composer.inputValue(), "draft for A");
  console.log("PASS drafts stay with their panes");

  // Successful send acknowledgement
  for (const returnBeforeAck of [false, true]) {
    await composer.fill("# confirmed draft");
    holdSubmitResult = true;
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await until(() => releaseSubmitResult !== null, "held submit acknowledgement");
    await selectPane(page, paneB);
    assert.equal(await composer.inputValue(), "draft for B");
    if (returnBeforeAck) {
      await selectPane(page, paneA);
      assert.equal(await page.getByRole("button", { name: "Send message", exact: true }).isDisabled(), true);
      await composer.fill("# confirmed draft plus unsent text");
    }
    releaseSubmitResult!();
    if (!returnBeforeAck) await selectPane(page, paneA);
    await until(async () => await composer.inputValue() === (returnBeforeAck ? " plus unsent text" : ""), "only acknowledged text leaves the draft");
  }
  await composer.fill("draft for A");
  console.log("PASS successful sends settle after switching panes and preserve edits made after returning");

  // Upload batch test
  let releaseImage!: () => void;
  const imageGate = new Promise<void>((resolve) => { releaseImage = resolve; });
  session.releases.push(releaseImage);
  const uploads: string[] = [];
  await page.route("**/api/pane/image", async (route) => {
    uploads.push(route.request().postDataJSON().pane_id);
    await imageGate;
    await route.continue();
  });
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1kAAAAASUVORK5CYII=", "base64");
  await page.locator('input[type="file"]').setInputFiles([
    { name: "first.png", mimeType: "image/png", buffer: png },
    { name: "second.png", mimeType: "image/png", buffer: png },
  ]);
  await until(() => uploads.length === 1, "first upload started");
  await selectPane(page, paneB);
  const imageResponse = page.waitForResponse((response) => response.url().endsWith("/api/pane/image"));
  releaseImage();
  assert.equal((await imageResponse).status(), 200);
  await Bun.sleep(300);
  assert.deepEqual(uploads, [paneA], "leaving a pane cancels remaining uploads");
  assert.equal(await composer.inputValue(), "draft for B");
  console.log("PASS upload batch cannot cross panes");

  // Session creation
  let releaseCreate!: () => void;
  const createGate = new Promise<void>((resolve) => { releaseCreate = resolve; });
  session.releases.push(releaseCreate);
  let createRequests = 0;
  await page.route("**/api/workspace/create", async (route) => {
    createRequests += 1;
    await createGate;
    await route.continue();
  });
  await page.getByRole("button", { name: /^New workspace on / }).click();
  const dialog = page.getByRole("dialog", { name: /^New workspace/ });
  await dialog.getByLabel(/^Directory/).fill(root);
  await checkFolderFilter(page, dialog, () => createRequests);
  await dialog.getByLabel(/^Name/).fill("herdr-web-ui-test-browser-created");
  await dialog.getByRole("button", { name: "Start", exact: true }).click();
  await until(() => createRequests === 1, "creation started");
  await page.keyboard.press("Escape");
  assert.equal(await dialog.isVisible(), true, "in-flight creation cannot be dismissed");
  const createdResponse = page.waitForResponse((response) => response.url().endsWith("/api/workspace/create"));
  releaseCreate();
  const created = await (await createdResponse).json() as WorkspaceCreated;
  workspaces.push(created.workspace_id);
  await dialog.waitFor({ state: "hidden" });
  await until(async () => (await page.locator(`.pane-select[title^="${created.pane_id} —"]`).getAttribute("aria-current")) === "true", "created pane selected");
  assert.equal(createRequests, 1);
  console.log("PASS session creation stays pending and opens one owned workspace");

  // Git worktree tests
  repo = join(root, `herdr-web-ui-test-repo-${process.pid.toString(36)}`);
  mkdirSync(repo);
  const git = (...args: string[]) => Bun.spawnSync(["git", "-c", "user.name=herdr-web-ui test", "-c", "user.email=test@example.invalid", ...args], { cwd: repo ?? undefined, stdout: "pipe", stderr: "pipe" });
  assert.equal(git("init", "-q", "-b", "main").exitCode, 0, "git init");
  writeFileSync(join(repo, "README.md"), "worktree fixture\n");
  assert.equal(git("add", "README.md").exitCode, 0);
  assert.equal(git("commit", "-q", "-m", "fixture").exitCode, 0, "git commit");
  const repoWorkspace = await workspaceCreate({ cwd: repo, label: "herdr-web-ui-test-repo" });
  workspaces.push(repoWorkspace.workspace.workspace_id);
  const repoRow = workspaceHeader(repoWorkspace.workspace.workspace_id);
  await repoRow.waitFor();

  const initialResponse = await fetch(`${origin}/api/worktree/create`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspace_id: repoWorkspace.workspace.workspace_id, branch: "browser/initial", label: "Existing checkout" }),
  });
  assert.equal(initialResponse.status, 200, "an existing branch fixture is created");
  const initialWorktree = await initialResponse.json() as WorktreeOpened;
  worktreeWorkspaces.push(initialWorktree.workspace_id);
  const initialRow = page.locator(`.worktree-children .workspace-group[data-workspace="${initialWorktree.workspace_id}"]`);
  await until(async () => await initialRow.locator(".workspace-name").textContent() === "Existing checkout", "worktree row titled");
  await initialRow.locator(".worktree-workspace-label").waitFor();
  assert.equal(await initialRow.locator(".worktree-workspace-label").textContent(), "browser/initial");

  // New worktree from menu
  await repoRow.locator(".workspace-select").click();
  await repoRow.locator(".workspace-toggle").click();
  await initialRow.waitFor({ state: "detached" });
  await repoRow.hover();
  await repoRow.locator(".row-menu-toggle").click();
  const repoMenu = page.getByRole("menu");
  await repoMenu.waitFor();
  await page.getByRole("menuitem", { name: "New worktree", exact: true }).click();
  const newWorktree = page.getByRole("dialog", { name: /^New worktree/ });
  await newWorktree.waitFor();
  await newWorktree.getByLabel(/^Branch/).fill("browser/sidebar");
  await newWorktree.getByLabel(/^Name/).fill("Sidebar redesign");
  const worktreeResponse = page.waitForResponse((response) => response.url().endsWith("/api/worktree/create"));
  await newWorktree.getByRole("button", { name: "Create worktree", exact: true }).click();
  const worktree = await (await worktreeResponse).json() as WorktreeOpened;
  worktreeWorkspaces.push(worktree.workspace_id);
  await newWorktree.waitFor({ state: "detached" });
  const childRow = page.locator(`.worktree-children .workspace-group[data-workspace="${worktree.workspace_id}"]`);
  const childHeader = childRow.locator(":scope > .workspace-header");
  await until(async () => await childHeader.locator(".workspace-name").textContent() === "Sidebar redesign", "worktree created");
  assert.equal(await childHeader.locator(".worktree-workspace-label").textContent(), "browser/sidebar");

  // Remove initial worktree
  const removeInitial = await fetch(`${origin}/api/worktree/remove`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspace_id: initialWorktree.workspace_id }),
  });
  assert.equal(removeInitial.status, 200);
  await initialRow.waitFor({ state: "detached" });
  worktreeWorkspaces.splice(worktreeWorkspaces.indexOf(initialWorktree.workspace_id), 1);
  console.log("PASS existing and new branches sit under their workspace; creation expands the group and workspace renames preserve the branch");

  // Delete worktree with dirty file
  writeFileSync(join(worktree.path, "unsaved.txt"), "dirty\n");
  await childHeader.hover();
  await childHeader.locator(".row-menu-toggle").click();
  const childMenu = page.getByRole("menu");
  await childMenu.waitFor();
  await childMenu.getByRole("menuitem", { name: "Delete worktree checkout…", exact: true }).click();
  const deleteConfirm = page.getByRole("alertdialog");
  await deleteConfirm.waitFor();
  await deleteConfirm.getByRole("button", { name: "Delete", exact: true }).click();
  await deleteConfirm.getByRole("button", { name: "Delete anyway", exact: true }).waitFor();
  assert.equal(await deleteConfirm.locator(".confirm-error").count(), 1, "git's refusal shows");
  await deleteConfirm.getByRole("button", { name: "Delete anyway", exact: true }).click();
  await deleteConfirm.waitFor({ state: "detached" });
  await childRow.waitFor({ state: "detached" });
  assert.equal(existsSync(worktree.path), false, "the checkout is gone");
  worktreeWorkspaces.splice(worktreeWorkspaces.indexOf(worktree.workspace_id), 1);
  console.log("PASS a worktree row sits under its repository's row, and its menu deletes the checkout, asking twice for a dirty one");

  // Tab strip tests
  await until(() => painted.has(created.pane_id), "created pane paint");
  await page.locator(`.pane-select[title^="${created.pane_id} —"]`).click();
  await until(async () => (await page.locator(`.pane-select[title^="${created.pane_id} —"]`).getAttribute("aria-current")) === "true", "the created workspace is selected again");
  await page.locator(".tab-strip-add").click();
  const tabDialog = page.getByRole("dialog", { name: /^New tab · herdr-web-ui-test-browser-created/ });
  await tabDialog.waitFor();
  assert.equal(await tabDialog.locator(".new-session-folder").textContent(), root, "the folder is the workspace's");
  const tabNameField = tabDialog.getByLabel(/^Name/);
  await tabNameField.fill("second");
  const tabResponse = page.waitForResponse((response) => response.url().endsWith("/api/tab/create"));
  await tabDialog.getByRole("button", { name: "Start", exact: true }).click();
  const createdTab = await (await tabResponse).json() as WorkspaceCreated;
  assert.equal(createdTab.workspace_id, created.workspace_id, "the tab joins the workspace");
  await tabDialog.waitFor({ state: "hidden" });
  const strip = page.locator(".tab-strip");
  await strip.waitFor();
  assert.deepEqual(await strip.getByRole("tab").allTextContents(), ["Tab 1", "second"]);
  console.log("PASS a second tab is made from the tab strip, listed over the pane, and opened from it");

  // Tab rename and close
  const tabsInHerdr = async () => (await sessionSnapshot()).tabs.filter((tab) => tab.workspace_id === created.workspace_id).map((tab) => tab.label);
  await strip.getByRole("tab", { name: "Tab 1", exact: true }).dblclick();
  const tabName = strip.getByLabel("Tab name", { exact: true });
  await tabName.waitFor();
  await tabName.fill("  first  ");
  await page.keyboard.press("Enter");
  await until(async () => (await tabsInHerdr()).join() === "first,second", "herdr has the tab's new name");
  assert.deepEqual(await strip.getByRole("tab").allTextContents(), ["first", "second"]);

  // Close tab from menu
  await strip.getByRole("tab", { name: "second", exact: true }).click({ button: "right" });
  const tabMenu = page.getByRole("menu", { name: "second", exact: true });
  await tabMenu.waitFor();
  await tabMenu.getByRole("menuitem", { name: "Close tab", exact: true }).click();
  await until(async () => (await tabsInHerdr()).join() === "first", "the menu closed the tab");
  console.log("PASS a tab is renamed by a double-click, F2 and its menu, and closed from its menu and Delete, asking first while its agent works");

  // Move pane test
  const mover = await herdrRpc<{ root_pane: { pane_id: string } }>("tab.create", { workspace_id: created.workspace_id, label: "mover", focus: false });
  const moverId = mover.root_pane.pane_id;
  await strip.getByRole("tab", { name: "mover", exact: true }).click();
  await until(async () => (await page.locator(`.pane-select[title^="${moverId} —"]`).getAttribute("aria-current")) === "true", "the mover tab's pane is open");

  const absenceConfirmed = page.waitForResponse(async (response) => {
    if (response.request().method() !== "GET" || !/\/api\/session(?:\?|$)/.test(response.url())) return false;
    try { return !(await response.text()).includes(`"${moverId}"`); } catch { return false; }
  });
  let lateAnswer: PaneMoved | null = null;
  await page.route("**/api/pane/move", async (route) => {
    const answer = await route.fetch();
    lateAnswer = await answer.json() as PaneMoved;
    await absenceConfirmed;
    await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => setTimeout(done, 0))));
    await route.fulfill({ response: answer, body: JSON.stringify(lateAnswer) });
  });
  const { runMoreItem } = await import("./header-more.ts");
  await runMoreItem(page, "Move pane to…");
  const moveMenu = page.getByRole("menu", { name: /^Move .+ to$/ });
  await moveMenu.waitFor();
  await moveMenu.getByRole("menuitem", { name: "herdr-web-ui-test-session-b", exact: true }).click();
  await until(() => lateAnswer !== null, "herdr answered the move");
  const movedId = lateAnswer!.pane.pane_id;
  assert.notEqual(movedId, moverId, "a pane that changes workspace gets a new id");
  await until(async () => (await page.locator(`.pane-select[title^="${movedId} —"]`).getAttribute("aria-current")) === "true", "the app follows the moved pane");
  await page.unroute("**/api/pane/move");
  await herdrRpc("tab.close", { tab_id: lateAnswer!.created_tab!.tab_id });
  console.log("PASS a pane moved into another workspace is followed under its new id, also when the roster outruns the answer");

  // Server-owned Send now drops the old suggestion itself, before a delayed prompt read returns.
  await selectPane(page, pendingPane);
  await reportPending("working");
  await page.locator('.composer-status[data-status="working"]').waitFor();
  await pendingReady(pendingPane);
  await composer.fill("# queued before the suggestion");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await until(async () => await pendingRows.count() === 1, "suggestion test pending input accepted");
  await selectPane(page, paneA); await selectPane(page, pendingPane);
  await page.locator('.pending-message[data-state="held"]').waitFor();
  await pendingReady(pendingPane);
  await reportPending("idle");
  await page.locator('.composer-status:not([data-status="working"])').waitFor();
  const rule = "─".repeat(40);
  writeFileSync(pendingScreen, `${rule}\r\n❯ \u001b[2mcheck the diff\u001b[0m\r\n${rule}\r\n`);
  await until(async () => await composer.getAttribute("placeholder") === "check the diff", "suggestion beside a pending message");
  await page.route(`**/api/pane/prompt?pane_id=${encodeURIComponent(pendingPane)}`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    await route.continue().catch(() => {});
  });
  const sentAt = Date.now();
  await pendingRows.getByRole("button", { name: /^Send now:/ }).click();
  await until(async () => await composer.getAttribute("placeholder") !== "check the diff", "Send now drops the suggestion");
  assert.ok(Date.now() - sentAt < 2500, "the suggestion goes with the Send now, not with a later read");
  await pendingRows.waitFor({ state: "hidden" });
  await page.unroute(`**/api/pane/prompt?pane_id=${encodeURIComponent(pendingPane)}`);
  console.log("PASS Send now on a server-owned pending message drops Claude's suggestion");

  // Cleanup pending workspace
  await herdrRpc("pane.send_text", { pane_id: pendingPane, text: "\u0003" });
  await workspaceClose(pendingWorkspace.workspace.workspace_id);
  workspaces.splice(workspaces.indexOf(pendingWorkspace.workspace.workspace_id), 1);
  await selectPane(page, paneA);

  assert.equal(errors.length, 0, errors.join("\n"));
  assertCspClean(session.csp, "session tests");
  if (pageEvidence) await pageEvidence.finish();
  await page.close();
  await context.close();
} catch (error) {
  for (const evidence of session.evidenceSessions) {
    if (evidence.isOpen()) await evidence.captureFailure(error);
  }
  throw error;
} finally {
  // Clean up worktree directory
  if (repo) {
    try { rmdirSync(join(homedir(), ".herdr", "worktrees", basename(repo))); } catch { /* not there */ }
  }
  await closeTestSession(session, repo);
}
