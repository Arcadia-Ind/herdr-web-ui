import { useEffect, useState } from "react";

import type { AccessRefusal } from "../../../shared/protocol.ts";
import { fetchBridgeHealth } from "../../lib/api.ts";
import type { ExplorerTarget } from "../../lib/explorerRoute.ts";
import { useT } from "../../lib/i18n.ts";
import { AccessGate } from "../AccessGate.tsx";
import { ChunkFailureNotice } from "../UpdateControls.tsx";
import { PairedExplorer } from "./PairedExplorer.tsx";

/** A standalone explorer uses the same cookie gate, without attaching a terminal. */
export function ExplorerReader({ target }: { target: ExplorerTarget | null }) {
  const t = useT();
  if (target === null) return <main className="explorer-note" role="alert">{t("Workspace files could not be loaded.")}</main>;
  return <AuthenticatedExplorer target={target} />;
}

function AuthenticatedExplorer({ target }: { target: ExplorerTarget }) {
  const t = useT();
  const [locked, setLocked] = useState<boolean | null>(null);
  const [reason, setReason] = useState<AccessRefusal | null>(null);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    setFailed(false);
    void fetchBridgeHealth().then((health) => {
      if (!live) return;
      setLocked(health.auth.required && !health.auth.authenticated);
      setReason(health.auth.reason ?? null);
    }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [revision]);
  if (failed) return <main className="explorer-note" role="alert"><p>{t("Workspace files could not be loaded.")}</p><button type="button" className="btn" onClick={() => setRevision((value) => value + 1)}>{t("Retry")}</button></main>;
  if (locked === null) return <main className="explorer-note" role="status">{t("Opening…")}</main>;
  if (locked) return <AccessGate reason={reason} initialCode="" onUnlocked={() => setLocked(false)} />;
  return <main className="explorer-reader"><ChunkFailureNotice /><PairedExplorer target={target} /></main>;
}
