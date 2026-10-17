import type { ProjectCatalog, ThreadDiffBatch, ThreadDiffSummary } from "../shared/customization.ts";
import type { SessionSnapshot } from "../shared/protocol.ts";
import { repoDiffFiles, RepoDiffError } from "./repo-diff.ts";

export const DIFF_REFRESH_MS = 15_000;
const EMPTY = { additions: 0, deletions: 0, untracked: 0, files: 0, partial: false };
export const missingDiff = (state: ThreadDiffSummary["state"]): ThreadDiffSummary => ({ ...EMPTY, state });

/** At most two git listings at once, shared by all clients. Cache failures too, to bound retries. */
export class ThreadDiffCache {
  private cache = new Map<string, { at: number; value: ThreadDiffSummary }>();
  private flights = new Map<string, Promise<ThreadDiffSummary>>();
  private active = 0;
  private waiting: (() => void)[] = [];
  constructor(
    private readonly read = repoDiffFiles,
    private readonly now = Date.now,
    private readonly ttl = DIFF_REFRESH_MS,
    private readonly capacity = 128,
  ) {}

  async summary(directory: string | null): Promise<ThreadDiffSummary> {
    if (!directory) return missingDiff("no-directory");
    const hit = this.cache.get(directory);
    if (hit && this.now() - hit.at < this.ttl) return hit.value;
    const flight = this.flights.get(directory);
    if (flight) return flight;
    // In addition to the byte/time bounds of repoDiffFiles, refuse an unbounded queue.
    if (this.flights.size >= this.capacity) return missingDiff("unavailable");
    const work = Promise.resolve().then(() => this.calculate(directory));
    this.flights.set(directory, work);
    return work;
  }

  private async calculate(directory: string): Promise<ThreadDiffSummary> {
    if (this.active >= 2) await new Promise<void>((resume) => this.waiting.push(resume));
    else this.active++;
    let value: ThreadDiffSummary;
    try {
      const list = await this.read(directory, new URLSearchParams({ scope: "combined" }), { maxFiles: 4096, maxListBytes: 256 * 1024, deadlineMs: 1500 });
      value = {
        state: "ready",
        additions: list.files.reduce((sum, file) => sum + (file.additions ?? 0), 0),
        deletions: list.files.reduce((sum, file) => sum + (file.deletions ?? 0), 0),
        untracked: list.files.filter((file) => file.status === "untracked").length,
        files: list.total ?? list.files.length,
        partial: list.truncated || list.files.some((file) => file.additions === null || file.deletions === null),
      };
    } catch (error) {
      value = missingDiff(error instanceof RepoDiffError && error.code === "not_a_repository" ? "no-repo" : "unavailable");
    } finally {
      const next = this.waiting.shift();
      if (next) next(); else this.active--;
    }
    this.cache.delete(directory);
    this.cache.set(directory, { at: this.now(), value });
    while (this.cache.size > this.capacity) this.cache.delete(this.cache.keys().next().value!);
    this.flights.delete(directory);
    return value;
  }
}

/** Only a registered thread whose current pane still belongs to its workspace can start git. */
export async function threadDiffBatch(catalog: ProjectCatalog, snapshot: SessionSnapshot, ids: string[], cache: ThreadDiffCache): Promise<ThreadDiffBatch> {
  const summaries: Record<string, ThreadDiffSummary> = {};
  const threads = catalog.projects.flatMap((project) => project.threads);
  await Promise.all(ids.map(async (id) => {
    const thread = threads.find((row) => row.pane_id === id);
    const pane = snapshot.panes.find((row) => row.pane_id === id && row.workspace_id === thread?.workspace_id);
    summaries[id] = !thread || !pane ? missingDiff("missing") : await cache.summary(thread.directory ?? pane.foreground_cwd ?? pane.cwd ?? null);
  }));
  return { summaries, refreshed_at: Date.now() };
}
