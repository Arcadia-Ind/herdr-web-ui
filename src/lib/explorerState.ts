import { explorerPath, type ExplorerPairRule } from "../../shared/explorer.ts";

export type ExplorerMember = "code" | "description";
export interface ExplorerPair {
  id: string;
  code: string | null;
  description: string | null;
  selected: ExplorerMember;
}
export interface ExplorerTab extends ExplorerPair { showCode: boolean }
export interface ExplorerState { tabs: ExplorerTab[]; active: string | null }
export const MAX_EXPLORER_TABS = 32;
export const emptyExplorerState = (): ExplorerState => ({ tabs: [], active: null });

/** Rules come from the workspace's declared source mapping, not the file's basename. */
export function explorerPair(path: string, rules: ExplorerPairRule[]): ExplorerPair {
  for (const rule of rules) {
    if (path.startsWith(rule.source) && path.length > rule.source.length) {
      const description = rule.description + path.slice(rule.source.length) + rule.suffix;
      return { id: path, code: path, description, selected: "code" };
    }
    if (path.startsWith(rule.description) && path.endsWith(rule.suffix)) {
      const relative = path.slice(rule.description.length, -rule.suffix.length);
      // Authored README.md and FORMAT.md are not source mirrors.
      if (relative.split("/").pop()?.includes(".")) {
        const code = rule.source + relative;
        return { id: code, code, description: path, selected: "description" };
      }
    }
  }
  return /\.(?:md|markdown)$/i.test(path)
    ? { id: path, code: null, description: path, selected: "description" }
    : { id: path, code: path, description: null, selected: "code" };
}

export function openExplorerTab(state: ExplorerState, path: string, rules: ExplorerPairRule[]): ExplorerState {
  if (explorerPath(path) === null) return state;
  const pair = explorerPair(path, rules);
  const existing = state.tabs.find((tab) => tab.id === pair.id);
  if (existing) return { active: pair.id, tabs: state.tabs.map((tab) => tab.id === pair.id ? { ...tab, selected: pair.selected, showCode: pair.selected === "code" ? true : tab.showCode } : tab) };
  if (state.tabs.length >= MAX_EXPLORER_TABS) return state;
  const next = { active: pair.id, tabs: [...state.tabs, { ...pair, showCode: true }] };
  // Keep every state the UI can open small enough to survive a link and a reload.
  return encodeURIComponent(JSON.stringify(next)).length <= 24 * 1024 ? next : state;
}

export function closeExplorerTab(state: ExplorerState, path: string): ExplorerState {
  const index = state.tabs.findIndex((tab) => tab.id === path || tab.code === path || tab.description === path);
  if (index < 0) return state;
  const closing = state.tabs[index]!;
  const tabs = state.tabs.filter((tab) => tab !== closing);
  return { tabs, active: state.active === closing.id ? tabs[Math.min(index, tabs.length - 1)]?.id ?? null : state.active };
}

export function selectExplorerMember(state: ExplorerState, id: string, selected: ExplorerMember): ExplorerState {
  if (!state.tabs.some((tab) => tab.id === id && tab[selected] !== null)) return state;
  return { active: id, tabs: state.tabs.map((tab) => tab.id === id && tab[selected] !== null ? { ...tab, selected, showCode: selected === "code" ? true : tab.showCode } : tab) };
}

/** URL tab members must agree with the current repository's declared mapping. */
export function restoreExplorerState(saved: ExplorerState, rules: ExplorerPairRule[]): ExplorerState {
  let state = emptyExplorerState();
  const ids = new Map<string, string>();
  for (const tab of saved.tabs) {
    const path = tab[tab.selected];
    if (!path) continue;
    state = openExplorerTab(state, path, rules);
    if (!state.active) continue;
    ids.set(tab.id, state.active);
    if (!tab.showCode) state = toggleExplorerCode(state, state.active);
  }
  return { ...state, active: saved.active ? ids.get(saved.active) ?? state.active : state.active };
}

export function toggleExplorerCode(state: ExplorerState, id: string): ExplorerState {
  return { ...state, tabs: state.tabs.map((tab) => tab.id === id && tab.code && tab.description
    ? { ...tab, showCode: !tab.showCode, selected: tab.showCode ? "description" : tab.selected } : tab) };
}
