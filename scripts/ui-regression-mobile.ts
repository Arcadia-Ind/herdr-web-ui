/**
 * UI regression tests: Mobile viewport, prompts, suggestions, close/recovery, token gate.
 * Part 5 of the split ui-regression suite.
 */
import "./test-herdr.ts";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "../server/index.ts";
import { herdrRpc, workspaceCreate, workspaceClose } from "../server/herdr/client.ts";
import { UsageService } from "../server/usage.ts";
import { runMoreItem } from "./header-more.ts";
import { watchCsp, assertCspClean } from "./csp-violations.ts";
import {
  createTestSession,
  closeTestSession,
  createDesktopPage,
  createMobilePage,
  watchBrowserEvidence,
  until,
  createWsTracker,
  selectPane,
  NO_SEND_WAIT_MS,
  type TestSession,
} from "./ui-regression-shared.ts";

const session = await createTestSession({ name: "herdr-web-ui-mobile", labelSuffix: "mobile" });
const { root, origin, browser, workspaces, paneA, paneB, csp, errors } = session;

try {
  const { context, page } = await createDesktopPage(session, { panes: [paneA, paneB] });
  const pageEvidence = await watchBrowserEvidence(session, context, page, "mobile-main");
  const { painted, pendingReady } = createWsTracker(page);

  await page.goto(`${origin}/?pane=${encodeURIComponent(paneB)}`);
  await page.locator(".conn-live").waitFor();
  await until(() => painted.has(paneB), "owned pane paint");
  const composer = page.getByRole("textbox", { name: "Message", exact: true });
  await composer.waitFor();

  // Startup prompt test
  const paintStartupMenu = async (): Promise<void> => {
    await herdrRpc("pane.send_text", {
      pane_id: paneB,
      text: "printf '\\033[2J\\033[HDo you trust the contents of this directory?\\n\\n› 1. Yes, continue\\n  2. No, quit\\n\\n  Press enter to continue\\n'; read -r qa_answer",
    });
    await herdrRpc("pane.send_keys", { pane_id: paneB, keys: ["Enter"] });
    await until(async () => {
      const result = await herdrRpc<{ read: { text: string } }>("pane.read", {
        pane_id: paneB, source: "visible", format: "text",
      });
      return result.read.text.includes("Press enter to continue");
    }, "startup menu painted");
  };

  await paintStartupMenu();
  await herdrRpc("pane.report_agent", { pane_id: paneB, source: "manual", agent: "codex", state: "idle" });
  await page.locator('.composer-status[data-status="idle"]').waitFor();
  const startupPrompt = page.locator(".prompt-card");
  await startupPrompt.getByRole("button", { name: "1. Yes, continue", exact: true }).waitFor();
  assert.deepEqual(await startupPrompt.evaluate((node) => ({
    inTranscript: node.closest(".chat-view") !== null,
    next: node.parentElement?.nextElementSibling?.classList.contains("composer") ?? false,
    over: node.getBoundingClientRect().bottom <= document.querySelector(".composer-surface")!.getBoundingClientRect().top,
  })), { inTranscript: false, next: true, over: true });
  await startupPrompt.getByRole("button", { name: "1. Yes, continue", exact: true }).click();
  await startupPrompt.waitFor({ state: "hidden" });
  console.log("PASS startup prompt appears and accepts an answer while the agent status is idle");

  // Typed pick answered in terminal
  await paintStartupMenu();
  await startupPrompt.getByRole("button", { name: "1. Yes, continue", exact: true }).waitFor();
  await composer.fill("1");
  await composer.press("Enter");
  await startupPrompt.locator(".prompt-card-confirm").waitFor();
  await herdrRpc("pane.send_keys", { pane_id: paneB, keys: ["Enter"] });
  await startupPrompt.waitFor({ state: "hidden" });
  await paintStartupMenu();
  await startupPrompt.getByRole("button", { name: "1. Yes, continue", exact: true }).waitFor();
  await page.waitForTimeout(500);
  assert.equal(await startupPrompt.locator(".prompt-card-confirm").count(), 0);
  await startupPrompt.getByRole("button", { name: "1. Yes, continue", exact: true }).click();
  await startupPrompt.waitFor({ state: "hidden" });
  console.log("PASS a typed pick answered in the terminal does not wait on the same menu asked again");

  // Claude's suggestion test
  const paintSuggestion = async (pane: string, suggestion: string): Promise<void> => {
    await herdrRpc("pane.send_text", {
      pane_id: pane,
      text: `printf '\\033[2J\\033[H%s\\n\\342\\235\\257 \\033[2m%s\\033[0m\\n%s\\n' "$(printf '\\342\\224\\200%.0s' $(seq 40))" '${suggestion}' "$(printf '\\342\\224\\200%.0s' $(seq 40))"; read -r qa_suggest; clear`,
    });
    await herdrRpc("pane.send_keys", { pane_id: pane, keys: ["Enter"] });
    await until(async () => {
      const result = await herdrRpc<{ read: { text: string } }>("pane.read", { pane_id: pane, source: "visible", format: "text" });
      return result.read.text.includes(`❯ ${suggestion}`);
    }, "suggestion painted");
  };

  await selectPane(page, paneA);
  await composer.fill("");
  await herdrRpc("pane.report_agent", { pane_id: paneA, source: "manual", agent: "claude", state: "idle" });
  await paintSuggestion(paneA, "run the tests");
  await until(async () => await composer.getAttribute("placeholder") === "run the tests", "suggestion as placeholder");
  await composer.focus();
  await page.keyboard.press("Tab");
  assert.equal(await composer.inputValue(), "run the tests", "Tab takes the suggestion");

  // Suggestion after send
  let readBeforeSend = false;
  await page.route(`**/api/pane/prompt?pane_id=${encodeURIComponent(paneA)}`, async (route) => {
    const response = await route.fetch();
    readBeforeSend = true;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.fulfill({ response });
  });
  await until(async () => readBeforeSend, "a prompt read in flight");
  await composer.press("Enter");
  await until(async () => await composer.getAttribute("placeholder") !== "run the tests", "a send drops the suggestion");
  await until(async () => await composer.inputValue() === "", "the sent box clears");
  for (let check = 0; check < 16; check++) {
    assert.notEqual(await composer.getAttribute("placeholder"), "run the tests", "a read from before the send does not bring the suggestion back");
    await page.waitForTimeout(150);
  }
  await page.unroute(`**/api/pane/prompt?pane_id=${encodeURIComponent(paneA)}`);

  // Same suggestion appears again
  await paintSuggestion(paneA, "run the tests");
  await until(async () => await composer.getAttribute("placeholder") === "run the tests", "the same suggestion again");

  // Pane switch doesn't show other pane's suggestion
  await herdrRpc("pane.report_agent", { pane_id: paneB, source: "manual", agent: "claude", state: "idle" });
  await page.route(`**/api/pane/prompt?pane_id=${encodeURIComponent(paneB)}`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue().catch(() => {});
  });
  await selectPane(page, paneB);
  for (let check = 0; check < 8; check++) {
    assert.notEqual(await composer.getAttribute("placeholder"), "run the tests", "another pane's suggestion never shows");
    await page.waitForTimeout(150);
  }
  await page.unroute(`**/api/pane/prompt?pane_id=${encodeURIComponent(paneB)}`);
  await herdrRpc("pane.send_keys", { pane_id: paneA, keys: ["Enter"] });
  console.log("PASS Claude's suggestion fills the composer with Tab, returns after a send, and stays with its pane");

  // Mobile compositor with unavailable storage
  const { context: mobile, page: mobilePage } = await createMobilePage(session, { storageUnavailable: true });
  const mobileEvidence = await watchBrowserEvidence(session, mobile, mobilePage, "mobile-storage-unavailable");
  await mobilePage.goto(`${origin}/?pane=${encodeURIComponent(paneB)}`);
  await mobilePage.locator(".conn-live").waitFor();
  const tapHighlight = await mobilePage.locator(".view-switch button").first().evaluate((node) => getComputedStyle(node).getPropertyValue("-webkit-tap-highlight-color"));
  assert.equal(tapHighlight, "rgba(0, 0, 0, 0)", "native tap overlays do not obscure selection");
  await mobilePage.getByTitle("Chat transcript (⌘⇧J)", { exact: true }).click();
  await mobilePage.getByRole("textbox", { name: "Message", exact: true }).fill("mobile draft");
  await mobilePage.locator(".chat-terminal-fallback").waitFor();
  assert.equal(await mobilePage.locator(".chat-terminal-fallback").getAttribute("open"), null, "missing native history is labeled");
  assert.equal(await mobilePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await mobilePage.evaluate(() => document.documentElement.setAttribute("data-keyboard", ""));
  assert.equal(await mobilePage.getByRole("button", { name: "Report a problem", exact: true }).count(), 0, "no report action on a phone");
  assert.equal(await mobilePage.getByRole("button", { name: "Hide keyboard", exact: true }).count(), 0, "no keyboard button on a phone");
  await mobilePage.evaluate(() => document.documentElement.removeAttribute("data-keyboard"));
  assertClean("the chat, the composer and the phone views load with no CSP violation");
  console.log("PASS mobile composer with unavailable storage and no horizontal overflow");

  // Phone pane selection keyboard test
  const typing = (target: typeof mobilePage) => target.evaluate(() => document.activeElement?.matches("textarea, input, [contenteditable]") ?? false);
  await mobilePage.getByRole("textbox", { name: "Message", exact: true }).blur();
  await mobilePage.locator('button[aria-controls="workspace-drawer"]').click();
  await mobilePage.locator(`.pane-select[title^="${paneA} —"]`).click();
  await mobilePage.getByRole("textbox", { name: "Message", exact: true }).waitFor();
  await mobilePage.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await mobilePage.waitForTimeout(NO_SEND_WAIT_MS);
  assert.equal(await typing(mobilePage), false, "a pane picked on a phone does not take the keyboard");
  await mobilePage.getByTitle("Live terminal (⌘⇧J)", { exact: true }).click();
  await mobilePage.waitForTimeout(NO_SEND_WAIT_MS);
  assert.equal(await typing(mobilePage), false, "nor does switching its lens");
  await mobilePage.getByTitle("Chat transcript (⌘⇧J)", { exact: true }).click();
  await mobilePage.getByRole("textbox", { name: "Message", exact: true }).tap();
  await until(() => typing(mobilePage), "a tap on the message box takes the keyboard");
  await mobilePage.getByRole("textbox", { name: "Message", exact: true }).blur();
  await mobilePage.locator('button[aria-controls="workspace-drawer"]').click();
  assert.equal(await mobilePage.locator(".agents-sidebar .agent-section-toggle").getAttribute("aria-expanded"), "false", "a phone's drawer opens with Agents folded");
  await mobilePage.locator(`.pane-select[title^="${paneB} —"]`).click();
  await mobilePage.getByRole("textbox", { name: "Message", exact: true }).waitFor();
  console.log("PASS a pane picked on a phone waits for a tap before raising the keyboard");

  // Phone suggestion chip
  const promptRoute = `**/api/pane/prompt?pane_id=${encodeURIComponent(paneB)}`;
  const suggest = { json: { prompt: null, suggestion: "run the tests" } };
  const mobileComposer = mobilePage.getByRole("textbox", { name: "Message", exact: true });
  await mobilePage.route(promptRoute, (route) => route.fulfill(suggest));
  await mobileComposer.fill("");
  await until(async () => await mobileComposer.getAttribute("placeholder") === "run the tests", "suggestion as placeholder on phone");
  assert.equal(await mobilePage.locator(".voice-mic").count(), 0, "a phone's chat has no mic until Settings asks for it");
  await mobilePage.getByTitle("Use the suggestion", { exact: true }).click();
  assert.equal(await mobileComposer.inputValue(), "run the tests", "the chip puts the suggestion in the box");
  await mobilePage.unroute(promptRoute);
  if (mobileEvidence) await mobileEvidence.finish();
  await mobile.close();

  // Phone without suggestion chip
  const plainPhone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await plainPhone.addInitScript(() => { localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ showSuggestionChip: false })); });
  const plainPage = await plainPhone.newPage();
  const plainEvidence = await watchBrowserEvidence(session, plainPhone, plainPage, "suggestion-chip-off");
  session.csp.push(await watchCsp(plainPage));
  plainPage.on("pageerror", (error) => errors.push(error.message));
  await plainPage.route(promptRoute, (route) => route.fulfill(suggest));
  await plainPage.goto(`${origin}/?pane=${encodeURIComponent(paneB)}`);
  await plainPage.locator(".conn-live").waitFor();
  await plainPage.getByTitle("Chat transcript (⌘⇧J)", { exact: true }).click();
  const plainComposer = plainPage.getByRole("textbox", { name: "Message", exact: true });
  await until(async () => await plainComposer.getAttribute("placeholder") === "run the tests", "suggestion placeholder with chip off");
  assert.equal(await plainPage.getByTitle("Use the suggestion", { exact: true }).count(), 0, "no suggestion chip");
  if (plainEvidence) await plainEvidence.finish();
  await plainPhone.close();
  assertClean("the suggestion chip loads with no CSP violation");
  console.log("PASS a phone offers Claude's suggestion as a chip until Settings turns it off");

  // Close and recovery test
  await selectPane(page, paneA);
  assert.equal(await page.getByRole("button", { name: "Sign out", exact: true }).count(), 0);
  const createdWorkspace = await workspaceCreate({ cwd: root, label: "herdr-web-ui-test-to-close" });
  workspaces.push(createdWorkspace.workspace.workspace_id);
  await page.locator(`.pane-select[title^="${createdWorkspace.root_pane.pane_id} —"]`).click();
  await page.locator(".pane-item.is-selected .row-menu-toggle").click();
  const rowMenu = page.getByRole("menu");
  await rowMenu.waitFor();
  const rowActions = await rowMenu.getByRole("menuitem").allTextContents();
  assert.deepEqual(rowActions, ["Rename workspace", "Close workspace"], "the workspace menu keeps workspace scope");
  await page.keyboard.press("Escape");
  await rowMenu.waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains("row-menu-toggle") ?? false), true, "Escape returns focus to the row's ⋯");
  await page.keyboard.press("Enter");
  await rowMenu.getByRole("menuitem", { name: "Close workspace", exact: true }).click();
  const confirmClose = page.getByRole("alertdialog");
  await confirmClose.waitFor();
  await confirmClose.getByRole("button", { name: "Close", exact: true }).click();
  workspaces.splice(workspaces.indexOf(createdWorkspace.workspace.workspace_id), 1);
  await until(async () => {
    const selected = JSON.parse(await page.evaluate(() => sessionStorage.getItem("herdr-web-ui:selection") ?? "null"));
    return selected?.pane_id && selected.pane_id !== createdWorkspace.root_pane.pane_id;
  }, "closed pane selection recovered");
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.evaluate(() => document.activeElement?.matches("textarea, input, [contenteditable]") ?? false), false,
    "a pane selected after a close must not focus its input");
  await page.locator(".pane-item.is-selected .pane-select").click();
  await until(async () => await page.evaluate(() => document.activeElement?.matches("textarea, input, [contenteditable]") ?? false),
    "picking the auto-selected pane focuses its input");

  // Obsolete selection recovery
  await page.evaluate(() => sessionStorage.setItem("herdr-web-ui:selection", JSON.stringify({ machine_id: "local", pane_id: "obsolete-pane" })));
  await page.reload();
  await until(async () => {
    const selected = JSON.parse(await page.evaluate(() => sessionStorage.getItem("herdr-web-ui:selection") ?? "null"));
    return selected?.pane_id && selected.pane_id !== "obsolete-pane";
  }, "obsolete saved selection recovered");
  console.log("PASS closed and obsolete saved panes recover their selection");

  assertClean("the desktop shell, the file viewer and the pane close load with no CSP violation");
  if (pageEvidence) await pageEvidence.finish();
  await page.close();
  await context.close();

  // Token gate sign out test
  const secured = createServer({ port: 0, hostname: "127.0.0.1", token: "browser-test-token", stateDir: join(root, "secured"), tailscaleOwner: null });
  session.releases.push(() => secured.stop());
  const securedOrigin = `http://127.0.0.1:${secured.port}`;
  const securedContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const securedWorkspace = await workspaceCreate({ cwd: root, label: "herdr-web-ui-test-browser-signout" });
  workspaces.push(securedWorkspace.workspace.workspace_id);
  const securedPage = await securedContext.newPage();
  const securedEvidence = await watchBrowserEvidence(session, securedContext, securedPage, "token-gate-signout");
  session.csp.push(await watchCsp(securedPage));
  await securedContext.request.post(`${securedOrigin}/api/auth`, { data: { token: "browser-test-token" } });
  await securedPage.goto(`${securedOrigin}/?pane=${encodeURIComponent(securedWorkspace.root_pane.pane_id)}`);
  await securedPage.getByRole("button", { name: "Sign out", exact: true }).waitFor();
  await securedPage.keyboard.press("ControlOrMeta+Shift+K");
  await securedPage.getByRole("option", { name: "Sign out", exact: true }).waitFor();
  await securedPage.getByRole("button", { name: "Sign out", exact: true }).focus();
  await securedPage.keyboard.press("Escape");
  await securedPage.getByRole("dialog", { name: "Command palette", exact: true }).waitFor({ state: "hidden" });
  await securedPage.getByRole("button", { name: "Sign out", exact: true }).click();
  await securedPage.getByTestId("token-gate").waitFor();
  assert.equal((await securedContext.request.get(`${securedOrigin}/api/session`)).status(), 401);

  // Paired device sign out
  const pairing = await securedContext.request.post(`${securedOrigin}/api/devices/pair/start`, { headers: { authorization: "Bearer browser-test-token", "x-herdr-machine": "1" } });
  const { code } = await pairing.json();
  await securedContext.request.post(`${securedOrigin}/api/devices/pair`, { data: { code, label: "Browser test device" } });
  await securedPage.reload();
  await securedPage.getByRole("button", { name: "Sign out", exact: true }).click();
  await securedPage.getByTestId("token-gate").waitFor();
  assert.equal((await securedContext.request.get(`${securedOrigin}/api/session`)).status(), 401);
  if (securedEvidence) await securedEvidence.finish();
  await securedContext.close();
  assertClean("the token gate loads with no CSP violation");
  console.log("PASS token and paired-device sign out return to the access gate");

  function assertClean(label: string) {
    assert.equal(errors.length, 0, errors.join("\n"));
    assertCspClean(session.csp, label);
  }
} catch (error) {
  for (const evidence of session.evidenceSessions) {
    if (evidence.isOpen()) await evidence.captureFailure(error);
  }
  throw error;
} finally {
  await closeTestSession(session);
}
