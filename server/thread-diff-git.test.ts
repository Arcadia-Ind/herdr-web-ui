import { afterAll, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoDiffFile, repoDiffFiles } from "./repo-diff.ts";
import { ThreadDiffCache } from "./thread-diffs.ts";

const root = mkdtempSync(join(tmpdir(), "herdr-thread-git-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const git = (dir: string, ...args: string[]) => {
  const result = Bun.spawnSync(["git", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "-C", dir, ...args], { env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" }, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode) throw new Error(result.stderr.toString());
};
it("counts staged and unstaged changes against HEAD and opens the same combined patch", async () => {
  const dir = join(root, "committed");
  mkdirSync(dir); git(dir, "init", "-q", "-b", "main");
  writeFileSync(join(dir, "code.txt"), "first\nsecond\nthird\n");
  git(dir, "add", "."); git(dir, "commit", "-qm", "fixture");
  writeFileSync(join(dir, "code.txt"), "FIRST\nsecond\nthird\n");
  git(dir, "add", ".");
  writeFileSync(join(dir, "code.txt"), "FIRST\nSECOND\nthird\n");
  writeFileSync(join(dir, "new.txt"), "not counted yet\n");
  const summary = await new ThreadDiffCache().summary(dir);
  expect(summary).toMatchObject({ state: "ready", additions: 2, deletions: 2, untracked: 1, files: 2, partial: true });
  const patch = await repoDiffFile(dir, new URLSearchParams({ scope: "combined", path: "code.txt" }));
  expect(patch.file).toMatchObject({ additions: 2, deletions: 2 });
  expect(patch.patch).toContain("+FIRST");
  expect(patch.patch).toContain("+SECOND");
});
it("does not call a staged-only or unborn repository clean", async () => {
  const dir = join(root, "unborn");
  mkdirSync(dir); git(dir, "init", "-q", "-b", "main");
  writeFileSync(join(dir, "code.txt"), "first\n");
  git(dir, "add", ".");
  writeFileSync(join(dir, "code.txt"), "first\nsecond\n");
  const list = await repoDiffFiles(dir, new URLSearchParams({ scope: "combined" }));
  expect(list.files[0]).toMatchObject({ path: "code.txt", additions: 2, deletions: 0 });
  git(dir, "add", ".");
  expect(await new ThreadDiffCache().summary(dir)).toMatchObject({ state: "ready", additions: 2, files: 1 });
});
