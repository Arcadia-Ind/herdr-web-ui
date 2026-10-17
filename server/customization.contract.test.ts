import { afterAll, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionSnapshot } from "../shared/protocol.ts";
import { createServer } from "./index.ts";
import type { CatalogPaths } from "./local-catalog.ts";
import { ThreadDiffCache } from "./thread-diffs.ts";

// Every path and snapshot belongs to this fixture; no native Herdr process is needed.
const dir = mkdtempSync(join(tmpdir(), "web-customization-http-"));
const paths: CatalogPaths = { configDir: join(dir, "config"), stateDir: join(dir, "theme-state"), cacheDir: join(dir, "cache"), projectsRoot: join(dir, "projects"), socket: join(dir, "fixture.sock") };
const project = join(paths.projectsRoot, "demo");
mkdirSync(join(project, ".state"), { recursive: true });
mkdirSync(join(project, "threads"));
mkdirSync(paths.configDir);
writeFileSync(join(project, "PROJECT.md"), '+++\nname="Demo"\n+++\nprivate body');
writeFileSync(join(project, ".state/coordinator.json"), JSON.stringify({ socket: paths.socket, workspace_id: "w1C", pane_id: "w1C:p1", agent_args: ["private"] }));
writeFileSync(join(project, "threads/t-0042.toml"), 'id="t-0042"\ntitle="Thread"\nstatus="open"\npane_id="w1D:p1"\nworkspace_id="w1D"\nworktree_path="/fixture/thread"\n');
writeFileSync(join(paths.configDir, "config.toml"), '[auth]\nsecret="private"\n[theme]\nname="Test"\n[theme.custom]\npanel_bg="#ffffff"\ntext="#222222"\n');
const snapshot: SessionSnapshot = { protocol: 22, version: "fixture", panes: [{ pane_id: "w1D:p1", workspace_id: "w1D", tab_id: "w1D:t1", terminal_id: "fixture", focused: false, revision: 1, agent_status: "idle", cwd: "/wrong-cwd" }], agents: [], workspaces: [], tabs: [], layouts: [] };
let reads = 0;
const server = createServer({
  port: 0, token: "fixture-token", stateDir: join(dir, "server-state"), machines: false, tailscaleOwner: null,
  customization: { paths, snapshot: async () => snapshot, diffs: new ThreadDiffCache(async (directory) => {
    reads++; expect(directory).toBe("/fixture/thread");
    return { repository: { root: directory, branch: "main", head: "abc", unborn: false, detached: false }, scope: "workspace", base: null, head: null, files: [], total: 0, truncated: false, limits: { max_files: 1, max_list_bytes: 1 } };
  }) },
});
afterAll(() => { server.stop(); rmSync(dir, { recursive: true, force: true }); });
const request = (path: string, options: RequestInit = {}) => fetch(new URL(path, `http://127.0.0.1:${server.port}`), { ...options, headers: { authorization: "Bearer fixture-token", ...options.headers } });

it("serves sanitized catalogs behind the existing authentication gate", async () => {
  expect((await fetch(new URL("/api/themes", `http://127.0.0.1:${server.port}`))).status).toBe(401);
  for (const path of ["/api/themes", "/api/workspace/projects"]) {
    const response = await request(path);
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain("private");
  }
});
it("accepts native alphanumeric pane IDs and uses the recorded thread directory", async () => {
  const response = await request("/api/workspace/diff/summaries?pane_ids=w1D:p1");
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.summaries["w1D:p1"]).toMatchObject({ state: "ready", files: 0, additions: 0, deletions: 0 });
  await request("/api/workspace/diff/summaries?pane_ids=w1D:p1");
  expect(reads).toBe(1);
});
it("bounds batches, refuses cross-site reads, and starts no scan for missing members", async () => {
  expect((await request("/api/workspace/diff/summaries?pane_ids=w1:p1,w1:p1")).status).toBe(400);
  expect((await request("/api/workspace/diff/summaries?pane_ids=" + Array.from({ length: 9 }, (_, i) => "w" + i + ":p1").join(","))).status).toBe(400);
  expect((await request("/api/themes", { headers: { "sec-fetch-site": "cross-site" } })).status).toBe(403);
  expect((await request("/api/workspace/projects", { method: "POST" })).status).not.toBe(200);
  const missing = await (await request("/api/workspace/diff/summaries?pane_ids=w9:p1")).json();
  expect(missing.summaries["w9:p1"].state).toBe("missing");
  expect(reads).toBe(1);
});
