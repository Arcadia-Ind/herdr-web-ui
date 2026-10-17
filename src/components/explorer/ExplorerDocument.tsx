import { useEffect, useMemo, useRef, useState } from "react";

import type { ExplorerContext, ExplorerFile } from "../../../shared/explorer.ts";
import type { ExplorerApi } from "../../lib/explorerApi.ts";
import { explorerLinkedPath } from "../../lib/explorerLinks.ts";
import { OpenFileContext } from "../../lib/filePaths.ts";
import type { FilePreviewText } from "../../lib/filePreviewText.ts";
import { languageForPath, countLines, normalizeCode } from "../../lib/highlight.ts";
import { useT } from "../../lib/i18n.ts";
import { useSettings } from "../../lib/settings.ts";
import type { MarkdownBlock } from "../../lib/markdown.ts";
import { knownPreview, parsePreviewOffThread } from "../../lib/markdownPreview.ts";
import { shownSource, sourceLayout, virtualHighlightable } from "../../lib/sourcePreview.ts";
import { useHighlightedLines } from "../HighlightedCode.tsx";
import { RenderBoundary } from "../RenderBoundary.tsx";
import { TextFileView } from "../TextFileView.tsx";
import { MarkdownImageContext, ProgressiveMarkdown } from "../Markdown.tsx";
import "../FileViewer.css";

type DocumentResult = { file: ExplorerFile; preview: FilePreviewText | null } | { error: string };

/** One read-only member. A group or context change cancels every outstanding read. */
export function ExplorerDocument({ context, path, api, selected, onOpen }: {
  context: ExplorerContext; path: string; api: ExplorerApi; selected: boolean; onOpen: (path: string) => void;
}) {
  const t = useT();
  const { settings } = useSettings();
  const [result, setResult] = useState<DocumentResult | null>(null);
  const [revision, setRevision] = useState(0);
  const [raw, setRaw] = useState(false);
  const surface = useRef<HTMLElement>(null);
  const sourceRef = useRef<HTMLElement>(null);
  useEffect(() => { if (selected) surface.current?.focus({ preventScroll: true }); }, [selected]);
  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    void api.stat(context, path, controller.signal).then(async (file) => {
      const preview = file.kind === "text" ? await api.read(context, file, controller.signal) : null;
      if (!controller.signal.aborted) setResult({ file, preview });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setResult({ error: (error as { code?: string }).code === "not_found" ? "missing" : "unavailable" });
    });
    return () => controller.abort();
  }, [context, path, api, revision]);
  const preview = result && "preview" in result ? result.preview : null;
  const text = useMemo(() => shownSource(preview?.text ?? "", preview?.truncated ?? false), [preview]);
  const language = languageForPath(path);
  const markdown = /\.(?:md|markdown)$/i.test(path);
  const normalized = useMemo(() => normalizeCode(text), [text]);
  const count = useMemo(() => countLines(normalized), [normalized]);
  const virtual = sourceLayout(count) === "virtual";
  const highlighted = useHighlightedLines(virtual ? "" : text, language);
  const [blocks, setBlocks] = useState<MarkdownBlock[] | null>(null);
  useEffect(() => {
    setBlocks(null);
    if (!markdown || raw || preview === null) return;
    const known = knownPreview(text);
    if (known !== undefined) { setBlocks(known); return; }
    let live = true;
    const job = parsePreviewOffThread(text);
    void job.promise.then((next) => { if (live) setBlocks(next); });
    return () => { live = false; job.cancel(); };
  }, [text, markdown, raw, preview]);
  return <section ref={surface} className="explorer-document" tabIndex={-1} aria-label={path} data-selected={selected || undefined}>
    <header className="explorer-document-header">
      <span title={path}>{path}</span>
      {markdown && preview !== null && <button type="button" className="btn btn-sm" aria-pressed={raw} onClick={() => setRaw((value) => !value)}>{t(raw ? "Preview" : "Source")}</button>}
      {result && "file" in result && <a className="btn btn-sm" href={api.download(context, path)} download>{t("Download")}</a>}
    </header>
    {result === null ? <p className="explorer-note" role="status">{t("Opening…")}</p> : "error" in result
      ? <div className="explorer-note" role="alert"><p>{t(result.error === "missing" ? "No matching file is available." : "Workspace files could not be loaded.")}</p><button type="button" className="btn btn-sm" onClick={() => setRevision((value) => value + 1)}>{t("Retry")}</button></div>
      : preview === null ? <p className="explorer-note">{t("This file has no text preview.")}</p>
        : <><div className="explorer-document-status">{preview.truncated && <span role="status">{t("Preview is incomplete.")}</span>}</div>
          <RenderBoundary resetKey={path + revision} fallback={() => <p className="explorer-note">{t("This file has no text preview.")}</p>}>
            <MarkdownImageContext.Provider value={null}>{blocks !== null
              ? <OpenFileContext.Provider value={(href) => { const linked = explorerLinkedPath(path, href); if (linked) onOpen(linked); }}>
                <div className="file-viewer-content"><ProgressiveMarkdown className={settings.markdownWidth === "readable" ? "file-viewer-markdown file-viewer-markdown-readable" : "file-viewer-markdown"} blocks={blocks} /></div>
              </OpenFileContext.Provider>
              : <TextFileView path={path} blocks={null} lines={highlighted.lines}
              virtual={virtual ? { text: normalized, colored: virtualHighlightable(normalized.length, count) } : null}
              selectable={false} onOpen={onOpen} sourceRef={sourceRef} markedLine={null} />}</MarkdownImageContext.Provider>
          </RenderBoundary></>}
  </section>;
}
