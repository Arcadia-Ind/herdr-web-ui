import { useContext, useEffect, useRef, type ReactNode } from "react";
import type { ExplorerTarget } from "../../lib/explorerRoute.ts";
import { PanePresentedContext } from "../../lib/paneSubmitContext.ts";
import { PairedExplorer } from "./PairedExplorer.tsx";
import "./AppExplorerPane.css";

/** Cover the browser canvas without changing its box or the native terminal geometry. */
export function AppExplorerPane({ target, onNavigate, onClose }: {
  target: ExplorerTarget; onNavigate: (target: ExplorerTarget) => void; onClose: () => void;
}) {
  const focus = useRef<HTMLDivElement>(null);
  useEffect(() => { focus.current?.focus({ preventScroll: true }); }, []);
  return <div className="app-explorer-pane" ref={focus} tabIndex={-1}>
    <PairedExplorer target={target} history={false} onNavigate={onNavigate} onClose={onClose} />
  </div>;
}

/** Cached off-tab panes stay off-tab when the explorer closes. */
export function ExplorerBackground({ covered, children }: { covered: boolean; children: ReactNode }) {
  const presented = useContext(PanePresentedContext);
  return <PanePresentedContext.Provider value={presented && !covered}>{children}</PanePresentedContext.Provider>;
}
