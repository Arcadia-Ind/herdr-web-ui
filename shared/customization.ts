/** Read-only local catalogs. These responses contain no configuration text or process arguments. */
export const THEME_TOKENS = [
  "panel_bg", "sidebar_bg", "active_row_bg", "selection_bg", "text", "surface0",
  "surface1", "overlay0", "overlay1", "subtext0", "accent", "blue", "mauve",
  "green", "yellow", "red", "teal", "peach", "surface_dim",
] as const;
export type ThemeToken = typeof THEME_TOKENS[number];
export interface InstalledTheme {
  id: string;
  name: string;
  mode: "dark" | "light";
  colors: Partial<Record<ThemeToken, string>> & { panel_bg: string; text: string };
}
export interface ThemeCatalog { themes: InstalledTheme[]; partial: boolean }
export interface ProjectThread {
  id: string;
  title: string;
  lifecycle: "starting" | "open" | "failed" | "resolved";
  pane_id: string;
  workspace_id: string;
  /** The recorded thread worktree, never the web server's working directory. */
  directory: string | null;
}
export interface HerdrProject {
  id: string;
  name: string;
  workspace_id: string;
  coordinators: { pane_id: string; workspace_id: string }[];
  threads: ProjectThread[];
}
export interface ProjectCatalog { projects: HerdrProject[]; partial: boolean }
export interface ThreadDiffSummary {
  state: "ready" | "no-repo" | "no-directory" | "unavailable" | "missing";
  additions: number;
  deletions: number;
  untracked: number;
  files: number;
  /** Counts exclude binary/untracked files and may be cut short by the existing diff limits. */
  partial: boolean;
}
export interface ThreadDiffBatch { summaries: Record<string, ThreadDiffSummary>; refreshed_at: number }
