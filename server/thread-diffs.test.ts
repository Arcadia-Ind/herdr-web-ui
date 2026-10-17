import { expect, it } from "bun:test";
import type { RepoDiffFileList, SessionSnapshot } from "../shared/protocol.ts";
import { RepoDiffError } from "./repo-diff.ts";
import { ThreadDiffCache, threadDiffBatch } from "./thread-diffs.ts";

const list: RepoDiffFileList = {
  repository: { root: "/fixture", branch: "main", head: "abc", detached: false, unborn: false },
  scope: "workspace", base: null, head: null, total: 3, truncated: false, limits: { max_files: 100, max_list_bytes: 1000 },
  files: [
    { path: "edit", old_path: null, status: "modified", additions: 8, deletions: 3, binary: false },
    { path: "new", old_path: null, status: "untracked", additions: null, deletions: null, binary: null },
    { path: "image", old_path: null, status: "modified", additions: null, deletions: null, binary: true },
  ],
};
it("shares reads and reports unknown lines without calling them clean", async () => {
  let calls = 0, now = 0;
  const cache = new ThreadDiffCache(async () => { calls++; return list; }, () => now, 100);
  const [a, b] = await Promise.all([cache.summary("/a"), cache.summary("/a")]);
  expect(a).toEqual({ state: "ready", additions: 8, deletions: 3, untracked: 1, files: 3, partial: true });
  expect(b).toEqual(a);
  expect(calls).toBe(1);
  await cache.summary("/a"); expect(calls).toBe(1);
  now = 101;
  await cache.summary("/a"); expect(calls).toBe(2);
});
it("caches no-repository results and separates unavailable directories", async () => {
  const cache = new ThreadDiffCache(async () => { throw new RepoDiffError("not_a_repository", "fixture", 409); });
  expect((await cache.summary("/not-git")).state).toBe("no-repo");
  expect((await cache.summary(null)).state).toBe("no-directory");
  const failed = new ThreadDiffCache(async () => { throw new Error("private stderr"); });
  expect((await failed.summary("/broken")).state).toBe("unavailable");
  expect(JSON.stringify(await failed.summary("/broken"))).not.toContain("stderr");
});
it("limits simultaneous git work to two and evicts old cache entries", async () => {
  let active = 0, peak = 0, calls = 0;
  const releases: (() => void)[] = [];
  const cache = new ThreadDiffCache(async () => { calls++; peak = Math.max(peak, ++active); await new Promise<void>((resolve) => releases.push(resolve)); active--; return list; }, Date.now, 15000, 3);
  const work = ["/a", "/b", "/c"].map((path) => cache.summary(path));
  await Promise.resolve(); await Promise.resolve();
  expect(peak).toBe(2);
  releases.shift()!(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  while (releases.length) releases.shift()!();
  await Promise.all(work);
  expect(calls).toBe(3);
  expect(peak).toBe(2);
});
it("does not scan a stale pane identity", async () => {
  let calls = 0;
  const cache = new ThreadDiffCache(async () => { calls++; return list; });
  const catalog = { partial: false, projects: [{ id: "demo", name: "Demo", workspace_id: "w1", coordinators: [], threads: [{ id: "t-0001", title: "Task", lifecycle: "open" as const, pane_id: "w2:p1", workspace_id: "w2", directory: "/recorded" }] }] };
  const snapshot = { panes: [{ pane_id: "w2:p1", workspace_id: "w9" }] } as SessionSnapshot;
  expect((await threadDiffBatch(catalog, snapshot, ["w2:p1"], cache)).summaries["w2:p1"]?.state).toBe("missing");
  expect(calls).toBe(0);
});
