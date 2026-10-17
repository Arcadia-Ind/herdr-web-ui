import type { HerdrProject, ProjectCatalog, ProjectThread } from "../../shared/customization.ts";
import type { PaneInfo, SessionSnapshot } from "../../shared/protocol.ts";

export function projectPane(snapshot: SessionSnapshot | null, row: { pane_id: string; workspace_id: string } & Partial<Pick<ProjectThread, "lifecycle" | "directory">>): PaneInfo | undefined {
  const pane = snapshot?.panes.find((pane) => pane.pane_id === row.pane_id && pane.workspace_id === row.workspace_id);
  if (pane && row.lifecycle === "resolved" && row.directory) {
    const checkout = snapshot?.workspaces.find((workspace) => workspace.workspace_id === row.workspace_id)?.worktree?.checkout_path;
    if ((checkout || pane.cwd) !== row.directory) return undefined;
  }
  return pane;
}

/** Additional tabs and splits stay reachable inside their registered project's workspaces. */
export function projectAdditionalPanes(snapshot: SessionSnapshot | null, project: HerdrProject): PaneInfo[] {
  const registered = [...project.coordinators, ...project.threads].filter((row) => projectPane(snapshot, row));
  const ids = new Set(registered.map((row) => row.pane_id));
  const workspaces = new Set(registered.map((row) => row.workspace_id));
  return snapshot?.panes.filter((pane) => workspaces.has(pane.workspace_id) && !ids.has(pane.pane_id)) ?? [];
}

/** Retained completed rows establish grouping, but do not claim ongoing project activity. */
export function projectActivePanes(project: HerdrProject, snapshot: SessionSnapshot | null): PaneInfo[] {
  const current = { ...project, threads: project.threads.filter((thread) => thread.lifecycle !== "resolved") };
  const resolvedIds = new Set(project.threads.filter((thread) => thread.lifecycle === "resolved" && projectPane(snapshot, thread)).map((thread) => thread.pane_id));
  return [...current.coordinators, ...current.threads, ...projectAdditionalPanes(snapshot, current)].flatMap((row) => {
    const pane = projectPane(snapshot, row);
    return pane && !resolvedIds.has(pane.pane_id) ? [pane] : [];
  });
}
/** No title or branch parsing: current registry identities establish each workspace's membership. */
export function projectPaneIds(snapshot: SessionSnapshot | null, catalog: ProjectCatalog | null): Set<string> {
  return new Set((catalog?.projects ?? []).flatMap((project) => [
    ...[...project.coordinators, ...project.threads].flatMap((row) => projectPane(snapshot, row) ? [row.pane_id] : []),
    ...projectAdditionalPanes(snapshot, project).map((pane) => pane.pane_id),
  ]));
}
export function ungroupedSnapshot(snapshot: SessionSnapshot | null, catalog: ProjectCatalog | null): SessionSnapshot | null {
  if (!snapshot || !catalog) return snapshot;
  const ids = projectPaneIds(snapshot, catalog);
  const workspaces = new Set(snapshot.panes.filter((pane) => ids.has(pane.pane_id)).map((pane) => pane.workspace_id));
  return {
    ...snapshot,
    panes: snapshot.panes.filter((pane) => !ids.has(pane.pane_id)),
    agents: snapshot.agents.filter((agent) => !ids.has(agent.pane_id)),
    workspaces: snapshot.workspaces.filter((workspace) => !workspaces.has(workspace.workspace_id)),
  };
}
/** Herdr's home workspace supplies the stable project number; no sorted-list index is invented. */
export function projectNumber(project: HerdrProject, snapshot: SessionSnapshot | null = null): string {
  const workspace = snapshot?.workspaces.find((row) => row.workspace_id === project.workspace_id);
  return workspace ? "P" + workspace.number : project.workspace_id || project.id;
}

/** Active registry membership and live pane identity, independent of live status, titles and order. */
export function projectMemberIds(project: HerdrProject, snapshot: SessionSnapshot | null): Set<string> {
  return new Set([
    ...project.threads.filter((thread) => thread.lifecycle !== "resolved").map((thread) => `thread:${thread.id}`),
    ...projectActivePanes(project, snapshot).map((pane) => `pane:${pane.pane_id}:${pane.terminal_id}`),
  ]);
}

/** The first complete discovery honors the saved fold. Later new identities open the project once. */
export function discoverProjectMembers(seen: ReadonlySet<string> | null, members: ReadonlySet<string>, ready: boolean): { seen: ReadonlySet<string> | null; added: boolean } {
  if (!seen) return { seen: ready ? new Set(members) : null, added: false };
  const added = [...members].some((member) => !seen.has(member));
  // Keep earlier identities through partial catalogs, disconnects and pane removal.
  return { seen: added ? new Set([...seen, ...members]) : seen, added };
}
export const projectFoldKey = (machine: string, project: string) => `herdr-web-ui:project-fold:${machine}:${project}`;
export function readProjectFold(machine: string, project: string): boolean {
  try { return localStorage.getItem(projectFoldKey(machine, project)) === "1"; } catch { return false; }
}
export function saveProjectFold(machine: string, project: string, folded: boolean): void {
  try { localStorage.setItem(projectFoldKey(machine, project), folded ? "1" : "0"); } catch { /* blocked storage keeps the current session usable */ }
}
