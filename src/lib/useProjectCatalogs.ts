import { useEffect, useState } from "react";
import type { ThreadDiffSummary } from "../../shared/customization.ts";
import type { Machine } from "../../shared/machines.ts";
import { fetchProjects, fetchThreadDiffs } from "./api.ts";
import { projectReadFailed, projectReadSucceeded, type ProjectLoad } from "./projectCatalogState.ts";

export type { ProjectLoad } from "./projectCatalogState.ts";
/** One read per connected PC every fifteen seconds. Hidden pages and disconnected PCs do no work. */
export function useProjectCatalogs(machines: Machine[]): ReadonlyMap<string, ProjectLoad> {
  const key = JSON.stringify(machines.map(({ id, state }) => [id, state]));
  const [loads, setLoads] = useState<ReadonlyMap<string, ProjectLoad>>(() => new Map());
  useEffect(() => {
    const states: [string, string][] = JSON.parse(key);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    const read = async () => {
      if (running || controller.signal.aborted || document.hidden) return;
      running = true;
      try {
        for (const [id, state] of states) {
          if (state !== "connected" || controller.signal.aborted) continue;
          try {
            const catalog = await fetchProjects(id, AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]));
            if (!controller.signal.aborted) setLoads((current) => new Map(current).set(id, projectReadSucceeded(catalog)));
          } catch (error) {
            if (!controller.signal.aborted) {
              const failure = projectReadFailed(undefined, error);
              console.warn("Project catalog refresh failed", { machine: id, ...failure.error });
              setLoads((current) => new Map(current).set(id, { ...failure, catalog: current.get(id)?.catalog ?? null }));
            }
          }
        }
      } finally {
        running = false;
        if (!controller.signal.aborted) timer = setTimeout(() => void read(), 15_000);
      }
    };
    const visible = () => { if (!document.hidden) { clearTimeout(timer); void read(); } };
    document.addEventListener("visibilitychange", visible);
    void read();
    return () => { controller.abort(); clearTimeout(timer); document.removeEventListener("visibilitychange", visible); };
  }, [key]);
  return loads;
}

/** One bounded batch at a time, for the visible live thread rows only; never tied to React renders. */
export function useThreadSummaries(machine: string, paneIds: string[], online: boolean): ReadonlyMap<string, ThreadDiffSummary> {
  const key = [...paneIds].sort().join(",");
  const [summaries, setSummaries] = useState<ReadonlyMap<string, ThreadDiffSummary>>(() => new Map());
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    const read = async () => {
      if (!online || !key || running || controller.signal.aborted || document.hidden) return;
      running = true;
      try {
        const ids = key.split(",");
        for (let start = 0; start < ids.length && !controller.signal.aborted; start += 8) {
          const batch = ids.slice(start, start + 8);
          try {
            const result = await fetchThreadDiffs(machine, batch, AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]));
            if (!controller.signal.aborted) setSummaries((current) => new Map([...current, ...Object.entries(result.summaries)]));
          } catch {
            if (!controller.signal.aborted) setSummaries((current) => new Map([...current, ...batch.map((id): [string, ThreadDiffSummary] => [id, { state: "unavailable", additions: 0, deletions: 0, untracked: 0, files: 0, partial: false }])]));
          }
        }
      } finally {
        running = false;
        if (!controller.signal.aborted) timer = setTimeout(() => void read(), 15_000);
      }
    };
    // A changed membership must not display the old worktree's count on a reused pane identity.
    setSummaries(new Map());
    const visible = () => { if (!document.hidden) { clearTimeout(timer); void read(); } };
    document.addEventListener("visibilitychange", visible);
    void read();
    return () => { controller.abort(); clearTimeout(timer); document.removeEventListener("visibilitychange", visible); };
  }, [machine, key, online]);
  return summaries;
}
