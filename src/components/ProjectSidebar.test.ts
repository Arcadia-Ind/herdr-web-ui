import { expect, it } from "bun:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ProjectCatalog } from "../../shared/customization.ts";
import type { PaneInfo, SessionSnapshot } from "../../shared/protocol.ts";
import { SettingsProvider } from "../lib/settings.ts";
import { ProjectCatalogNotice, ProjectSidebar } from "./ProjectSidebar.tsx";
import { displayPaneTitle } from "./Sidebar.tsx";

function render(children: ReactNode): string {
  const languages = Object.getOwnPropertyDescriptor(navigator, "languages");
  Object.defineProperty(navigator, "languages", { configurable: true, value: ["en"] });
  try { return renderToStaticMarkup(createElement(SettingsProvider, { children })); }
  finally {
    if (languages) Object.defineProperty(navigator, "languages", languages);
    else Reflect.deleteProperty(navigator, "languages");
  }
}

it("shows registry project names and thread numbers/titles, with readable coordinator and split labels", () => {
  const pane = (id: string, workspace: string, label: string): PaneInfo => ({ pane_id: id, workspace_id: workspace, terminal_id: id, tab_id: workspace + ":t1", revision: 1, focused: false, agent_status: "idle", label });
  const panes = [pane("w1:p1", "w1", "Root"), pane("w63:p1", "w63", "Native agent title"), pane("w63:p2", "w63", "Support shell")];
  const snapshot: SessionSnapshot = { protocol: 22, version: "fixture", panes, agents: [], workspaces: [], tabs: [], layouts: [] };
  const catalog: ProjectCatalog = { partial: false, projects: [{ id: "sim", name: "Sim", workspace_id: "w1", coordinators: [{ pane_id: "w1:p1", workspace_id: "w1" }], threads: [
    { id: "t-0169", title: "Readable sidebar names", pane_id: "w63:p1", workspace_id: "w63", directory: "/fixture", lifecycle: "open" },
  ] }] };
  const html = render(createElement(ProjectSidebar, {
    machineId: "local", catalog, snapshot, online: true, selectedPaneId: "w63:p1", onSelect() {}, onChanges() {}, onExplore() {},
  }));
  expect(html).toContain('class="project-name">Sim</span>');
  expect(html).toContain('class="thread-number">t-0169</span>');
  expect(html).toContain('class="thread-title">Readable sidebar names</span>');
  expect(html).toContain('class="thread-title">Coordinator</span>');
  expect(html).toContain('class="thread-title">Support shell</span>');
  expect(html).not.toContain('class="thread-number">w');
  expect(html).toContain('aria-label="t-0169 · Readable sidebar names · READY"');
  expect(html).toContain('aria-current="page"');
});

it("retains user labels and useful live titles for unregistered rows", () => {
  const pane: PaneInfo = { pane_id: "w69:p1", workspace_id: "w69", terminal_id: "shell", tab_id: "w69:t1", revision: 1, focused: false, agent_status: "idle", agent: "codex", label: "Sensor capture", title: "Other title" };
  expect(displayPaneTitle(pane)).toBe("Sensor capture");
  expect(displayPaneTitle({ ...pane, label: "", terminal_title: "Inspect camera frames | /fixture/project" })).toBe("Inspect camera frames");
  expect(displayPaneTitle({ ...pane, label: "", agent: null, terminal_title: "/fixture/forest-viewer" })).toBe("forest-viewer");
});

it("labels retained resolved threads, keeps selection, and omits closed archived rows", () => {
  const pane: PaneInfo = { pane_id: "w63:p1", workspace_id: "w63", cwd: "/retained", terminal_id: "retained", tab_id: "w63:t1", revision: 1, focused: false, agent_status: "working" };
  const snapshot: SessionSnapshot = { protocol: 22, version: "fixture", panes: [pane], agents: [], workspaces: [], tabs: [], layouts: [] };
  const thread = { id: "t-0160", title: "Retained finished work", pane_id: pane.pane_id, workspace_id: pane.workspace_id, directory: "/retained", lifecycle: "resolved" as const };
  const catalog: ProjectCatalog = { partial: false, projects: [{ id: "sim", name: "Sim", workspace_id: "w1", coordinators: [], threads: [thread, { ...thread, id: "t-0159", title: "Closed archived thread", pane_id: "w62:p1", workspace_id: "w62" }] }] };
  const html = render(createElement(ProjectSidebar, {
    machineId: "local", catalog, snapshot, online: true, selectedPaneId: pane.pane_id, onSelect() {}, onChanges() {}, onExplore() {},
  }));
  expect(html).toContain('aria-label="t-0160 · Retained finished work · Resolved"');
  expect(html).toContain('class="thread-lifecycle">Resolved</span>');
  expect(html).toContain('aria-current="page"');
  expect(html).not.toContain("Closed archived thread");
  expect(html).not.toContain("WORKING");
});

it("reports refresh failure separately from a missing catalog without exposing error details", () => {
  const error = { name: "Error", message: "private internal diagnosis", at: 1, status: null, code: null };
  const initial = render(createElement(ProjectCatalogNotice, { load: { catalog: null, unavailable: true, error } }));
  const cached = render(createElement(ProjectCatalogNotice, { load: { catalog: { projects: [], partial: false }, unavailable: true, error } }));
  const recovered = render(createElement(ProjectCatalogNotice, { load: { catalog: { projects: [], partial: false }, unavailable: false, error: null } }));
  expect(initial).toContain("Projects unavailable");
  expect(cached).toContain("Project refresh failed; showing the last result");
  expect(cached).not.toContain("Projects unavailable");
  expect(cached).not.toContain(error.message);
  expect(recovered).toBe("");
});
