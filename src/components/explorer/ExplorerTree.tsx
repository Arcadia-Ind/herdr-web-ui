import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Folder, LockKeyhole } from "lucide-react";

import type { ExplorerContext, ExplorerEntry, ExplorerListing } from "../../../shared/explorer.ts";
import type { ExplorerApi } from "../../lib/explorerApi.ts";
import { useT } from "../../lib/i18n.ts";
import { FileGlyph } from "../FileGlyph.tsx";

interface TreeProps {
  context: ExplorerContext; api: ExplorerApi; listing: ExplorerListing; hidden: boolean;
  selected: string | null; onOpen: (path: string) => void;
}

export function ExplorerTree(props: TreeProps) {
  const t = useT();
  return <ul className="explorer-tree" aria-label={t("Files")}>
    {props.listing.entries.map((entry) => <TreeEntry key={entry.path} {...props} entry={entry} />)}
    {props.listing.truncated && <li className="explorer-note" role="status">{t("Folder list is incomplete.")}</li>}
  </ul>;
}

function TreeEntry({ entry, ...props }: TreeProps & { entry: ExplorerEntry }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [listing, setListing] = useState<ExplorerListing | null>(null);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!expanded || entry.kind !== "directory") return;
    const controller = new AbortController();
    setListing(null);
    setFailed(false);
    void props.api.list(props.context, entry.path, props.hidden, controller.signal).then((next) => {
      if (!controller.signal.aborted) setListing(next);
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [expanded, entry.kind, entry.path, props.api, props.context, props.hidden, revision]);
  const directory = entry.kind === "directory";
  const blocked = entry.kind === "blocked";
  return <li>
    <button type="button" className="explorer-tree-entry" disabled={blocked}
      aria-expanded={directory ? expanded : undefined} aria-current={props.selected === entry.path ? "page" : undefined}
      title={entry.path} onClick={() => directory ? setExpanded((value) => !value) : props.onOpen(entry.path)}>
      {directory ? <>{expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}<Folder aria-hidden="true" /></>
        : blocked ? <LockKeyhole aria-hidden="true" /> : <FileGlyph name={entry.path} />}
      <span>{entry.name}</span>
    </button>
    {expanded && (listing ? <ExplorerTree {...props} listing={listing} /> : <div className="explorer-note" role="status">
      {failed ? <button type="button" className="btn btn-sm" onClick={() => setRevision((value) => value + 1)}>{t("Retry")}</button> : t("Opening…")}
    </div>)}
  </li>;
}
