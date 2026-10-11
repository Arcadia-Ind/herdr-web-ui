/**
 * UI regression tests: Palette navigation, IME handling, agent status, and sidebar agents.
 * Part 1 of the split ui-regression suite.
 */
import "./test-herdr.ts";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { BrowserContext, Page } from "playwright-core";
import { herdrRpc, sessionSnapshot } from "../server/herdr/client.ts";
import type { Machine } from "../shared/machines.ts";
import { checkPaletteKeys } from "./palette-keys-regression.ts";
import {
  createTestSession,
  closeTestSession,
  createDesktopPage,
  watchBrowserEvidence,
  until,
  assertClean,
  createWsTracker,
  type TestSession,
} from "./ui-regression-shared.ts";

const session = await createTestSession({ name: "herdr-web-ui-palette", labelSuffix: "palette" });
const { root, origin, browser, workspaces, paneA, paneB, csp, errors } = session;

try {
  const { context, page } = await createDesktopPage(session, { panes: [paneA, paneB] });
  const pageEvidence = await watchBrowserEvidence(session, context, page, "palette-main");
  const { painted } = createWsTracker(page);

  const workspaceGroup = (workspaceId: string) => page.locator(`.workspace-group[data-workspace="${workspaceId}"]`);
  const workspaceHeader = (workspaceId: string) => workspaceGroup(workspaceId).locator(":scope > .workspace-header");
  const agentRow = (paneId: string) => page.locator(`.agents-sidebar .agent-item[data-machine="local"][data-pane="${paneId}"]`);

  await page.goto(`${origin}/?pane=${encodeURIComponent(paneA)}`);
  await page.locator(".conn-live").waitFor();
  await until(() => painted.has(paneA), "owned pane paint");
  const composer = page.getByRole("textbox", { name: "Message", exact: true });
  await composer.waitFor();
  await page.locator(".composer .voice-mic").waitFor();
  console.log("PASS a desktop's chat offers the mic before Settings is asked");

  assert.equal(await workspaceHeader(workspaces[0]!).locator(".workspace-name").textContent(), "herdr-web-ui-test-palette-a",
    "Spaces names the workspace rather than its current pane");
  assert.equal(await workspaceGroup(workspaces[0]!).locator(".pane-select").count(), 1, "a workspace has one representative selector");
  assert.equal(await page.locator(".workspace-contents, .sidebar-tab-heading, .sidebar-pane-item").count(), 0,
    "Spaces has no tab or pane tree");
  assert.equal(await agentRow(paneA).count(), 0, "a plain shell is absent from Agents");
  assert.equal(await agentRow(paneB).count(), 0, "another plain shell is absent from Agents");

  // The search owns arrow/Enter navigation. Tab still reaches real buttons.
  const palette = page.getByRole("dialog", { name: "Command palette", exact: true });
  const paletteSearch = palette.getByRole("searchbox", { name: "Search panes and actions", exact: true });
  const selectedPane = () => page.evaluate(() => JSON.parse(sessionStorage.getItem("herdr-web-ui:selection") ?? "null")?.pane_id as string | undefined);

  const openPalette = async (): Promise<void> => {
    await page.keyboard.press("ControlOrMeta+Shift+k");
    await palette.waitFor();
    await until(async () => await paletteSearch.evaluate((input) => document.activeElement === input), "palette search takes focus");
  };

  await openPalette();
  await paletteSearch.fill("herdr-web-ui-test-palette-b");
  await until(async () => await palette.locator(".palette-pane").count() === 1, "the other pane is the palette's only result");
  await page.keyboard.press("Tab");
  assert.equal(await palette.getByRole("button", { name: "Close command palette", exact: true }).evaluate((button) => document.activeElement === button), true,
    "Tab reaches the close button from search");
  await page.keyboard.press("Enter");
  await palette.waitFor({ state: "hidden" });
  assert.equal(await selectedPane(), paneA, "Enter on Close leaves the pane selection alone");

  // A reopened palette starts from an empty search
  await page.evaluate(() => {
    const frames: string[] = [];
    (window as unknown as { paletteFirstFrame: string[] }).paletteFirstFrame = frames;
    new MutationObserver((_, observer) => {
      const search = document.querySelector<HTMLInputElement>(".command-palette input[type=search]");
      if (!search) return;
      frames.push(search.value);
      observer.disconnect();
    }).observe(document.body, { childList: true, subtree: true });
  });
  await openPalette();
  assert.deepEqual(await page.evaluate(() => (window as unknown as { paletteFirstFrame: string[] }).paletteFirstFrame), [""],
    "a reopened palette's first render shows none of the last search's results");

  const otherPalettePane = palette.locator(`.palette-section[data-section="${workspaces[1]}"] .palette-pane`);
  for (const deadline = Date.now() + 5_000; ;) {
    await page.keyboard.press("Tab");
    if (await otherPalettePane.evaluate((button) => document.activeElement === button)) break;
    assert.ok(Date.now() < deadline, "Tab reaches the other pane's option");
  }
  await until(async () => await otherPalettePane.evaluate((button) =>
    document.activeElement === button && button.getAttribute("aria-selected") === "true"), "the focused option is highlighted");
  await page.keyboard.press("Enter");
  await palette.waitFor({ state: "hidden" });
  await until(async () => await selectedPane() === paneB, "Enter on the focused option selects that pane");
  await page.locator(`.pane-select[title^="${paneA} —"]`).click();
  await until(async () => await selectedPane() === paneA, "return to the first pane after palette selection");

  // IME keys in palette
  await openPalette();
  await paletteSearch.fill("herdr-web-ui-test-palette-b");
  await until(async () => await palette.locator(".palette-pane").count() === 1, "IME check has a matching result");
  const paletteComposition = await paletteSearch.evaluate((input) => [
    { key: "Enter", isComposing: true },
    { key: "Enter", keyCode: 229 },
    { key: "ArrowUp", isComposing: true },
    { key: "ArrowDown", isComposing: true },
    { key: "Escape", isComposing: true },
    { key: "Escape", keyCode: 229 },
  ].map((init) => input.dispatchEvent(new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true }))));
  assert.deepEqual(paletteComposition, [true, true, true, true, true, true], "IME keys keep their default action");
  assert.equal(await palette.isVisible(), true, "IME Enter and Escape leave the palette open");
  assert.equal(await selectedPane(), paneA, "IME Enter never activates its matching pane");
  await paletteSearch.press("Escape");
  await palette.waitFor({ state: "hidden" });

  // Short palette overflow navigation
  const paletteViewport = page.viewportSize()!;
  for (const viewport of [{ width: 1280, height: 400 }, { width: 390, height: 600 }]) {
    await page.setViewportSize(viewport);
    await openPalette();
    await page.mouse.move(0, 0);
    assert.equal(await palette.locator(".palette-results").evaluate((list) => list.scrollHeight > list.clientHeight), true,
      "the short palette has a scrollable list");
    const optionCount = await palette.getByRole("option").count();
    const visibleActiveOption = () => palette.locator(".palette-results").evaluate((list) => {
      const option = list.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!option) return false;
      const row = option.getBoundingClientRect();
      const bounds = list.getBoundingClientRect();
      return row.top >= bounds.top - 1 && row.bottom <= bounds.bottom + 1;
    });
    await paletteSearch.press("ArrowUp");
    await until(async () => await paletteSearch.getAttribute("aria-activedescendant") === `palette-item-${optionCount - 1}` && await visibleActiveOption(),
      "ArrowUp wraps to the last visible palette option");
    if (process.env.UI_EVIDENCE_DIR) {
      mkdirSync(process.env.UI_EVIDENCE_DIR, { recursive: true });
      await page.screenshot({ path: join(process.env.UI_EVIDENCE_DIR, `palette-arrow-${viewport.width <= 640 ? "mobile" : "desktop"}.png`) });
    }
    await paletteSearch.press("ArrowDown");
    await until(async () => await paletteSearch.getAttribute("aria-activedescendant") === "palette-item-0" && await visibleActiveOption(),
      "ArrowDown wraps back to the first visible palette option");
    assert.equal(await paletteSearch.evaluate((input) => document.activeElement === input), true, "arrow navigation keeps typing focus in search");
    await paletteSearch.press("Escape");
    await palette.waitFor({ state: "hidden" });
  }

  // Resting pointer during scroll
  await page.setViewportSize({ width: 1280, height: 400 });
  await openPalette();
  const restingOptionCount = await palette.getByRole("option").count();
  const firstOption = (await palette.locator("#palette-item-0").boundingBox())!;
  await page.mouse.move(firstOption.x + firstOption.width / 2, firstOption.y + firstOption.height / 2);
  await until(async () => await paletteSearch.getAttribute("aria-activedescendant") === "palette-item-0", "resting pointer over first option");
  await palette.locator(".palette-results").evaluate((list) => {
    const hovered: string[] = [];
    (window as unknown as { paletteHovered: string[] }).paletteHovered = hovered;
    list.addEventListener("mouseover", (event) => hovered.push((event.target as HTMLElement).closest("[role=option]")?.id ?? ""));
  });
  await paletteSearch.press("ArrowUp");
  await until(async () => await page.evaluate(() => (window as unknown as { paletteHovered: string[] }).paletteHovered.some((id) => id !== "" && id !== "palette-item-0")),
    "the scroll moves another option under the resting pointer");
  assert.equal(await paletteSearch.getAttribute("aria-activedescendant"), `palette-item-${restingOptionCount - 1}`,
    "a scroll under a resting pointer leaves the arrow's selection alone");
  const hoveredId = await page.evaluate(() => (window as unknown as { paletteHovered: string[] }).paletteHovered.findLast((id) => id !== "")!);
  const hoveredBox = (await palette.locator(`#${hoveredId}`).boundingBox())!;
  await page.mouse.move(hoveredBox.x + hoveredBox.width / 2 + 4, hoveredBox.y + hoveredBox.height / 2);
  await until(async () => await paletteSearch.getAttribute("aria-activedescendant") === hoveredId, "a real pointer move selects the option under it");
  await paletteSearch.press("Escape");
  await palette.waitFor({ state: "hidden" });
  await page.mouse.move(0, 0);
  await page.setViewportSize(paletteViewport);
  console.log("PASS palette buttons keep native Enter, IME keeps its keys, and arrow selection stays visible on short desktop and phone lists");

  await checkPaletteKeys(page, { workspaceId: workspaces[1]! });

  // Hold a real machines response, then deliver a newer status through herdr/SSE
  const badge = page.locator(".pane-item.is-selected .badge");
  await herdrRpc("pane.report_agent", { pane_id: paneA, source: "manual", agent: "claude", state: "blocked" });
  await until(async () => await badge.getAttribute("data-status") === "blocked", "blocked baseline");
  await agentRow(paneA).locator('.badge[data-status="blocked"]').waitFor();
  assert.equal(await agentRow(paneA).locator('.agent-select[aria-current="true"]').count(), 1,
    "Agents independently marks its selected pane");
  assert.equal(await agentRow(paneA).locator('.sidebar-status[role="status"]').count(), 1,
    "Agents uses a compact accessible status");
  assert.ok((await agentRow(paneA).locator(".agent-title").textContent())?.trim(), "an agent has a task title");

  let releasePoll!: () => void;
  const heldPoll = new Promise<void>((resolve) => { releasePoll = resolve; });
  session.releases.push(releasePoll);
  let pollCaptured = false;
  let pollFinished = false;
  await page.route("**/api/machines", async (route) => {
    const response = await route.fetch();
    if (!pollCaptured) {
      pollCaptured = true;
      await heldPoll;
      await route.fulfill({ response });
      pollFinished = true;
    } else await route.fulfill({ response });
  });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await until(() => pollCaptured, "held machines snapshot");
  await herdrRpc("pane.report_agent", { pane_id: paneA, source: "manual", agent: "claude", state: "working" });
  await until(async () => await badge.getAttribute("data-status") === "working", "working event before poll");
  await agentRow(paneA).locator('.badge[data-status="working"]').waitFor();
  releasePoll();
  await until(() => pollFinished, "stale machines response released");
  await page.waitForTimeout(300);
  assert.equal(await badge.getAttribute("data-status"), "working", "stale poll must not revert RUN to INPUT");
  assert.equal(await agentRow(paneA).locator(".badge").getAttribute("data-status"), "working",
    "a stale poll must not revert the separate Agents list either");
  if (process.env.UI_EVIDENCE_DIR) {
    mkdirSync(process.env.UI_EVIDENCE_DIR, { recursive: true });
    await page.screenshot({ path: join(process.env.UI_EVIDENCE_DIR, "pane-status-poll.png") });
  }
  await page.unroute("**/api/machines");
  await herdrRpc("pane.report_agent", { pane_id: paneA, source: "manual", agent: "claude", state: "idle" });
  await until(async () => {
    const roster = await (await context.request.get(`${origin}/api/machines`)).json() as { machines: Machine[] };
    const settled = roster.machines.find((machine) => machine.id === "local")?.snapshot?.panes.find((pane) => pane.pane_id === paneA)?.agent_status;
    return (settled === "idle" || settled === "done") && await agentRow(paneA).locator(".badge").getAttribute("data-status") === settled;
  }, "the agent row reflects the bridge's completed-turn status");
  console.log("PASS delayed machines poll preserves newer streamed pane status");

  // Agents is global to the sidebar
  await herdrRpc("pane.report_agent", { pane_id: paneB, source: "manual", agent: "codex", state: "idle" });
  await agentRow(paneB).waitFor();
  const machineToggle = page.locator(".machine-group .machine-toggle");
  assert.equal(await page.locator(".machine-group .machine-toggle + .machine-new").count(), 1);
  await machineToggle.click();
  await workspaceGroup(workspaces[0]!).waitFor({ state: "detached" });
  assert.equal(await agentRow(paneA).isVisible(), true, "PC folding leaves Agents visible");
  await agentRow(paneB).locator(".agent-select").click();
  await agentRow(paneB).locator('.agent-select[aria-current="true"]').waitFor();
  assert.deepEqual(await page.evaluate(() => JSON.parse(sessionStorage.getItem("herdr-web-ui:selection") ?? "null")),
    { machine_id: "local", pane_id: paneB }, "Agent selection retains its machine and pane target");
  assert.equal(await machineToggle.getAttribute("aria-expanded"), "false", "Agent selection preserves the user's PC fold");
  painted.delete(paneA);
  await agentRow(paneA).locator(".agent-select").click();
  await agentRow(paneA).locator('.agent-select[aria-current="true"]').waitFor();
  await until(() => painted.has(paneA), "returning from Agents paints the current pane");
  await machineToggle.click();
  await workspaceHeader(workspaces[0]!).locator('.workspace-select[aria-current="true"]').waitFor();

  // Reuse the real API roster as an offline cache
  const cachedRoster = await (await context.request.get(`${origin}/api/machines`)).json() as { machines: Machine[] };
  const offlineMachines = cachedRoster.machines.map((machine) => ({ ...machine, state: "disconnected" as const }));
  const offlineContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  let offlineEvidence = await watchBrowserEvidence(session, offlineContext, await offlineContext.newPage(), "offline-roster");
  try {
    await offlineContext.addInitScript(() => localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en", alertsOn: false })));
    await offlineContext.route("**/api/machines", (route) => route.fulfill({ json: { machines: offlineMachines } }));
    await offlineContext.route("**/api/machines/events", (route) => route.fulfill({
      contentType: "text/event-stream", body: `retry: 60000\ndata: ${JSON.stringify({ type: "machines", machines: offlineMachines })}\n\n`,
    }));
    await offlineContext.routeWebSocket(/\/ws(?:\?|$)/, (socket) => socket.close({ code: 1000, reason: "Offline" }));
    const offlinePage = await offlineContext.newPage();
    await offlinePage.goto(`${origin}/?pane=${encodeURIComponent(paneA)}`);
    const offlineAgent = offlinePage.locator(`.agents-sidebar .agent-item[data-machine="local"][data-pane="${paneB}"] .agent-select`);
    await offlineAgent.waitFor();
    assert.equal(await offlineAgent.isDisabled(), true, "a cached offline agent cannot select its pane");
    const selectionBefore = await offlinePage.evaluate(() => sessionStorage.getItem("herdr-web-ui:selection"));
    await offlineAgent.dispatchEvent("click");
    assert.equal(await offlinePage.evaluate(() => sessionStorage.getItem("herdr-web-ui:selection")), selectionBefore,
      "offline Agent clicks leave the current selection unchanged");
  } catch (error) {
    await offlineEvidence?.captureFailure(error);
    throw error;
  } finally {
    if (offlineEvidence) await offlineEvidence.finish();
    await offlineContext.close();
  }
  console.log("PASS Agents excludes shells, survives PC folds, selects its machine target and disables offline rows");

  // Background wait status
  let backgroundPeer: "working" | "done" | "blocked" | "idle" | null = null;
  await page.route("**/api/machines", async (route) => {
    const response = await route.fetch();
    const body = await response.json() as { machines: { snapshot?: { panes: any[]; tabs: any[] } }[] };
    for (const machine of body.machines) {
      const pane = machine.snapshot?.panes.find((pane: any) => pane.pane_id === paneA);
      if (!pane || !machine.snapshot) continue;
      Object.assign(pane, { agent_status: "done", background_tasks: 1, background_wait: true });
      if (backgroundPeer) {
        const peer = { ...pane, pane_id: `${paneA}-background-peer`, agent_status: backgroundPeer, background_wait: undefined };
        machine.snapshot.panes.push(peer);
        const tab = machine.snapshot.tabs.find((tab: any) => tab.tab_id === pane.tab_id);
        if (tab) tab.agent_status = backgroundPeer === "blocked" ? "blocked" : "done";
      }
    }
    await route.fulfill({ response, json: body });
  });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  const waitingBadge = agentRow(paneA).locator(".badge[data-status=waiting]");
  await waitingBadge.waitFor();
  assert.equal((await waitingBadge.textContent())?.trim(), "BG");
  assert.equal(await waitingBadge.getAttribute("title"), "Agent waiting on background work");
  assert.equal(await waitingBadge.locator("svg").count(), 1, "BG draws the running arc");
  await page.locator('.composer-status[data-status="waiting"] strong.visually-hidden', { hasText: "BG" }).waitFor();
  for (const peer of ["working", "done", "blocked", "idle"] as const) {
    backgroundPeer = peer;
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    const expected = peer === "idle" ? "waiting" : peer;
    await page.locator(`.tab-strip-tab[aria-selected="true"] .tab-strip-dot[data-status="${expected}"]`).waitFor();
  }
  backgroundPeer = null;
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.keyboard.press("ControlOrMeta+Shift+Comma");
  const { openSettingsPage } = await import("./settings-page.ts");
  await openSettingsPage(page, "Appearance");
  const quietFinishes = page.getByRole("switch", { name: "Quiet opened finishes", exact: true });
  const quietBefore = await quietFinishes.getAttribute("aria-checked");
  if (quietBefore !== "true") await quietFinishes.click();
  await page.getByRole("button", { name: "Close settings", exact: true }).click();
  await waitingBadge.waitFor();
  assert.equal((await waitingBadge.textContent())?.trim(), "BG", "Quiet opened finishes cannot hide a background hold");
  if (process.env.UI_EVIDENCE_DIR) {
    const viewport = page.viewportSize()!;
    const themeBefore = await page.evaluate(() => document.documentElement.dataset.theme);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      for (const theme of ["dark", "light"]) {
        await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
        await page.locator('.composer-status[data-status="waiting"]').waitFor();
        await page.screenshot({ path: join(process.env.UI_EVIDENCE_DIR, `background-wait-${width}-${theme}.png`), animations: "disabled" });
        if (width === 390) {
          const drawer = page.locator('button[aria-controls="workspace-drawer"]');
          await drawer.click();
          await waitingBadge.waitFor();
          await page.screenshot({ path: join(process.env.UI_EVIDENCE_DIR, `background-wait-${width}-${theme}-drawer.png`), animations: "disabled" });
          await drawer.click();
        }
      }
    }
    await page.setViewportSize(viewport);
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, themeBefore);
  }
  if (quietBefore !== "true") {
    await page.keyboard.press("ControlOrMeta+Shift+Comma");
    await openSettingsPage(page, "Appearance");
    await page.getByRole("switch", { name: "Quiet opened finishes", exact: true }).click();
    await page.getByRole("button", { name: "Close settings", exact: true }).click();
  }
  await page.unroute("**/api/machines");
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await waitingBadge.waitFor({ state: "detached" });
  console.log("PASS a pane whose turn ended on its background work reads BG in the sidebar and the composer, and its status again once it does not");

  assertClean(session, "palette and status tests");
  if (pageEvidence) await pageEvidence.finish();
  await page.close();
  await context.close();
} catch (error) {
  for (const evidence of session.evidenceSessions) {
    if (evidence.isOpen()) await evidence.captureFailure(error);
  }
  throw error;
} finally {
  await closeTestSession(session);
}
