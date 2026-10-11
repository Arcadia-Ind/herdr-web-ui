/**
 * UI regression tests: Settings, sidebar, alerts, updates, and various feature checks.
 * Part 3 of the split ui-regression suite.
 */
import "./test-herdr.ts";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { herdrRpc } from "../server/herdr/client.ts";
import { alertsOffMarked, alertsState, runMoreItem } from "./header-more.ts";
import { checkPushSettings } from "./push-settings-regression.ts";
import { checkWakeLock } from "./wake-lock-regression.ts";
import { checkSecretInput } from "./secret-input-regression.ts";
import { checkTerminalCopy } from "./terminal-copy-regression.ts";
import { checkPaneFind } from "./pane-find-regression.ts";
import { checkUsageMeters } from "./usage-regression.ts";
import { checkNotificationStartup } from "./notification-startup-regression.ts";
import { checkNotificationView } from "./notification-view-regression.ts";
import { checkMobileViewport } from "./mobile-viewport-regression.ts";
import { checkTerminalPinch } from "./terminal-pinch-regression.ts";
import { checkMobileTabs } from "./mobile-tabs-regression.ts";
import { checkTabMenu } from "./tab-menu-regression.ts";
import { checkDefaultView } from "./default-view-regression.ts";
import { checkComposerReconnect } from "./composer-reconnect-regression.ts";
import { checkDroplet } from "./droplet-regression.ts";
import { checkTakeOver } from "./take-over-regression.ts";
import { checkAlertSound } from "./alert-sound-regression.ts";
import { checkBackgroundTabKeepsTerminalSize, checkChatKeepsTerminalSize, checkPaneSwitchKeepsTerminalSize } from "./chat-size-regression.ts";
import { checkUpdateNotice } from "./update-notice-regression.ts";
import { openSettingsPage } from "./settings-page.ts";
import { watchCsp, assertCspClean } from "./csp-violations.ts";
import {
  createTestSession,
  closeTestSession,
  createDesktopPage,
  watchBrowserEvidence,
  until,
  createWsTracker,
  type TestSession,
} from "./ui-regression-shared.ts";

const session = await createTestSession({ name: "herdr-web-ui-settings", labelSuffix: "settings" });
const { origin, browser, paneA, paneB, csp, errors } = session;

try {
  const { context, page } = await createDesktopPage(session, { panes: [paneA, paneB] });
  const pageEvidence = await watchBrowserEvidence(session, context, page, "settings-main");
  const { painted } = createWsTracker(page);

  await page.goto(`${origin}/?pane=${encodeURIComponent(paneA)}`);
  await page.locator(".conn-live").waitFor();
  await until(() => painted.has(paneA), "owned pane paint");

  // Settings shortcut and theme
  await page.keyboard.press("ControlOrMeta+Shift+Comma");
  await page.getByRole("dialog", { name: "Settings" }).waitFor();
  await page.getByRole("button", { name: "Light", exact: true }).click();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
  await page.getByRole("button", { name: "Close settings", exact: true }).click();
  console.log("PASS settings shortcut and theme");

  // Add PC from Settings → Remote PCs
  assert.equal(await page.locator(".sidebar").getByRole("button", { name: "Add PC", exact: true }).count(), 0, "the sidebar has no Add PC button");
  await page.keyboard.press("ControlOrMeta+Shift+Comma");
  await openSettingsPage(page, "Remote PCs");
  await page.getByRole("dialog", { name: "Settings" }).getByRole("button", { name: "Add PC", exact: true }).click();
  await page.getByRole("dialog", { name: "Add PC", exact: true }).waitFor();
  assert.equal(await page.getByRole("dialog", { name: "Settings" }).count(), 0, "Add PC closes Settings");
  await page.getByRole("button", { name: "Close PC setup", exact: true }).click();
  await page.getByRole("dialog", { name: "Add PC", exact: true }).waitFor({ state: "hidden" });
  await until(async () => await page.evaluate(() => document.activeElement?.matches(".sidebar-toggle, .drawer-toggle") ?? false), "focus returns to the workspace-list toggle after Add PC closes");
  console.log("PASS Add PC opens from Settings, and the sidebar has no top bar");

  // Sidebar resize
  const sidebarWidths = () => page.evaluate(() => ({
    sidebar: Math.round(document.querySelector(".sidebar")!.getBoundingClientRect().width),
    header: Math.round(document.querySelector(".header-side")!.getBoundingClientRect().width),
    stored: localStorage.getItem("herdr-web-ui:sidebar-width"),
  }));
  const defaultWidths = await sidebarWidths();
  assert.equal(defaultWidths.stored, null, "no sidebar width is stored before the edge is dragged");
  const resizer = page.getByRole("separator", { name: "Resize sidebar", exact: true });
  const edge = (await resizer.boundingBox())!;
  await page.mouse.move(edge.x + edge.width / 2, 400);
  await page.mouse.down();
  await page.mouse.move(edge.x + edge.width / 2 + 80, 400, { steps: 4 });
  await page.mouse.up();
  const dragged = await sidebarWidths();
  assert.equal(dragged.sidebar, defaultWidths.sidebar + 80, "the sidebar follows its dragged edge");
  assert.equal(dragged.header, dragged.sidebar, "the sidebar's top row in the header keeps the sidebar's width");
  assert.equal(dragged.stored, String(dragged.sidebar), "the dragged width is kept on this device");
  await resizer.focus();
  await page.keyboard.press("ArrowLeft");
  assert.equal((await sidebarWidths()).sidebar, dragged.sidebar - 16, "an arrow key moves the focused edge one step");
  assert.equal(await resizer.getAttribute("aria-valuenow"), String(dragged.sidebar - 16));

  const wide = page.viewportSize()!;
  await page.setViewportSize({ width: 900, height: wide.height });
  await until(async () => await resizer.getAttribute("aria-valuemax") === "450", "the edge's upper limit follows the window");
  await page.setViewportSize(wide);
  await until(async () => await resizer.getAttribute("aria-valuemax") !== "450", "the limit returns with the window");
  await resizer.dblclick();
  assert.deepEqual(await sidebarWidths(), defaultWidths, "a double-click goes back to the default width and forgets the stored one");
  console.log("PASS the sidebar's edge drags, steps from the keyboard, remembers its width and resets on a double-click");

  // Sidebar rows setting
  const twoLineHeight = await page.locator(".workspace-header").first().evaluate((row) => row.getBoundingClientRect().height);
  assert.ok(await page.locator(".workspace-copy.is-two-line").count() > 0, "rows are two lines until one is chosen");
  await page.keyboard.press("ControlOrMeta+Shift+Comma");
  const rowsSetting = page.locator('.settings-dialog .segmented[aria-label="Sidebar rows"]');
  await rowsSetting.getByRole("button", { name: "One line", exact: true }).click();
  await page.locator(".workspace-copy.is-two-line").first().waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("herdr-web-ui:settings") ?? "{}").sidebarRows), "one");
  assert.ok(await page.locator(".workspace-header").first().evaluate((row) => row.getBoundingClientRect().height) < twoLineHeight, "a one-line row is shorter");
  await rowsSetting.getByRole("button", { name: "Two lines", exact: true }).click();
  await page.locator(".workspace-copy.is-two-line").first().waitFor();
  await rowsSetting.getByRole("button", { name: "One line", exact: true }).click();
  await page.locator(".workspace-copy.is-two-line").first().waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Close settings", exact: true }).click();
  console.log("PASS sidebar rows switch between one line and two");

  // Update check while page is hidden
  let releaseCheck!: () => void;
  const checkGate = new Promise<void>((resolve) => { releaseCheck = resolve; });
  const idleStatus = { managed: true, auto_update: false, phase: "idle", current_revision: null, latest_revision: null, current_version: "0.0.0", latest_version: "0.0.0", available: false, checked_at: new Date().toISOString(), blocked_reason: null, error: null };
  await page.route("**/api/updates", (route) => route.fulfill({ json: idleStatus }));
  await page.route("**/api/updates/check", async (route) => { await checkGate; await route.fulfill({ json: { ok: true } }); });
  const setPageHidden = (hidden: boolean) => page.evaluate((hidden) => {
    if (hidden) Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    else delete (document as unknown as Record<string, unknown>).visibilityState;
    document.dispatchEvent(new Event("visibilitychange"));
    return new Promise<void>((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => resolve();
      channel.port2.postMessage(null);
    });
  }, hidden);

  for (const deadline = Date.now() + 10_000; ;) {
    const restarted = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/updates", { timeout: 2_000 }).then(() => true, () => false);
    await setPageHidden(true);
    await setPageHidden(false);
    if (await restarted) break;
    assert.ok(Date.now() < deadline, "a hide and a show restart the update status poll");
  }
  await page.keyboard.press("ControlOrMeta+Shift+Comma");
  await openSettingsPage(page, "About");
  const checkUpdates = page.getByRole("dialog", { name: "Settings" }).getByRole("button", { name: "Check for updates", exact: true });
  await checkUpdates.waitFor();
  await checkUpdates.click();
  await until(() => checkUpdates.isDisabled(), "the check is pending");
  await setPageHidden(true);
  releaseCheck();
  await page.waitForTimeout(300);
  await setPageHidden(false);
  await until(async () => !(await checkUpdates.isDisabled()), "an answer that came while hidden releases the update buttons");
  await page.getByRole("button", { name: "Close settings", exact: true }).click();
  await page.unroute("**/api/updates/check");
  await page.unroute("**/api/updates");
  console.log("PASS an update answer that arrives while the page is hidden releases the buttons");

  // Alerts toggle
  assert.equal(await page.locator(".app-header .bell-button, .app-header .new-tab-button, .app-header .files-button").count(), 0, "the three actions are the More menu's items");
  assert.equal(await alertsState(page), "On in the app");
  assert.equal(await alertsOffMarked(page), false, "alerts that are on leave the More button unmarked");
  await context.grantPermissions(["notifications"], { origin });
  await runMoreItem(page, "Alerts");
  await until(async () => await alertsState(page) !== "On in the app", "the item's tap takes the permission");
  assert.match(await alertsState(page), /^On[ ,]/);
  assert.equal(await alertsOffMarked(page), false);
  await runMoreItem(page, "Alerts");
  await until(async () => await alertsState(page) === "Off on this device", "alerts off");
  assert.equal(await alertsOffMarked(page), true, "alerts that are off mark the More button");
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("herdr-web-ui:settings") ?? "{}").alertsOn), false);
  assert.equal(await page.evaluate(async () => (await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription()) ?? null), null, "turning alerts off drops the push subscription");
  await runMoreItem(page, "Alerts");
  await until(async () => /^On[ ,]/.test(await alertsState(page)), "alerts on again");
  assert.equal(await alertsOffMarked(page), false);
  console.log("PASS the Alerts item turns alerts off and on again");

  // Blocked notifications context
  const blocked = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await blocked.addInitScript(() => {
    if (!localStorage.getItem("herdr-web-ui:settings")) localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en" }));
    Object.defineProperty(Notification, "permission", { configurable: true, get: () => "denied" });
  });
  const blockedPage = await blocked.newPage();
  const blockedEvidence = await watchBrowserEvidence(session, blocked, blockedPage, "blocked-notifications");
  session.csp.push(await watchCsp(blockedPage));
  await blockedPage.goto(origin);
  await blockedPage.locator(".header-more-button").waitFor();
  assert.equal(await alertsState(blockedPage), "On in the app");
  assert.equal(await alertsOffMarked(blockedPage), false);
  await runMoreItem(blockedPage, "Alerts");
  await until(async () => await alertsState(blockedPage) === "Off on this device", "blocked alerts off");
  assert.equal(await alertsOffMarked(blockedPage), true);
  assert.equal(await blockedPage.evaluate(() => JSON.parse(localStorage.getItem("herdr-web-ui:settings") ?? "{}").alertsOn), false);
  await runMoreItem(blockedPage, "Alerts");
  await until(async () => await alertsState(blockedPage) === "On in the app", "blocked alerts on again");
  assert.equal(await alertsOffMarked(blockedPage), false);
  if (blockedEvidence) await blockedEvidence.finish();
  await blocked.close();
  console.log("PASS a device that blocks notifications keeps the Alerts item as the switch for in-app alerts");

  // Run all the check functions
  await checkPushSettings(browser, origin);
  await checkWakeLock(browser, origin, paneA);
  await checkSecretInput(browser, origin);
  await checkTerminalCopy(browser, origin);
  await checkPaneFind(browser, origin);
  await checkUsageMeters(browser, origin);
  await checkNotificationStartup(browser, origin, paneA, paneB);
  await checkNotificationView(browser, origin);
  await checkMobileViewport(browser, origin, paneB);
  await checkTerminalPinch(browser, origin, paneB);
  await checkMobileTabs(browser, origin);
  await checkTabMenu(browser, origin);
  await checkDefaultView(browser, origin);
  await checkComposerReconnect(browser, origin, paneB);
  await checkDroplet(browser, origin);
  await checkTakeOver(browser, origin);
  await checkAlertSound(browser, origin);
  await checkChatKeepsTerminalSize(browser, origin);
  await checkPaneSwitchKeepsTerminalSize(browser, origin);
  await checkBackgroundTabKeepsTerminalSize(browser, origin);
  await checkUpdateNotice(browser, origin);

  assert.equal(errors.length, 0, errors.join("\n"));
  assertCspClean(session.csp, "settings and feature tests");
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
