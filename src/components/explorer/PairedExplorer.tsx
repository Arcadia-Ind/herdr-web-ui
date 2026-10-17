import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Code, ExternalLink, Files, RefreshCw, X } from "lucide-react";

import type { ExplorerListing } from "../../../shared/explorer.ts";
import { explorerPath } from "../../../shared/explorer.ts";
import { workspaceExplorerApi, type ExplorerApi } from "../../lib/explorerApi.ts";
import { explorerFromSearch, explorerHref, type ExplorerTarget } from "../../lib/explorerRoute.ts";
import { closeExplorerTab, openExplorerTab, restoreExplorerState, selectExplorerMember, toggleExplorerCode, type ExplorerState } from "../../lib/explorerState.ts";
import { useT } from "../../lib/i18n.ts";
import { ExplorerDocument } from "./ExplorerDocument.tsx";
import { ExplorerTree } from "./ExplorerTree.tsx";
import "./PairedExplorer.css";

export interface PairedExplorerProps {
  target: ExplorerTarget;
  /** Fixtures use an in-memory read-only API. The real API preserves existing cookie gates. */
  api?: ExplorerApi;
  /** Disable for a host whose own router owns history; onNavigate then receives the full state. */
  history?: boolean;
  onNavigate?: (target: ExplorerTarget) => void;
  onClose?: () => void;
  /** Synthetic fixtures can provide their root listing for the first paint. */
  initialListing?: ExplorerListing;
}

/** A view only: this component creates no terminal, sends no agent input, and writes no files. */
export function PairedExplorer({ target: initial, api = workspaceExplorerApi, history = true, onNavigate, onClose, initialListing }: PairedExplorerProps) {
  const t = useT();
  const [target, setTarget] = useState(initial);
  const [listing, setListing] = useState<ExplorerListing | null>(initialListing ?? null);
  const [hidden, setHidden] = useState(false);
  const [revision, setRevision] = useState(0);
  const [failed, setFailed] = useState(false);
  const [limit, setLimit] = useState(false);
  const propIdentity = JSON.stringify(initial.context);
  const propState = JSON.stringify(initial.state);
  const identity = JSON.stringify(target.context);
  const current = useRef(target);
  current.current = target;
  // An app selection supplies new authority; stale files disappear before its root is loaded.
  useEffect(() => { setTarget(initial); setListing(null); setRevision((value) => value + 1); }, [propIdentity, propState]);
  useEffect(() => {
    if (!history) return;
    const pop = () => {
      const next = explorerFromSearch(window.location.search);
      if (next) { setTarget(next); setListing(null); setRevision((value) => value + 1); onNavigate?.(next); }
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [history, onNavigate]);
  useEffect(() => {
    const controller = new AbortController();
    setListing(null);
    setFailed(false);
    void api.list(target.context, "", hidden, controller.signal).then((next) => {
      if (controller.signal.aborted) return;
      setListing(next);
      setTarget((saved) => ({ ...saved, state: restoreExplorerState(saved.state, next.pairing) }));
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [api, identity, hidden, revision]);
  // Revalidate Back/Forward tab members as well as first-load members.
  const navigate = useCallback((state: ExplorerState) => {
    const next = { context: current.current.context, state };
    setTarget(next);
    onNavigate?.(next);
    if (history) window.history.pushState(null, "", explorerHref(next, window.location.pathname));
  }, [history, onNavigate]);
  const open = useCallback((path: string) => {
    if (!listing || explorerPath(path) === null) return;
    const previous = current.current.state;
    const next = openExplorerTab(previous, path, listing.pairing);
    setLimit(next === previous);
    navigate(next);
  }, [listing, navigate]);
  const state = target.state;
  const active = state.tabs.find((tab) => tab.id === state.active);
  const selected = active?.[active.selected] ?? null;
  const openLink = (path: string) => { if (explorerPath(path) !== null) open(path); };
  const tabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = state.tabs.length - 1;
    const next = event.key === "ArrowRight" ? (index + 1) % state.tabs.length : event.key === "ArrowLeft" ? (index + last) % state.tabs.length : event.key === "Home" ? 0 : event.key === "End" ? last : null;
    if (next !== null) { event.preventDefault(); navigate({ ...state, active: state.tabs[next]!.id }); event.currentTarget.closest('[role="tablist"]')?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus(); }
    if (event.key === "Delete") { event.preventDefault(); navigate(closeExplorerTab(state, state.tabs[index]!.id)); }
  };
  return <section className="paired-explorer" aria-label={t("File explorer")}>
    <header className="explorer-toolbar">
      <Files aria-hidden="true" /><strong>{target.context.project}{target.context.thread ? " / " + target.context.thread : ""}</strong>
      <span className="explorer-read-only">{t("Read only")}</span>
      <button type="button" className="icon-button" title={t("Refresh")} aria-label={t("Refresh")} onClick={() => setRevision((value) => value + 1)}><RefreshCw aria-hidden="true" /></button>
      <a className="icon-button" href={explorerHref(target)} target="_blank" rel="noopener noreferrer" title={t("Open in a new tab")} aria-label={t("Open in a new tab")}><ExternalLink aria-hidden="true" /></a>
      {onClose && <button type="button" className="icon-button" aria-label={t("Close files")} onClick={onClose}><X aria-hidden="true" /></button>}
    </header>
    <div className="explorer-workspace">
      <aside className="explorer-sidebar">
        <header><strong>{listing?.name ?? target.context.project}</strong><label><input type="checkbox" checked={hidden} onChange={(event) => setHidden(event.target.checked)} />{t("Show hidden")}</label></header>
        {listing ? <ExplorerTree key={identity + revision} context={target.context} api={api} listing={listing} hidden={hidden} selected={selected} onOpen={open} />
          : <div className="explorer-note" role={failed ? "alert" : "status"}>{t(failed ? "Workspace files could not be loaded." : "Opening…")}{failed && <button type="button" className="btn btn-sm" onClick={() => setRevision((value) => value + 1)}>{t("Retry")}</button>}</div>}
      </aside>
      <div className="explorer-readers">
        <div className="explorer-tabs" role="tablist" aria-label={t("Files")}>
          {state.tabs.map((tab, index) => <div className="explorer-tab" key={tab.id} data-active={state.active === tab.id || undefined}>
            <button type="button" role="tab" aria-selected={state.active === tab.id} tabIndex={state.active === tab.id ? 0 : -1} title={tab.id} onClick={() => navigate({ ...state, active: tab.id })} onKeyDown={(event) => tabKey(event, index)}>{tab.id.split("/").pop()}</button>
            <button type="button" className="icon-button" aria-label={t("Close pair {name}", { name: tab.id.split("/").pop() ?? tab.id })} onClick={() => navigate(closeExplorerTab(state, tab.id))}><X aria-hidden="true" /></button>
          </div>)}
        </div>
        {limit && <p className="explorer-note" role="status">{t("The tab limit has been reached.")}</p>}
        {active && listing ? <>
          <div className="explorer-member-tabs">
            {active.description && <button type="button" aria-pressed={active.selected === "description"} onClick={() => navigate(selectExplorerMember(state, active.id, "description"))}>{t(active.code ? "Pseudocode" : "Preview")}</button>}
            {active.code && <button type="button" aria-pressed={active.selected === "code"} onClick={() => navigate(selectExplorerMember(state, active.id, "code"))}>{t("Source")}</button>}
            {active.code && active.description && <button type="button" className="btn btn-sm" aria-expanded={active.showCode} onClick={() => navigate(toggleExplorerCode(state, active.id))}><Code aria-hidden="true" />{t(active.showCode ? "Hide code" : "Show code")}</button>}
          </div>
          <div className="explorer-pair" data-split={Boolean(active.description && active.code && active.showCode) || undefined}>
            {active.description && <ExplorerDocument key={identity + active.description + revision} context={target.context} path={active.description} api={api} selected={active.selected === "description"} onOpen={openLink} />}
            {active.code && (active.showCode || !active.description) && <ExplorerDocument key={identity + active.code + revision} context={target.context} path={active.code} api={api} selected={active.selected === "code"} onOpen={openLink} />}
          </div>
        </> : <div className="explorer-empty"><Files aria-hidden="true" /><p>{t("Select a file.")}</p></div>}
      </div>
    </div>
  </section>;
}
