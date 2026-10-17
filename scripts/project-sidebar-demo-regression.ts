import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { buildDemoApp } from "./demo-build.ts";
import { chromePath } from "./chrome-path.ts";

// The real client over fictional transports only. No native session, user profile or draft.
const app = mkdtempSync(join(tmpdir(), "herdr-project-sidebar-"));
const evidence = process.env["UI_EVIDENCE_DIR"];
const fixture = `(() => {
  const original = window.fetch.bind(window);
  window.customizationReads = [];
  const json = (value) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
    const path = url.pathname.replace(/^\\/api\\/machines\\/[^/]+/, "/api");
    window.customizationReads.push(url.pathname + url.search);
    if (path === "/api/themes") return json({ partial: false, themes: [
      { id: "fixture-night", name: "My night", mode: "dark", colors: { panel_bg: "#101020", text: "#eeeeff", accent: "#aa88ff" } },
      { id: "fixture-day", name: "My day", mode: "light", colors: { panel_bg: "#fafafa", text: "#202030", accent: "#3355aa" } }
    ] });
    if (path === "/api/workspace/projects") return json({ partial: false, projects: [{
      id: "demo-project", name: "Demo Project", workspace_id: "w1C",
      coordinators: [{ pane_id: "w1C:p1", workspace_id: "w1C" }],
      threads: [
        { id: "t-0042", title: "Review the web change", lifecycle: "open", pane_id: "w1D:p1", workspace_id: "w1D", directory: "/home/demo/thread-web" },
        { id: "t-0043", title: "Write the guide", lifecycle: "open", pane_id: "w1F:p1", workspace_id: "w1F", directory: "/home/demo/docs" },
        { id: "t-0044", title: "Inspect a folder", lifecycle: "open", pane_id: "w1E:p1", workspace_id: "w1E", directory: "/home/demo/no-repo" },
        { id: "t-0045", title: "A stopped thread", lifecycle: "failed", pane_id: "w99:p1", workspace_id: "w99", directory: null }
      ]
    }] });
    if (path === "/api/workspace/diff/summaries") return json({ refreshed_at: Date.now(), summaries: {
      "w1D:p1": { state: "ready", additions: 8, deletions: 3, untracked: 1, files: 3, partial: true },
      "w1F:p1": { state: "ready", additions: 0, deletions: 0, untracked: 0, files: 0, partial: false },
      "w1E:p1": { state: "no-repo", additions: 0, deletions: 0, untracked: 0, files: 0, partial: false }
    } });
    return original(input, init);
  };
})();`;

try {
  await buildDemoApp(app);
  writeFileSync(join(app, "customization-fixture.js"), fixture);
  const index = join(app, "index.html");
  writeFileSync(index, readFileSync(index, "utf8").replace(/<script type="module"/, '<script src="./demo-transport.js"></script><script src="./customization-fixture.js"></script><script type="module"'));
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const path = new URL(request.url).pathname.slice(1) || "index.html";
    if (path.includes("..") || path.includes("\\")) return new Response("bad path", { status: 400 });
    const file = Bun.file(join(app, path));
    return await file.exists() ? new Response(file) : new Response("not found", { status: 404 });
  } });
  try {
    const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
    try {
      for (const width of [1280, 390]) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, locale: "en-US" });
        try {
          await context.addInitScript(() => {
            if (!localStorage.getItem("herdr-web-ui:settings")) localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en", herdrTheme: "fixture-night" }));
          });
          const page = await context.newPage();
          const errors: string[] = [];
          page.on("pageerror", (error) => errors.push(error.message));
          await page.goto(`http://127.0.0.1:${server.port}/?pane=w1D%3Ap1`);
          const openDrawer = async () => { if (width < 769 && !await page.locator(".sidebar").evaluate((node) => node.classList.contains("is-open"))) await page.getByRole("button", { name: "Open workspace list", exact: true }).click(); };
          await openDrawer();
          const group = page.locator('.project-group[data-project="demo-project"]');
          const thread = group.locator('[data-thread="t-0042"]');
          await thread.getByText("+8 −3 · ?1 *", { exact: true }).waitFor();
          assert.equal(await group.locator('[data-thread="t-0043"] .thread-diff-count').textContent(), "Clean");
          assert.equal(await group.locator('[data-thread="t-0044"] .thread-diff-count').textContent(), "No repository");
          assert.equal(await group.locator('[data-thread="t-0045"] .project-thread-select').isDisabled(), true);
          assert.equal(await page.locator('.workspace-group[data-workspace="w1D"], .agents-sidebar [data-pane="w1D:p1"]').count(), 0);
          assert.equal(await thread.locator(".project-thread-select").getAttribute("aria-current"), "page");
          await page.waitForFunction(() => document.documentElement.dataset.theme === "dark" && getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() === "#101020");

          await page.getByRole("button", { name: "Compact sidebar", exact: true }).click();
          assert.equal(await thread.locator(".thread-title").isVisible(), false);
          assert.match(await thread.locator(".project-thread-select").getAttribute("aria-label") ?? "", /Review the web change/);
          assert.equal(Math.round((await page.locator(".sidebar").boundingBox())!.width), 180);
          if (evidence) { mkdirSync(evidence, { recursive: true }); await page.screenshot({ path: join(evidence, `project-sidebar-${width}-compact.png`) }); }
          await group.getByRole("button", { name: "Collapse Demo Project", exact: true }).click();
          await page.reload(); await openDrawer();
          assert.equal(await group.locator(".project-threads").isVisible(), false);
          assert.equal(await page.locator("html").getAttribute("data-sidebar-compact"), "true");
          await group.getByRole("button", { name: "Expand Demo Project", exact: true }).click();
          await page.getByRole("button", { name: "Expand sidebar labels", exact: true }).click();
          assert.equal(await thread.locator(".thread-title").isVisible(), true);
          assert.equal(await thread.locator(".project-thread-select").getAttribute("aria-current"), "page");
          await thread.locator(".thread-diff").click();
          await page.locator(".repo-changes").waitFor();
          const reads = await page.evaluate(() => (window as unknown as { customizationReads: string[] }).customizationReads);
          assert.ok(reads.some((url) => url.includes("diff/files?") && url.includes("pane_id=w1D%3Ap1") && url.includes("directory=%2Fhome%2Fdemo%2Fthread-web")), "Changes is bound to the requested thread directory");
          await page.locator(".repo-change").first().click();
          await page.locator(".repo-diff-viewer").waitFor();
          await page.getByRole("button", { name: "Close diff", exact: true }).click();
          await page.getByRole("button", { name: "Close files", exact: true }).click();
          await openDrawer();
          await page.getByRole("button", { name: "Settings", exact: true }).click();
          const appearance = page.getByRole("tab", { name: "Appearance", exact: true });
          if (await appearance.count()) await appearance.click();
          await page.locator("#settings-herdr-theme").selectOption("fixture-day");
          await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
          await page.reload();
          await page.waitForFunction(() => document.documentElement.dataset.theme === "light" && getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() === "#fafafa");
          const settingsClose = page.getByRole("button", { name: "Close settings", exact: true });
          if (await settingsClose.count()) await settingsClose.click();
          await openDrawer();
          if (evidence) await page.screenshot({ path: join(evidence, `project-sidebar-${width}-expanded.png`) });
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
          assert.deepEqual(errors, []);
          console.log(`PASS ${width}px: groups, selection, folds, compact labels, themes, diff target and layout`);
        } finally { await context.close(); }
      }
    } finally { await browser.close(); }
  } finally { server.stop(true); }
} finally { rmSync(app, { recursive: true, force: true }); }
