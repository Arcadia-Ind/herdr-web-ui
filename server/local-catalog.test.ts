import { afterAll, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installedProjects, installedThemes, paletteTheme, themeSections, type CatalogPaths } from "./local-catalog.ts";

const dir = mkdtempSync(join(tmpdir(), "web-catalog-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const paths: CatalogPaths = { configDir: join(dir, "config"), stateDir: join(dir, "state"), cacheDir: join(dir, "cache"), projectsRoot: join(dir, "projects"), socket: join(dir, "herdr.sock") };
function put(path: string, content: string) { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, content); }
const palette = "background = #101020\nforeground = #eeeeff\npalette = 4=#8080ff\n";

it("reads installed, cached and user themes, with exact names and token overrides", async () => {
  put(join(paths.configDir, "plugins/github/herdr-theme-picker-123abc/themes/ocean"), palette);
  put(join(paths.cacheDir, "day"), "background = #ffffff\nforeground = #222222\n");
  put(join(paths.stateDir, "themes/my-own-name"), palette + "# hpick-override: accent=#ff00aa\n");
  put(join(paths.configDir, "config.toml"), '[auth]\nsecret="must-not-leak"\n[theme]\nname="Personal name"\n[theme.custom]\npanel_bg="#101020"\ntext="#eeeeff"\nsecret="must-not-leak"\n');
  const catalog = await installedThemes(paths);
  expect(catalog.partial).toBe(false);
  expect(catalog.themes.map((theme) => theme.name).sort()).toEqual(["Personal name (Herdr)", "day", "my-own-name", "ocean"]);
  expect(catalog.themes.find((theme) => theme.id === "day")?.mode).toBe("light");
  expect(catalog.themes.find((theme) => theme.id === "my-own-name")?.colors.accent).toBe("#ff00aa");
  expect(JSON.stringify(catalog)).not.toContain("must-not-leak");
});

it("rejects palette text and CSS values that are not colors", () => {
  expect(paletteTheme("bad", "bad", "foreground = #ffffff\n")).toBeNull();
  expect(paletteTheme("ok", "ok", palette + "# hpick-override: accent=url(https://invalid)\n")?.colors.accent).toBe("#8080ff");
  expect(themeSections('[auth]\nkey="secret"\n[theme]\nname="ocean"\n[agent]\npassword="secret"')).not.toContain("secret");
  expect(themeSections('[theme.custom]\ntext="#ffffff"\n[[agents]]\npassword="secret"')).not.toContain("secret");
});

it("binds projects to the exact session and returns only selected registry fields", async () => {
  const project = join(paths.projectsRoot, "demo");
  put(join(project, "PROJECT.md"), '+++\nname="Demo"\n+++\nPrivate project instructions\n');
  put(join(project, ".state/coordinator.json"), JSON.stringify({ socket: paths.socket, pane_id: "w1:p1", workspace_id: "w1", secret: "private" }));
  put(join(project, "threads/t-0042.toml"), 'id="t-0042"\ntitle="A real title"\nstatus="open"\npane_id="w2:p1"\nworkspace_id="w2"\nworktree_path="/fixture/repo"\nerror="private"\n');
  put(join(project, "threads/t-0043.toml"), 'id="t-0043"\nstatus="resolved"\n');
  put(join(project, "threads/t-0044.toml"), 'id="t-0044"\ntitle="Retained work"\nstatus="resolved"\npane_id="w3:p1"\nworkspace_id="w3"\nworktree_path="/fixture/retained"\n');
  put(join(project, "threads/t-0045.toml"), 'id="t-0045"\nstatus="resolved"\nmachine="another-pc"\npane_id="w4:p1"\nworkspace_id="w4"\n');
  let result = await installedProjects(paths);
  expect(result.projects[0]?.threads).toEqual([
    { id: "t-0042", title: "A real title", lifecycle: "open", pane_id: "w2:p1", workspace_id: "w2", directory: "/fixture/repo" },
    { id: "t-0044", title: "Retained work", lifecycle: "resolved", pane_id: "w3:p1", workspace_id: "w3", directory: "/fixture/retained" },
  ]);
  expect(JSON.stringify(result)).not.toContain("private");
  put(join(project, ".state/coordinator.json"), JSON.stringify({ socket: paths.socket + "-other", pane_id: "w1:p1", workspace_id: "w1" }));
  result = await installedProjects(paths);
  expect(result.projects).toEqual([]);
});
