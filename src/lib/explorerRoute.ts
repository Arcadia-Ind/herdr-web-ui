import { explorerContextQuery, explorerIdentity, explorerPath, type ExplorerContext } from "../../shared/explorer.ts";
import { emptyExplorerState, MAX_EXPLORER_TABS, type ExplorerState, type ExplorerTab } from "./explorerState.ts";

export interface ExplorerTarget { context: ExplorerContext; state: ExplorerState }
const MAX_SEARCH = 32 * 1024;

export function explorerHref(target: ExplorerTarget, pathname = "/"): string {
  const query = explorerContextQuery(target.context);
  query.set("explore", "1");
  if (target.state.tabs.length) query.set("tabs", JSON.stringify(target.state));
  return pathname + "?" + query.toString();
}

/** Invalid links never fall back to the server's cwd or a different project. */
export function explorerFromSearch(search: string): ExplorerTarget | null {
  if (search.length > MAX_SEARCH) return null;
  const query = new URLSearchParams(search);
  const allowed = new Set(["explore", "machine", "project", "workspace", "thread", "pane", "tabs"]);
  if (query.get("explore") !== "1" || [...query.keys()].some((key) => !allowed.has(key) || query.getAll(key).length !== 1)) return null;
  const context = explorerIdentity(query);
  if (!context) return null;
  const raw = query.get("tabs");
  if (raw === null) return { context, state: emptyExplorerState() };
  try {
    const state = JSON.parse(raw) as ExplorerState;
    if (!Array.isArray(state.tabs) || state.tabs.length > MAX_EXPLORER_TABS || !state.tabs.every(validTab)) return null;
    if (new Set(state.tabs.map((tab) => tab.id)).size !== state.tabs.length) return null;
    if (state.active !== null && !state.tabs.some((tab) => tab.id === state.active)) return null;
    if (state.tabs.length && state.active === null) return null;
    return { context, state: { active: state.active, tabs: state.tabs.map(({ id, code, description, selected, showCode }) => ({ id, code, description, selected, showCode })) } };
  } catch { return null; }
}

function validTab(tab: ExplorerTab): boolean {
  if (!tab || typeof tab !== "object" || typeof tab.id !== "string" || explorerPath(tab.id) === null) return false;
  if (![tab.code, tab.description].every((path) => path === null || typeof path === "string" && explorerPath(path) !== null)) return false;
  return (tab.code !== null || tab.description !== null) && tab.id === (tab.code ?? tab.description) &&
    (tab.selected === "code" || tab.selected === "description") && tab[tab.selected] !== null &&
    typeof tab.showCode === "boolean" && (tab.selected !== "code" || tab.showCode);
}
