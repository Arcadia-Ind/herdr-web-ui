import { open, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { THEME_TOKENS, type HerdrProject, type InstalledTheme, type ProjectCatalog, type ProjectThread, type ThemeCatalog, type ThemeToken } from "../shared/customization.ts";
import { herdrSocketPath } from "./herdr/client.ts";

const HEX = /^#[0-9a-f]{6}$/i;
const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
const MAX_FILE_BYTES = 128 * 1024;
const MAX_ENTRIES = 512;

/** Fixed byte limit, including files that grow during a read. No plugin code is executed. */
export async function catalogText(path: string): Promise<string> {
  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_FILE_BYTES) throw new Error("catalog file too large");
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally { await file.close(); }
}

async function entries(path: string): Promise<string[]> {
  try { return (await readdir(path)).sort(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}

/** Only these sections are parsed. Authentication, agent settings and the project body are ignored. */
export function themeSections(text: string): string {
  let selected = false;
  return text.split(/\r?\n/).filter((line) => {
    const section = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/);
    if (section) selected = section[1] === "theme" || section[1] === "theme.custom";
    return selected;
  }).join("\n");
}

export function themeFromColors(id: string, name: string, raw: Record<string, unknown>): InstalledTheme | null {
  const colors: Partial<Record<ThemeToken, string>> = {};
  for (const key of THEME_TOKENS) if (typeof raw[key] === "string" && HEX.test(raw[key])) colors[key] = raw[key];
  if (!colors.panel_bg || !colors.text) return null;
  const rgb = colors.panel_bg.slice(1).match(/../g)!.map((value) => parseInt(value, 16));
  const brightness = 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!;
  return { id, name: name.slice(0, 100), mode: brightness > 150 ? "light" : "dark", colors: colors as InstalledTheme["colors"] };
}

/** Ghostty palette format used by Theme Picker, including its per-token custom overrides. */
export function paletteTheme(id: string, name: string, text: string): InstalledTheme | null {
  const values: Record<string, string> = {};
  const overrides: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const color = line.match(/^\s*(background|foreground|selection-background)\s*=\s*(#[a-f0-9]{6})\s*$/i);
    const palette = line.match(/^\s*palette\s*=\s*(\d+)\s*=\s*(#[a-f0-9]{6})\s*$/i);
    const override = line.match(/^#\s*hpick-override:\s*([a-z0-9_]+)=(#[a-f0-9]{6})\s*$/i);
    if (color) values[color[1]!] = color[2]!;
    if (palette) values["p" + palette[1]] = palette[2]!;
    if (override) overrides[override[1]!] = override[2]!;
  }
  return themeFromColors(id, name, {
    panel_bg: values.background, sidebar_bg: values.background, text: values.foreground,
    active_row_bg: values.p0, selection_bg: values["selection-background"] ?? values.p8,
    surface0: values.p0, surface1: values.p8, subtext0: values.p7, overlay0: values.p8,
    accent: values.p4, blue: values.p4, mauve: values.p5, green: values.p2,
    yellow: values.p3, red: values.p1, teal: values.p6, peach: values.p9, ...overrides,
  });
}

export interface CatalogPaths { configDir: string; stateDir: string; cacheDir: string; projectsRoot: string; socket: string }
export function localCatalogPaths(): CatalogPaths {
  const home = homedir();
  return {
    configDir: dirname(herdrSocketPath()),
    stateDir: join(process.env.XDG_STATE_HOME ?? join(home, ".local", "state"), "herdr", "plugins", "herdr-theme-picker"),
    cacheDir: join(process.env.XDG_CACHE_HOME ?? join(home, ".cache"), "herdr-theme-picker"),
    projectsRoot: process.env.HERDR_PROJECTS_ROOT ?? join(home, ".herdr-projects"),
    socket: herdrSocketPath(),
  };
}

export async function installedThemes(paths = localCatalogPaths()): Promise<ThemeCatalog> {
  const themes = new Map<string, InstalledTheme>();
  let partial = false;
  // Theme Picker resolves bundle, user, cache in that order. Do the same without network reads.
  const plugins = join(paths.configDir, "plugins", "github");
  const dirs: string[] = [];
  try {
    for (const name of await entries(plugins)) if (/^(?:[a-z0-9_.-]+\.)?herdr-theme-picker-[a-f0-9]+$/.test(name)) dirs.push(join(plugins, name, "themes"));
  } catch { partial = true; }
  dirs.push(join(paths.stateDir, "themes"), paths.cacheDir);
  for (const dir of dirs) {
    try {
      const names = (await entries(dir)).filter((name) => SLUG.test(name) && name !== "index.txt" && name !== "applied");
      if (names.length > MAX_ENTRIES) partial = true;
      for (const name of names.slice(0, MAX_ENTRIES)) {
        if (themes.has(name)) continue;
        try {
          const theme = paletteTheme(name, name, await catalogText(join(dir, name)));
          if (theme) themes.set(name, theme);
        } catch { partial = true; }
      }
    } catch { partial = true; }
  }
  try {
    const parsed = Bun.TOML.parse(themeSections(await catalogText(join(paths.configDir, "config.toml")))) as { theme?: { name?: unknown; custom?: Record<string, unknown> } };
    const name = typeof parsed.theme?.name === "string" ? parsed.theme.name : "custom";
    const current = themeFromColors("current", name + " (Herdr)", parsed.theme?.custom ?? {});
    if (current) themes.set(current.id, current);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") partial = true; }
  return { themes: [...themes.values()].sort((a, b) => a.name.localeCompare(b.name)), partial };
}

const str = (value: unknown): string => typeof value === "string" ? value : "";
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Registry identity is scoped to a Herdr socket: the same w1:p1 in another session is unrelated. */
export async function installedProjects(paths = localCatalogPaths()): Promise<ProjectCatalog> {
  const projects: HerdrProject[] = [];
  let partial = false;
  const slugs = (await entries(paths.projectsRoot)).filter((name) => SLUG.test(name));
  if (slugs.length > MAX_ENTRIES) partial = true;
  for (const slug of slugs.slice(0, MAX_ENTRIES)) {
    const dir = join(paths.projectsRoot, slug);
    try {
      const coordinator = object(JSON.parse(await catalogText(join(dir, ".state", "coordinator.json"))));
      if (!str(coordinator.socket) || resolve(str(coordinator.socket)) !== resolve(paths.socket)) continue;
      const document = await catalogText(join(dir, "PROJECT.md"));
      const front = document.match(/^\+\+\+\r?\n([\s\S]*?)\r?\n\+\+\+(?:\r?\n|$)/)?.[1];
      if (front === undefined) { partial = true; continue; }
      const settings = object(Bun.TOML.parse(front));
      const threads: ProjectThread[] = [];
      const names = (await entries(join(dir, "threads"))).filter((name) => /^t-\d{4,}\.toml$/.test(name));
      if (names.length > MAX_ENTRIES) partial = true;
      for (const file of names.slice(0, MAX_ENTRIES)) {
        try {
          const thread = object(Bun.TOML.parse(await catalogText(join(dir, "threads", file))));
          if (thread.status === "resolved" || str(thread.machine)) continue;
          if (!["starting", "open", "failed"].includes(str(thread.status)) || str(thread.id) !== file.slice(0, -5)) { partial = true; continue; }
          threads.push({
            id: str(thread.id), title: str(thread.title).slice(0, 500), lifecycle: thread.status as ProjectThread["lifecycle"],
            pane_id: str(thread.pane_id), workspace_id: str(thread.workspace_id),
            directory: str(thread.worktree_path) || str(thread.cwd) || null,
          });
        } catch { partial = true; }
      }
      const coordinators = [{ pane_id: str(coordinator.pane_id), workspace_id: str(coordinator.workspace_id) }];
      try {
        const records: unknown = JSON.parse(await catalogText(join(dir, ".state", "coordinators.json")));
        if (Array.isArray(records)) for (const entry of records) {
          const row = object(entry);
          if (str(row.pane_id) && !coordinators.some((item) => item.pane_id === row.pane_id)) coordinators.push({ pane_id: str(row.pane_id), workspace_id: str(row.workspace_id) });
        }
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") partial = true; }
      projects.push({ id: slug, name: str(settings.name) || slug, workspace_id: str(coordinator.workspace_id), coordinators, threads });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" && (error as NodeJS.ErrnoException).code !== "ENOTDIR") partial = true;
    }
  }
  return { projects, partial };
}

/** Shared in-flight read and bounded refresh across browser tabs. Failed reads are not cached. */
export function cachedCatalog<T>(read: () => Promise<T>, ttl = 15_000): () => Promise<T> {
  let value: T | undefined;
  let at = 0;
  let flight: Promise<T> | null = null;
  return () => {
    if (value !== undefined && Date.now() - at < ttl) return Promise.resolve(value);
    if (!flight) flight = read().then((answer) => { value = answer; at = Date.now(); return answer; }).finally(() => { flight = null; });
    return flight;
  };
}
