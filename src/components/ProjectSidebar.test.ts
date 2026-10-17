import { expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ProjectCatalog } from "../../shared/customization.ts";
import type { PaneInfo, SessionSnapshot } from "../../shared/protocol.ts";
import { SettingsProvider } from "../lib/settings.ts";
import { ProjectSidebar } from "./ProjectSidebar.tsx";
import { displayPaneTitle } from "./Sidebar.tsx";

it("shows registry project names and thread numbers/titles, with readable coordinator and split labels", () => {
  const pane = (id: string, workspace: string, label: string): PaneInfo => ({ pane_id: id, workspace_id: workspace, terminal_id: id, tab_id: workspace + ":t1", revision: 1, focused: false, agent_status: "idle", label });
  const panes = [pane("w1:p1", "w1", "Root"), pane("w63:p1", "w63", "Native agent title"), pane("w63:p2", "w63", "Support shell")];
  const snapshot: SessionSnapshot = { protocol: 22, version: "fixture", panes, agents: [], workspaces: [], tabs: [], layouts: [] };
  const catalog: ProjectCatalog = { partial: false, projects: [{ id: "sim", name: "Sim", workspace_id: "w1", coordinators: [{ pane_id: "w1:p1", workspace_id: "w1" }], threads: [
    { id: "t-0169", title: "Readable sidebar names", pane_id: "w63:p1", workspace_id: "w63", directory: "/fixture", lifecycle: "open" },
  ] }] };
  const languages = Object.getOwnPropertyDescriptor(navigator, "languages");
  Object.defineProperty(navigator, "languages", { configurable: true, value: ["en"] });
  let html: string;
  try {
    html = renderToStaticMarkup(createElement(SettingsProvider, { children: createElement(ProjectSidebar, {
      machineId: "local", catalog, snapshot, online: true, selectedPaneId: "w63:p1", onSelect() {}, onChanges() {}, onExplore() {},
    }) }));
  } finally {
    if (languages) Object.defineProperty(navigator, "languages", languages);
    else Reflect.deleteProperty(navigator, "languages");
  }
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
