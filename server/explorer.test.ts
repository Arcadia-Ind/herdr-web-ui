import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ProjectCatalog } from "../shared/customization.ts";
import type { SessionSnapshot } from "../shared/protocol.ts";
import { declaredExplorerPairs, explorerFile, explorerList, explorerResponse, explorerStat, resolveExplorerRoot } from "./explorer.ts";

let root: string;
let outside: string;
const context = { machine: "local", project: "demo", workspace: "w2", thread: "t-0001", pane: "w2:p1" };
let catalog: ProjectCatalog;
let snapshot: SessionSnapshot;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "explorer-root-"));
  outside = await mkdtemp(join(tmpdir(), "explorer-outside-"));
  await writeFile(join(root, "hello.ts"), "const answer = 42;\n");
  await writeFile(join(outside, "private.txt"), "DO NOT READ");
  catalog = { partial: false, projects: [{ id: "demo", name: "Demo", workspace_id: "w1", coordinators: [{ pane_id: "w1:p1", workspace_id: "w1" }],
    threads: [{ id: "t-0001", title: "Task", lifecycle: "open", pane_id: "w2:p1", workspace_id: "w2", directory: root }] }] };
  snapshot = { panes: [{ pane_id: "w2:p1", workspace_id: "w2", cwd: root }, { pane_id: "w1:p1", workspace_id: "w1", cwd: outside }] } as SessionSnapshot;
});
afterEach(async () => { await Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]); });

const request = (suffix: string, extra = "", init?: RequestInit): Request =>
  new Request("http://fixture/api/workspace/explorer/" + suffix + "?machine=local&project=demo&workspace=w2&thread=t-0001&pane=w2:p1" + extra, init);
const respond = (req: Request) => explorerResponse(req, { canRead: true, catalog: async () => catalog, snapshot: async () => snapshot });

describe("workspace authority", () => {
  it("resolves a registered thread and rejects foreign project, workspace, thread and pane identities", () => {
    expect(resolveExplorerRoot(context, catalog, snapshot)).toBe(root);
    for (const change of [{ project: "other" }, { workspace: "w1" }, { thread: "t-9999" }, { pane: "w1:p1" }]) expect(() => resolveExplorerRoot({ ...context, ...change }, catalog, snapshot)).toThrow();
    expect(() => resolveExplorerRoot(context, catalog, { panes: [{ pane_id: "w2:p1", workspace_id: "w9" }] } as SessionSnapshot)).toThrow();
  });
  it("retains a recorded thread after its pane closes, without falling back to another folder", () => {
    expect(resolveExplorerRoot(context, catalog, { panes: [] } as unknown as SessionSnapshot)).toBe(root);
    catalog.projects[0]!.threads[0]!.directory = null;
    expect(() => resolveExplorerRoot(context, catalog, { panes: [] } as unknown as SessionSnapshot)).toThrow();
  });
  it("resolves coordinator views only through a matching current pane", () => {
    expect(resolveExplorerRoot({ ...context, thread: null, workspace: "w1", pane: "w1:p1" }, catalog, snapshot)).toBe(outside);
    expect(() => resolveExplorerRoot({ ...context, thread: null }, catalog, snapshot)).toThrow();
  });
});

describe("safe file access", () => {
  it("refuses traversal, absolute paths, sibling prefixes and symlinks outside the root", async () => {
    await symlink(outside, join(root, "escape"));
    for (const path of ["../private.txt", outside + "/private.txt", "escape/private.txt", "a/../../private.txt", "C:/private.txt"]) await expect(explorerStat(root, path)).rejects.toThrow();
    const listing = await explorerList(root);
    expect(listing.entries.find((entry) => entry.name === "escape")?.kind).toBe("blocked");
    expect(JSON.stringify(listing)).not.toContain(outside);
  });
  it("allows contained links but denies a link into private configuration", async () => {
    await symlink(join(root, "hello.ts"), join(root, "alias.ts"));
    expect((await explorerStat(root, "alias.ts")).kind).toBe("text");
    await mkdir(join(root, ".codex"));
    await writeFile(join(root, ".codex", "history.json"), "private");
    await symlink(join(root, ".codex", "history.json"), join(root, "history.json"));
    await expect(explorerStat(root, "history.json")).rejects.toThrow();
    await expect(explorerStat(root, ".codex/history.json")).rejects.toThrow();
    expect((await explorerList(root, "", true)).entries.some((entry) => entry.name === ".codex")).toBe(false);
  });
  it("rejects special files and reports missing partners without guessing another name", async () => {
    await mkdir(join(root, "folder"));
    await expect(explorerStat(root, "folder")).rejects.toThrow();
    const response = await respond(request("stat", "&path=software/pseudocode/hello.ts.md"));
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain(root);
  });
  it("detects binary data even in a source extension and gives an explicit unsupported result", async () => {
    await writeFile(join(root, "binary.ts"), Buffer.from([65, 0, 66]));
    expect((await explorerStat(root, "binary.ts")).kind).toBe("binary");
    await expect(explorerFile(root, "binary.ts", request("file", "&path=binary.ts"))).rejects.toThrow("no text preview");
    await writeFile(join(root, "invalid.txt"), Buffer.from([255, 254, 253]));
    expect((await explorerStat(root, "invalid.txt")).kind).toBe("unsupported");
    const refused = await respond(request("file", "&path=binary.ts"));
    expect(refused.status).toBe(415);
    expect(await refused.text()).toContain("unsupported_file");
    await writeFile(join(root, "report.pdf"), "%PDF-1.0\n");
    expect((await explorerStat(root, "report.pdf")).kind).toBe("unsupported");
  });
  it("uses only the declared Sim mapping, including scripts and retained extensions", async () => {
    await mkdir(join(root, "software", "src"), { recursive: true });
    await mkdir(join(root, "software", "pseudocode"));
    expect(await declaredExplorerPairs(root)).toEqual([]);
    await writeFile(join(root, "software", "DEVELOPMENT.md"), "Mirror descriptions using `src/<path>` to `pseudocode/<path>.md`.");
    expect(await declaredExplorerPairs(root)).toEqual([{ source: "software/src/", description: "software/pseudocode/", suffix: ".md" }]);
  });
  it("bounds directory enumeration and reports the cut", async () => {
    await Promise.all(Array.from({ length: 505 }, (_, index) => writeFile(join(root, "f" + index), "")));
    const listing = await explorerList(root);
    expect(listing.truncated).toBe(true);
    expect(listing.entries.length).toBeLessThanOrEqual(500);
  });
});

describe("read-only HTTP adapter", () => {
  it("rejects unknown roots, duplicate parameters, cross-site reads and writes before catalog access", async () => {
    let calls = 0;
    const dependencies = { canRead: true, catalog: async () => { calls++; return catalog; }, snapshot: async () => snapshot };
    for (const req of [request("list", "&root=/etc"), request("list", "&path=x&path=y"), request("list", "", { method: "POST" }), request("file", "&path=hello.ts", { headers: { "sec-fetch-site": "cross-site" } })]) {
      expect((await explorerResponse(req, dependencies)).status).toBeGreaterThanOrEqual(400);
    }
    expect(calls).toBe(0);
    expect((await explorerResponse(request("list"), { ...dependencies, canRead: false })).status).toBe(403);
    expect(calls).toBe(0);
  });
  it("returns only relative metadata and keeps responses private", async () => {
    const response = await respond(request("stat", "&path=hello.ts"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const text = await response.text();
    expect(text).not.toContain(root);
    expect(JSON.parse(text).path).toBe("hello.ts");
  });
  it("preserves byte limits, handles empty files, and streams explicit downloads", async () => {
    await writeFile(join(root, "large.txt"), Buffer.alloc(8 * 1024 * 1024 + 10, 65));
    const preview = await explorerFile(root, "large.txt", request("file", "&path=large.txt"));
    expect(preview.status).toBe(206);
    expect(preview.headers.get("content-range")).toBe("bytes 0-8388607/8388618");
    expect((await preview.arrayBuffer()).byteLength).toBe(8 * 1024 * 1024);
    const short = await explorerFile(root, "hello.ts", request("file", "&path=hello.ts", { headers: { range: "bytes=0-4" } }));
    expect(await short.text()).toBe("const");
    await writeFile(join(root, "empty"), "");
    expect(await (await explorerFile(root, "empty", request("file"))).text()).toBe("");
    const download = await explorerFile(root, "hello.ts", request("file", "&download=1"));
    expect(download.headers.get("content-disposition")).toContain("attachment");
    expect(await download.text()).toBe("const answer = 42;\n");
    const head = await explorerFile(root, "hello.ts", request("file", "", { method: "HEAD" }));
    expect(head.body).toBeNull();
    const invalid = await respond(request("file", "&path=hello.ts", { headers: { range: "bytes=10-20" } }));
    expect(invalid.status).toBe(416);
  });
  it("cancels a stream without keeping an owned descriptor open", async () => {
    const controller = new AbortController();
    const response = await explorerFile(root, "hello.ts", request("file", "", { signal: controller.signal }));
    controller.abort();
    await response.body?.cancel();
    expect((await respond(request("stat", "&path=hello.ts"))).status).toBe(200);
  });
  it("does not return filesystem errors, private paths, or catalog exception text", async () => {
    const response = await explorerResponse(request("list"), { canRead: true, catalog: async () => { throw new Error(outside + "/token"); }, snapshot: async () => snapshot });
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain(outside);
  });
});
