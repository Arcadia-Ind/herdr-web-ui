import { expect, it } from "bun:test";
import type { ProjectCatalog } from "../../shared/customization.ts";
import type { PaneInfo, SessionSnapshot } from "../../shared/protocol.ts";
import { projectNumber, projectPaneIds, ungroupedSnapshot } from "./projectSidebar.ts";
import { sanitizeSettings, telemetrySettingsSnapshot } from "./settings.ts";

const pane = (workspace: string, label: string): PaneInfo => ({ pane_id: workspace + ":p1", workspace_id: workspace, tab_id: workspace + ":t1", terminal_id: workspace + "-term", revision: 1, focused: false, agent_status: "blocked", label });
const panes = [pane("w1C", "Coordinator"), pane("w1D", "Thread"), pane("w1E", "hp/demo/t-0042")];
const snapshot: SessionSnapshot = {
  protocol: 22, version: "fixture", panes, agents: [...panes], layouts: [], tabs: [],
  workspaces: panes.map((row, i) => ({ workspace_id: row.workspace_id, active_tab_id: row.tab_id, label: row.label!, number: 28 + i, tab_count: 1, pane_count: 1, focused: false, agent_status: "idle" })),
};
const catalog: ProjectCatalog = { partial: false, projects: [{
  id: "demo", name: "Demo", workspace_id: "w1C", coordinators: [{ pane_id: "w1C:p1", workspace_id: "w1C" }],
  threads: [{ id: "t-0042", title: "A title with no status evidence", lifecycle: "open", pane_id: "w1D:p1", workspace_id: "w1D", directory: "/fixture" }],
}] };
it("groups exact identities once while retaining unregistered agents with similar names", () => {
  expect([...projectPaneIds(snapshot, catalog)]).toEqual(["w1C:p1", "w1D:p1"]);
  const other = ungroupedSnapshot(snapshot, catalog)!;
  expect(other.panes.map((row) => row.pane_id)).toEqual(["w1E:p1"]);
  expect(other.agents.map((row) => row.pane_id)).toEqual(["w1E:p1"]);
  expect(other.workspaces.map((row) => row.workspace_id)).toEqual(["w1E"]);
  expect(snapshot.panes).toHaveLength(3);
});
it("rejects a stale workspace binding and leaves the original roster available", () => {
  const stale = structuredClone(catalog);
  stale.projects[0]!.threads[0]!.workspace_id = "w99";
  expect([...projectPaneIds(snapshot, stale)]).toEqual(["w1C:p1"]);
  expect(ungroupedSnapshot(snapshot, null)).toBe(snapshot);
  expect(ungroupedSnapshot(null, catalog)).toBeNull();
});
it("uses the native stable workspace number, including hexadecimal workspace IDs", () => {
  expect(projectNumber(catalog.projects[0]!, snapshot)).toBe("P28");
  expect(projectNumber(catalog.projects[0]!, null)).toBe("w1C");
});
it("keeps compact and named theme choices through reloads and unrelated settings updates", () => {
  const saved = sanitizeSettings({ herdrTheme: "my-theme", compactSidebar: true });
  const reloaded = sanitizeSettings(JSON.parse(JSON.stringify(saved)));
  expect(reloaded.herdrTheme).toBe("my-theme");
  expect(sanitizeSettings({ ...reloaded, theme: "light" }).herdrTheme).toBe("my-theme");
  expect(reloaded.compactSidebar).toBe(true);
  expect(sanitizeSettings({ ...reloaded, compactSidebar: false }).herdrTheme).toBe("my-theme");
  expect(sanitizeSettings({ herdrTheme: "../private", compactSidebar: "yes" }).herdrTheme).toBeNull();
  expect(sanitizeSettings({ compactSidebar: "yes" }).compactSidebar).toBe(false);
  expect(JSON.stringify(telemetrySettingsSnapshot(reloaded))).not.toContain("my-theme");
});

it("keeps additional tabs and split panes in their registered project", () => {
  const extra: PaneInfo = { ...panes[1]!, pane_id: "w1D:p2", terminal_id: "other", label: "A support shell" };
  const withSplit = { ...snapshot, panes: [...snapshot.panes, extra], agents: [...snapshot.agents, extra] };
  expect(projectPaneIds(withSplit, catalog).has(extra.pane_id)).toBe(true);
  expect(ungroupedSnapshot(withSplit, catalog)!.panes.map((row) => row.pane_id)).toEqual(["w1E:p1"]);
});
