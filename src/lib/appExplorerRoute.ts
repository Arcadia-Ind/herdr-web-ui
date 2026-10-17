import { explorerFromSearch, explorerHref, type ExplorerTarget } from "./explorerRoute.ts";

/** Embedded state leaves the app's pane, machine, settings, and sidebar address intact. */
export function embeddedExplorerFromSearch(search: string): ExplorerTarget | null {
  const query = new URLSearchParams(search);
  const saved = query.get("explorer");
  if (query.getAll("explorer").length !== 1 || !saved?.startsWith("/?")) return null;
  return explorerFromSearch(saved.slice(1));
}

export function embeddedExplorerHref(target: ExplorerTarget | null, search: string, pathname = "/"): string {
  const query = new URLSearchParams(search);
  if (target) query.set("explorer", explorerHref(target)); else query.delete("explorer");
  const next = query.toString();
  return pathname + (next ? "?" + next : "");
}
