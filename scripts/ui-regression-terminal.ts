/**
 * UI regression tests: Terminal input, paste, shortcuts, IME handling, and touch input.
 * Part 2 of the split ui-regression suite.
 */
import "./test-herdr.ts";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { herdrRpc } from "../server/herdr/client.ts";
import { checkTerminalFileInput } from "./terminal-file-input-regression.ts";
import { checkCommandBackspace } from "./terminal-command-backspace-regression.ts";
import { checkCtrlEnter } from "./terminal-ctrl-enter-regression.ts";
import { checkCommandArrows } from "./terminal-command-arrows-regression.ts";
import { checkTerminalInput } from "./terminal-input-regression.ts";
import { checkSafariIme } from "./terminal-safari-ime-regression.ts";
import { checkHeldDraftPaneSwitch } from "./terminal-draft-regression.ts";
import { watchCsp, assertCspClean } from "./csp-violations.ts";
import {
  createTestSession,
  closeTestSession,
  createDesktopPage,
  watchBrowserEvidence,
  until,
  assertClean,
  createWsTracker,
  IME_ENTER,
  NO_SEND_WAIT_MS,
  type TestSession,
} from "./ui-regression-shared.ts";

const session = await createTestSession({ name: "herdr-web-ui-terminal", labelSuffix: "terminal" });
const { origin, browser, paneA, paneB, csp, errors } = session;

try {
  const { context, page } = await createDesktopPage(session, { panes: [paneA, paneB] });
  const pageEvidence = await watchBrowserEvidence(session, context, page, "terminal-main");
  const { inputs, inputStates, sockets, painted, pendingReady } = createWsTracker(page);

  await page.goto(`${origin}/?pane=${encodeURIComponent(paneA)}`);
  await page.locator(".conn-live").waitFor();
  await until(() => painted.has(paneA), "owned pane paint");
  const composer = page.getByRole("textbox", { name: "Message", exact: true });
  await composer.waitFor();

  // Terminal file input test
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  await page.getByTitle("Live terminal (⌘⇧J)", { exact: true }).click();
  await pendingReady(paneA);
  const fileInputSocket = inputStates.get(paneA)?.socket;
  assert.ok(fileInputSocket, "the current pane has an input-ready attachment");
  await checkTerminalFileInput(page, fileInputSocket);

  const terminalInput = page.locator(".xterm-helper-textarea");
  const mac = process.platform === "darwin";

  // Chrome on macOS pastes with ⌘V alone
  if (mac) {
    await terminalInput.focus();
    const beforeCtrlV = inputs.length;
    await page.keyboard.press("Control+v");
    await page.waitForTimeout(NO_SEND_WAIT_MS);
    assert.deepEqual(inputs.slice(beforeCtrlV), [], "Ctrl+V must never send the image-paste control key");
  }

  // Terminal paste tests
  for (const [shortcut, text] of [
    [mac ? "Meta+v" : "Control+v", "# terminal paste 한글"],
    [mac ? "Meta+v" : "Control+v", "# first line\n# second line"],
    ...mac ? [] : [["Control+Shift+v", "# plain text paste"]],
  ]) {
    await page.evaluate((value) => navigator.clipboard.writeText(value), text!);
    await terminalInput.focus();
    const beforePaste = inputs.length;
    await page.keyboard.press(shortcut!);
    await until(() => inputs.length > beforePaste, `terminal ${shortcut}`);
    const pasted = inputs.slice(beforePaste);
    assert.equal(pasted.length, 1, "paste must send the text exactly once");
    assert.equal(pasted[0]!.pane_id, paneA);
    assert.equal(
      pasted[0]!.text.replace(/^\x1b\[200~/, "").replace(/\x1b\[201~$/, ""),
      text!.replace(/\n/g, "\r"),
      "paste must send clipboard text, never the image-paste control key",
    );
    const beforeCancel = inputs.length;
    await page.keyboard.press("Control+c");
    await until(() => inputs.length > beforeCancel, "terminal Ctrl+C");
    assert.equal(inputs.at(-1)?.text, "\x03", "other terminal control keys must still work");
  }

  // Enter key variants
  for (const [shortcut, expected] of [
    ["Enter", "\r"],
    ["Shift+Enter", "\x1b\r"],
    ["Alt+Enter", "\x1b\r"],
  ]) {
    await terminalInput.focus();
    const beforeEnter = inputs.length;
    await page.keyboard.press(shortcut!);
    await until(() => inputs.length > beforeEnter, `terminal ${shortcut}`);
    await page.waitForTimeout(NO_SEND_WAIT_MS);
    assert.deepEqual(inputs.slice(beforeEnter).map(({ pane_id, text }) => ({ pane_id, text })),
      [{ pane_id: paneA, text: expected }], `${shortcut} must send its sequence exactly once`);
  }

  // IME composition handling
  for (const composition of [{ isComposing: true, keyCode: 13 }, { isComposing: false, keyCode: 229 }]) {
    const beforeIme = inputs.length;
    await terminalInput.dispatchEvent("keydown", {
      key: "Enter", code: "Enter", shiftKey: true, ...composition, bubbles: true, cancelable: true,
    });
    await page.waitForTimeout(NO_SEND_WAIT_MS);
    assert.equal(inputs.slice(beforeIme).some(({ text }) => text === "\x1b\r"), false,
      "IME commits must not receive the custom Shift+Enter sequence");
  }

  // compositionend followed by Shift+Enter
  await terminalInput.focus();
  const beforeCommittedIme = inputs.length;
  await terminalInput.evaluate(async (element) => {
    const textarea = element as HTMLTextAreaElement;
    textarea.value = "";
    textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    textarea.value = "한";
    textarea.dispatchEvent(new CompositionEvent("compositionupdate", { data: "한", bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    textarea.dispatchEvent(new CompositionEvent("compositionend", { data: "한", bubbles: true }));
    const enter = { key: "Enter", code: "Enter", keyCode: 13, which: 13,
      shiftKey: true, isComposing: false, bubbles: true, cancelable: true };
    textarea.dispatchEvent(new KeyboardEvent("keydown", enter));
    textarea.dispatchEvent(new KeyboardEvent("keyup", enter));
  });
  await until(() => inputs.length >= beforeCommittedIme + 2, "IME commit followed by Shift+Enter");
  await page.waitForTimeout(NO_SEND_WAIT_MS);
  assert.deepEqual(inputs.slice(beforeCommittedIme).map(({ pane_id, text }) => ({ pane_id, text })),
    [{ pane_id: paneA, text: "한" }, { pane_id: paneA, text: "\x1b\r" }],
    "a pending IME commit must precede Shift+Enter without a delayed duplicate");
  console.log("PASS terminal Shift+Enter sends a newline chord once and preserves Enter, Alt+Enter and IME");
  console.log("PASS pending IME commit precedes Shift+Enter without duplicate text");

  // Check functions for terminal shortcuts
  await checkCommandBackspace(browser, origin, paneA);
  await checkCtrlEnter(browser, origin, paneA);
  await checkCommandArrows(browser, origin, paneA);

  // Pane switch shortcuts
  const selectedTitle = () => page.locator(".pane-item.is-selected .pane-select").getAttribute("title");
  const focusTerminal = () => until(async () => {
    await terminalInput.focus();
    return page.evaluate(() => new Promise<boolean>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() =>
      resolve(document.activeElement?.classList.contains("xterm-helper-textarea") ?? false)))));
  }, "the terminal holds the focus");

  for (const key of ["ControlOrMeta+Shift+ArrowDown", "ControlOrMeta+Shift+ArrowUp"]) {
    await focusTerminal();
    const beforeSwitch = inputs.length;
    await page.keyboard.press(key);
    await until(async () => !(await selectedTitle())?.startsWith(`${paneA} —`), `${key} leaves the pane`);
    await page.waitForTimeout(NO_SEND_WAIT_MS);
    assert.deepEqual(inputs.slice(beforeSwitch), [], `${key} must not reach a pane`);
    await page.locator(`.pane-select[title^="${paneA} —"]`).click();
    await until(async () => (await selectedTitle())?.startsWith(`${paneA} —`) === true, "back on the first pane");
  }
  await page.getByTitle("Chat transcript (⌘⇧J)", { exact: true }).click();
  await composer.waitFor();
  console.log("PASS terminal clipboard paste sends text once and preserves Ctrl+C");

  // Check functions for terminal input behavior
  await checkTerminalInput(browser, origin, paneA, paneB);
  await checkSafariIme(browser, origin, paneA, paneB);
  await checkHeldDraftPaneSwitch(browser, origin, paneA, paneB);

  // Touch terminal input
  const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const touchPage = await touch.newPage();
  const touchEvidence = await watchBrowserEvidence(session, touch, touchPage, "touch-terminal-input");
  session.csp.push(await watchCsp(touchPage));
  touchPage.on("pageerror", (error) => errors.push(error.message));
  const touchSent: Array<Record<string, unknown>> = [];
  touchPage.on("websocket", (socket) => socket.on("framesent", ({ payload }) => {
    const message = JSON.parse(String(payload)) as Record<string, unknown>;
    if (message.type === "input" || message.type === "submit") touchSent.push(message);
  }));

  await touchPage.goto(`${origin}/?pane=${encodeURIComponent(paneB)}`);
  await touchPage.locator(".conn-live").waitFor();
  await touchPage.getByTitle("Live terminal (⌘⇧J)", { exact: true }).click();
  const line = touchPage.getByRole("textbox", { name: "Terminal input line", exact: true });
  await line.waitFor();
  assert.equal(await touchPage.locator(".xterm-helper-textarea").getAttribute("inputmode"), "none");

  await line.fill("printf 'line-ok\\n'");
  await line.press("Enter");
  await until(() => touchSent.some((message) => message.type === "submit" && message.typed === true), "input line submit");
  const submitted = touchSent.find((message) => message.type === "submit")!;
  assert.equal(submitted.pane_id, paneB);
  assert.equal(submitted.text, "printf 'line-ok\\n'");
  await until(async () => (await line.inputValue()) === "", "input line cleared after send");

  // IME commit Enter in touch terminal
  await line.fill("echo 한글");
  const imeSent = touchSent.length;
  await line.dispatchEvent("keydown", IME_ENTER);
  await touchPage.waitForTimeout(NO_SEND_WAIT_MS);
  assert.equal(touchSent.length, imeSent);
  assert.equal(await line.inputValue(), "echo 한글");

  // Composition handling
  await line.dispatchEvent("compositionstart", { data: "" });
  const beforeComposeSend = touchSent.length;
  await touchPage.getByRole("button", { name: "Send to the terminal", exact: true }).click();
  await touchPage.waitForTimeout(NO_SEND_WAIT_MS);
  assert.equal(touchSent.length, beforeComposeSend, "button cannot submit an unfinished composition");
  await line.dispatchEvent("compositionend", { data: "한글" });
  await line.fill("");

  // Empty line Enter button
  const enters = touchSent.length;
  await touchPage.getByRole("button", { name: "Press Enter in the terminal", exact: true }).click();
  await until(() => touchSent.length > enters && touchSent.at(-1)?.type === "input" && touchSent.at(-1)?.text === "\r", "enter from the empty line");

  // Mode switch
  await line.fill("unsent 한글 😀");
  await touchPage.getByRole("button", { name: "Type straight into the terminal", exact: true }).click();
  assert.equal(await touchPage.locator(".terminal-input").count(), 0);
  assert.equal(await touchPage.locator(".xterm-helper-textarea").getAttribute("inputmode"), null);
  await touchPage.getByRole("button", { name: "Type straight into the terminal", exact: true }).click();
  await line.waitFor();
  assert.equal(await line.inputValue(), "unsent 한글 😀", "mode switches preserve the unsent line");

  // Reload preserves draft
  await touchPage.reload();
  await line.waitFor();
  assert.equal(await line.inputValue(), "unsent 한글 😀", "reload preserves the unsent line");
  await line.fill("");
  assert.equal(await touchPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

  if (process.env.UI_EVIDENCE_DIR) {
    mkdirSync(process.env.UI_EVIDENCE_DIR, { recursive: true });
    await touchPage.screenshot({ path: join(process.env.UI_EVIDENCE_DIR, "terminal-input-mobile.png") });
  }
  if (touchEvidence) await touchEvidence.finish();
  await touch.close();
  console.log("PASS touch terminal input line sends whole lines, Enter alone, and yields to direct typing");

  assertClean(session, "terminal input tests");
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
