import { afterAll, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionSnapshot } from "../shared/protocol.ts";
import { DeviceStore } from "./devices.ts";
import { createServer } from "./index.ts";
import type { CatalogPaths } from "./local-catalog.ts";

// Synthetic catalogs and files only. No native terminal, credential source or user registry.
const dir = mkdtempSync(join(tmpdir(), "herdr-explorer-http-"));
const root = join(dir, "worktree");
mkdirSync(root);
writeFileSync(join(root, "main.cpp"), "int main() { return 0; }\n");
writeFileSync(join(root, ".env"), "private fixture");
writeFileSync(join(dir, "outside.txt"), "outside fixture");
symlinkSync(join(dir, "outside.txt"), join(root, "escape.txt"));
const paths: CatalogPaths = { configDir: join(dir, "config"), stateDir: join(dir, "themes"), cacheDir: join(dir, "cache"),
  projectsRoot: join(dir, "projects"), socket: join(dir, "fixture.sock") };
const project = join(paths.projectsRoot, "demo");
mkdirSync(join(project, ".state"), { recursive: true });
mkdirSync(join(project, "threads"));
writeFileSync(join(project, "PROJECT.md"), '+++\nname="Demo"\n+++\n');
writeFileSync(join(project, ".state/coordinator.json"), JSON.stringify({ socket: paths.socket, workspace_id: "w1", pane_id: "w1:p1" }));
writeFileSync(join(project, "threads/t-0042.toml"), 'id="t-0042"\ntitle="Thread"\nstatus="open"\npane_id="w2:p1"\nworkspace_id="w2"\nworktree_path=' + JSON.stringify(root) + "\n");
const stateDir = join(dir, "server");
const devices = new DeviceStore(stateDir);
const watcher = devices.pair(devices.startPairing().code, "Fixture watcher", "watch")!;
devices.match(watcher.token);
const snapshot: SessionSnapshot = { protocol: 22, version: "fixture", panes: [
  { pane_id: "w2:p1", workspace_id: "w2", tab_id: "w2:t1", terminal_id: "fixture", focused: false, revision: 1, agent_status: "idle", cwd: "/wrong-fixture-directory" },
], agents: [], workspaces: [], tabs: [], layouts: [] };
let snapshots = 0;
const server = createServer({ port: 0, token: "fixture-token", stateDir, machines: false, tailscaleOwner: null,
  customization: { paths, snapshot: async () => { snapshots++; return snapshot; } } });
afterAll(() => { server.stop(); rmSync(dir, { recursive: true, force: true }); });
const base = "http://127.0.0.1:" + server.port;
const context = new URLSearchParams({ machine: "local", project: "demo", thread: "t-0042", workspace: "w2", pane: "w2:p1" });
const href = (action: string, path = "", extra: Record<string, string> = {}) => {
  const query = new URLSearchParams(context);
  query.set("path", path);
  for (const [key, value] of Object.entries(extra)) query.set(key, value);
  return base + "/api/workspace/explorer/" + action + "?" + query;
};
const headers = { authorization: "Bearer fixture-token" };

it("uses the recorded thread root for authenticated list, stat, file and download reads", async () => {
  const list = await fetch(href("list"), { headers });
  expect(list.status).toBe(200);
  expect((await list.json()).entries).toContainEqual({ name: "main.cpp", path: "main.cpp", kind: "file", size: 25 });
  const stat = await fetch(href("stat", "main.cpp"), { headers });
  expect(stat.status).toBe(200);
  expect(await stat.json()).toMatchObject({ path: "main.cpp", kind: "text" });
  const file = await fetch(href("file", "main.cpp"), { headers });
  expect(await file.text()).toBe("int main() { return 0; }\n");
  expect(file.headers.get("cache-control")).toContain("no-store");
  const download = await fetch(href("file", "main.cpp", { download: "1" }), { headers });
  expect(download.headers.get("content-disposition")).toContain("attachment");
  await download.arrayBuffer();
});

it("refuses authentication, watching devices, cross-site probes and remote contexts before source reads", async () => {
  const before = snapshots;
  expect((await fetch(href("list"))).status).toBe(401);
  for (const action of ["list", "stat", "file"]) {
    const response = await fetch(href(action, action === "list" ? "" : "main.cpp"), { headers: {
      "content-type": "application/json", "x-herdr-machine": "1", cookie: "herdr_web_device=" + watcher.token,
    } });
    expect(response.status).toBe(403);
  }
  expect((await fetch(href("list"), { headers: { ...headers, "sec-fetch-site": "cross-site", "sec-fetch-mode": "no-cors" } })).status).toBe(403);
  const remote = await fetch(href("list", "", { machine: "remote" }), { headers });
  expect(remote.status).toBe(409);
  expect(await remote.json()).toMatchObject({ error: { code: "remote_unavailable" } });
  expect(snapshots).toBe(before);
});

it("refuses forged identity, arbitrary roots, traversal, escaped links and private configuration", async () => {
  const forged: Record<string, string>[] = [{ project: "other" }, { workspace: "w99" }, { pane: "w99:p1" }, { root }, { directory: root }];
  for (const extra of forged) {
    expect((await fetch(href("list", "", extra), { headers })).status).toBe(403);
  }
  for (const path of ["../outside.txt", "escape.txt", ".env"]) {
    const response = await fetch(href("file", path), { headers });
    expect(response.status).toBe(403);
    const body = await response.text();
    expect(body).not.toContain(dir);
    expect(body).not.toContain("private fixture");
  }
});
