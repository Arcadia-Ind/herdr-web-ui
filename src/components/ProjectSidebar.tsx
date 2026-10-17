import { useId, useState } from "react";
import { ChevronDown, ChevronRight, GitCompareArrows } from "lucide-react";
import type { HerdrProject, ProjectCatalog, ProjectThread, ThreadDiffSummary } from "../../shared/customization.ts";
import type { SessionSnapshot } from "../../shared/protocol.ts";
import { useT } from "../lib/i18n.ts";
import { projectAdditionalPanes, projectNumber, projectPane, readProjectFold, saveProjectFold } from "../lib/projectSidebar.ts";
import { paneStatus, rollupStatus, STATUS_WORD } from "../lib/status.ts";
import { useThreadSummaries } from "../lib/useProjectCatalogs.ts";
import { displayPaneTitle, StatusBadge } from "./Sidebar.tsx";
import "./ProjectSidebar.css";

interface Props {
  machineId: string;
  catalog: ProjectCatalog;
  snapshot: SessionSnapshot | null;
  online: boolean;
  selectedPaneId: string | null;
  onSelect(pane: string): void;
  onChanges(pane: string, directory: string | null): void;
}
export function ProjectSidebar(props: Props) {
  return <div className="project-list">{props.catalog.projects.map((project) => <ProjectGroup key={project.id} {...props} project={project} />)}</div>;
}

function ProjectGroup({ project, ...props }: Props & { project: HerdrProject }) {
  const t = useT();
  const listId = useId();
  const [folded, setFolded] = useState(() => readProjectFold(props.machineId, project.id));
  const coordinator = project.coordinators.find((row) => projectPane(props.snapshot, row));
  const additional = projectAdditionalPanes(props.snapshot, project);
  const liveRows = [...project.coordinators, ...project.threads, ...additional].flatMap((row) => {
    const pane = projectPane(props.snapshot, row);
    return pane ? [pane] : [];
  });
  const status = props.online ? rollupStatus(liveRows.map(paneStatus)) : "unknown";
  const selected = liveRows.some((pane) => pane.pane_id === props.selectedPaneId);
  const diffIds = folded ? [] : project.threads.filter((row) => projectPane(props.snapshot, row)).map((row) => row.pane_id);
  const summaries = useThreadSummaries(props.machineId, diffIds, props.online);
  const toggle = () => { const next = !folded; setFolded(next); saveProjectFold(props.machineId, project.id, next); };
  return <section className={`project-group${selected ? " has-selection" : ""}`} aria-label={project.name} data-project={project.id}>
    <header className="project-header">
      <button type="button" className="sidebar-row-action project-fold" aria-controls={listId} aria-expanded={!folded} aria-label={t(folded ? "Expand {name}" : "Collapse {name}", { name: project.name })} title={project.name} onClick={toggle}>{folded ? <ChevronRight /> : <ChevronDown />}</button>
      <button type="button" className="project-select" disabled={!props.online || !coordinator} aria-label={project.name} title={project.name} onClick={() => coordinator && props.onSelect(coordinator.pane_id)}>
        <span className="project-number">{projectNumber(project, props.snapshot)}</span>
        <span className="project-name">{project.name}</span>
        <StatusBadge status={status} compact alwaysVisible />
      </button>
    </header>
    <ul className="project-threads" id={listId} hidden={folded}>
      {project.coordinators.filter((row) => projectPane(props.snapshot, row)).map((row) => {
        const pane = projectPane(props.snapshot, row)!;
        const title = t("Coordinator") + " · " + project.name;
        return <li key={row.pane_id} className="project-thread">
          <button type="button" className="project-thread-select" disabled={!props.online} aria-current={props.selectedPaneId === row.pane_id ? "page" : undefined} aria-label={title} title={title} onClick={() => props.onSelect(row.pane_id)}>
            <span className="thread-number">{row.pane_id}</span><span className="thread-title">{t("Coordinator")}</span><StatusBadge status={props.online ? paneStatus(pane) : "unknown"} compact alwaysVisible />
          </button>
        </li>;
      })}
      {additional.map((pane) => <li key={pane.pane_id} className="project-thread">
        <button type="button" className="project-thread-select" disabled={!props.online} aria-current={props.selectedPaneId === pane.pane_id ? "page" : undefined} aria-label={displayPaneTitle(pane)} title={displayPaneTitle(pane)} onClick={() => props.onSelect(pane.pane_id)}>
          <span className="thread-number">{pane.pane_id}</span><span className="thread-title">{displayPaneTitle(pane)}</span><StatusBadge status={props.online ? paneStatus(pane) : "unknown"} compact alwaysVisible />
        </button>
      </li>)}
      {project.threads.map((thread) => <ThreadRow key={thread.id} {...props} thread={thread} summary={summaries.get(thread.pane_id)} />)}
    </ul>
  </section>;
}

function ThreadRow({ thread, summary, ...props }: Omit<Props, "catalog"> & { thread: ProjectThread; summary?: ThreadDiffSummary }) {
  const t = useT();
  const pane = projectPane(props.snapshot, thread);
  const status = props.online && pane ? paneStatus(pane) : "unknown";
  const missing = t(thread.lifecycle === "failed" ? "Failed" : thread.lifecycle === "starting" ? "Starting…" : "Not running");
  const state = !props.online ? t("Disconnected") : pane ? t(STATUS_WORD[status]) : missing;
  const title = `${thread.id} · ${thread.title} · ${state}`;
  const diffState = !props.online ? t("Disconnected") : !pane ? t("Not running") : !summary ? t("Loading changes…")
    : summary.state === "no-repo" ? t("No repository") : summary.state === "no-directory" ? t("No directory")
    : summary.state !== "ready" ? t("Changes unavailable") : summary.files === 0 && !summary.partial ? t("Clean")
    : `+${summary.additions} −${summary.deletions}${summary.untracked ? " · ?" + summary.untracked : ""}${summary.partial ? " *" : ""}`;
  const diffTitle = t("Working tree vs HEAD") + " · " + diffState + (summary?.partial ? " · " + t("Counts exclude unknown lines") : "");
  return <li className="project-thread" data-thread={thread.id}>
    <button type="button" className="project-thread-select" disabled={!props.online || !pane} aria-current={props.selectedPaneId === thread.pane_id ? "page" : undefined} aria-label={title} title={title} onClick={() => props.onSelect(thread.pane_id)}>
      <span className="thread-number">{thread.id}</span><span className="thread-title">{thread.title}</span><StatusBadge status={status} compact alwaysVisible />
    </button>
    <button type="button" className="thread-diff" disabled={!props.online || !pane} aria-label={t("Changes for {name}", { name: thread.title }) + " · " + diffTitle} title={diffTitle} onClick={() => props.onChanges(thread.pane_id, thread.directory)}>
      <GitCompareArrows aria-hidden="true" /><span className="thread-diff-count">{diffState}</span>
    </button>
  </li>;
}
