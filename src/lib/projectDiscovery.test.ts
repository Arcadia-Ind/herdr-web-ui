import { expect, it } from "bun:test";
import type { HerdrProject } from "../../shared/customization.ts";
import type { PaneInfo, SessionSnapshot } from "../../shared/protocol.ts";
import { discoverProjectMembers, projectMemberIds } from "./projectSidebar.ts";

const pane: PaneInfo = { pane_id: "w63:p1", workspace_id: "w63", terminal_id: "term1", tab_id: "w63:t1", revision: 1, focused: false, agent_status: "working" };
const project: HerdrProject = { id: "sim", name: "Sim", workspace_id: "w1", coordinators: [], threads: [
  { id: "t-0169", title: "Readable sidebar names", lifecycle: "open", pane_id: pane.pane_id, workspace_id: pane.workspace_id, directory: "/fixture" },
] };
const snapshot: SessionSnapshot = { protocol: 22, version: "fixture", panes: [pane], agents: [], workspaces: [], tabs: [], layouts: [] };

it("waits for complete initial discovery and does not open a saved fold on loading", () => {
  const members = projectMemberIds(project, snapshot);
  expect(discoverProjectMembers(null, members, false)).toEqual({ seen: null, added: false });
  const initial = discoverProjectMembers(null, members, true);
  expect(initial.added).toBe(false);
  expect([...initial.seen!]).toEqual(["thread:t-0169", "pane:w63:p1:term1"]);
});

it("opens for a new thread with the same total row count, then preserves a manual collapse", () => {
  const initial = discoverProjectMembers(null, projectMemberIds(project, snapshot), true);
  const replacement = { ...project, threads: [{ ...project.threads[0]!, id: "t-0170" }] };
  const changed = discoverProjectMembers(initial.seen, projectMemberIds(replacement, snapshot), true);
  expect(changed.added).toBe(true);
  expect(discoverProjectMembers(changed.seen, projectMemberIds(replacement, snapshot), true).added).toBe(false);
});

it("does not reopen on status, title, lifecycle, order or partial removal updates", () => {
  const initial = discoverProjectMembers(null, projectMemberIds(project, snapshot), true);
  const refreshed = { ...project, name: "Simulation", threads: [{ ...project.threads[0]!, title: "New title", lifecycle: "failed" as const }] };
  const updated = { ...snapshot, panes: [{ ...pane, agent_status: "done", revision: 2, label: "New pane title" }] };
  const routine = discoverProjectMembers(initial.seen, projectMemberIds(refreshed, updated), true);
  expect(routine.added).toBe(false);
  expect(routine.seen).toBe(initial.seen);
  const missing = discoverProjectMembers(routine.seen, new Set(), false);
  expect(discoverProjectMembers(missing.seen, projectMemberIds(project, snapshot), true).added).toBe(false);
});

it("opens when a registered thread starts running or an extra project pane appears", () => {
  const initial = discoverProjectMembers(null, projectMemberIds(project, { ...snapshot, panes: [] }), true);
  const started = discoverProjectMembers(initial.seen, projectMemberIds(project, snapshot), true);
  expect(started.added).toBe(true);
  const split = { ...snapshot, panes: [pane, { ...pane, pane_id: "w63:p2", terminal_id: "term2" }] };
  const added = discoverProjectMembers(started.seen, projectMemberIds(project, split), true);
  expect(added.added).toBe(true);
  expect(discoverProjectMembers(added.seen, projectMemberIds(project, split), true).added).toBe(false);
});

it("uses registry bindings rather than similar labels or pane prefixes", () => {
  const unrelated = { ...pane, pane_id: "w64:p1", workspace_id: "w64", label: "hp/sim/t-0170", terminal_id: "unrelated" };
  expect(projectMemberIds(project, { ...snapshot, panes: [pane, unrelated] })).toEqual(projectMemberIds(project, snapshot));
  const stale = { ...project, threads: [{ ...project.threads[0]!, workspace_id: "w99" }] };
  expect([...projectMemberIds(stale, snapshot)]).toEqual(["thread:t-0169"]);
});

it("detects a new coordinator pane and a replacement terminal without treating a reconnect as new", () => {
  const initial = discoverProjectMembers(null, projectMemberIds(project, snapshot), true);
  const home = { ...pane, pane_id: "w1:p1", workspace_id: "w1", terminal_id: "home" };
  const coordinated = { ...project, coordinators: [{ pane_id: home.pane_id, workspace_id: home.workspace_id }] };
  const joined = discoverProjectMembers(initial.seen, projectMemberIds(coordinated, { ...snapshot, panes: [home, pane] }), true);
  expect(joined.added).toBe(true);
  expect(discoverProjectMembers(joined.seen, projectMemberIds(coordinated, { ...snapshot, panes: [pane, home] }), true).added).toBe(false);
  expect(discoverProjectMembers(joined.seen, projectMemberIds(coordinated, { ...snapshot, panes: [home, { ...pane, terminal_id: "new-terminal" }] }), true).added).toBe(true);
});
