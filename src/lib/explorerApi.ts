import { explorerContextQuery, type ExplorerContext, type ExplorerFile, type ExplorerListing } from "../../shared/explorer.ts";
import { readFilePreviewText, type FilePreviewText } from "./filePreviewText.ts";
import { languageForPath } from "./highlight.ts";
import { readBudget } from "./sourcePreview.ts";

export interface ExplorerApi {
  list(context: ExplorerContext, path: string, hidden: boolean, signal: AbortSignal): Promise<ExplorerListing>;
  stat(context: ExplorerContext, path: string, signal: AbortSignal): Promise<ExplorerFile>;
  read(context: ExplorerContext, file: ExplorerFile, signal: AbortSignal): Promise<FilePreviewText>;
  download(context: ExplorerContext, path: string): string;
}

export function explorerApiUrl(context: ExplorerContext, action: "list" | "stat" | "file", path: string, extra: Record<string, string> = {}): string {
  const query = explorerContextQuery(context);
  query.set("path", path);
  for (const [key, value] of Object.entries(extra)) query.set(key, value);
  return "/api/workspace/explorer/" + action + "?" + query.toString();
}

async function get<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, credentials: "same-origin", cache: "no-store" });
  if (!response.ok) {
    const error = new Error("Workspace files could not be loaded.") as Error & { code?: string };
    const body = await response.json().catch(() => null) as { error?: { code?: string } } | null;
    error.code = body?.error?.code;
    throw error;
  }
  return response.json() as Promise<T>;
}

export const workspaceExplorerApi: ExplorerApi = {
  list: (context, path, hidden, signal) => get(explorerApiUrl(context, "list", path, { hidden: hidden ? "1" : "0" }), signal),
  stat: (context, path, signal) => get(explorerApiUrl(context, "stat", path), signal),
  async read(context, file, signal) {
    const budget = readBudget(languageForPath(file.path), file.size);
    const timeout = AbortSignal.timeout(budget.timeoutMs);
    const combined = AbortSignal.any([signal, timeout]);
    const response = await fetch(explorerApiUrl(context, "file", file.path), {
      signal: combined, credentials: "same-origin", cache: "no-store",
      headers: { Range: "bytes=0-" + (budget.bytes - 1) },
    });
    const preview = await readFilePreviewText(response, budget.bytes, { signal: combined, timeoutMs: budget.timeoutMs, maxLines: budget.lines });
    if (preview.text.includes("\0")) throw new Error("This file has no text preview.");
    return preview;
  },
  download: (context, path) => explorerApiUrl(context, "file", path, { download: "1" }),
};
