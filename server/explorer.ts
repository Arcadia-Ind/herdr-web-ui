import { constants } from "node:fs";
import { lstat, open, opendir, realpath, stat, type FileHandle } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";

import type { ProjectCatalog } from "../shared/customization.ts";
import { explorerIdentity, explorerPath, explorerPrivatePath, type ExplorerContext, type ExplorerFile, type ExplorerListing, type ExplorerPairRule } from "../shared/explorer.ts";
import type { SessionSnapshot } from "../shared/protocol.ts";
import { MAX_DIRECTORY_ENTRIES } from "./directories.ts";
import { crossSiteFileRead } from "./file-view.ts";
import { jsonResponse } from "./http.ts";

// These are the existing source reader's byte budgets, without importing client code.
const MAX_PREVIEW_BYTES = 8 * 1024 * 1024;
const MAX_DECLARATION_BYTES = 128 * 1024;
const NO_STORE = { "cache-control": "private, no-store" };

export class ExplorerError extends Error {
  constructor(readonly code: string, message: string, readonly status = 403) { super(message); }
}
const denied = (): never => { throw new ExplorerError("outside_workspace", "This path is outside the workspace."); };
const missing = (): never => { throw new ExplorerError("not_found", "This file or folder cannot be opened.", 404); };

/** Session and catalog records supply every root. A client path never supplies one. */
export function resolveExplorerRoot(context: ExplorerContext, catalog: ProjectCatalog, snapshot: SessionSnapshot): string {
  const project = catalog.projects.find((row) => row.id === context.project);
  if (!project) return denied();
  if (context.thread !== null) {
    const thread = project.threads.find((row) => row.id === context.thread);
    if (!thread || thread.workspace_id !== context.workspace || context.pane !== thread.pane_id) return denied();
    const pane = snapshot.panes.find((row) => row.pane_id === thread.pane_id);
    if (pane && pane.workspace_id !== thread.workspace_id) return denied();
    const directory = thread.directory ?? pane?.foreground_cwd ?? pane?.cwd;
    if (!directory || !isAbsolute(directory)) return missing();
    return directory;
  }
  const owner = project.coordinators.find((row) => row.pane_id === context.pane && row.workspace_id === context.workspace);
  const pane = snapshot.panes.find((row) => row.pane_id === owner?.pane_id && row.workspace_id === context.workspace);
  const directory = pane?.foreground_cwd ?? pane?.cwd;
  if (!owner || !directory || !isAbsolute(directory)) return denied();
  return directory;
}

function contains(root: string, path: string): boolean {
  const child = relative(root, path);
  return child === "" || !isAbsolute(child) && child !== ".." && !child.startsWith(".." + sep);
}

/** Both lexical and physical paths must remain inside the same granted root. */
async function safePath(root: string, path: string, directory = false): Promise<string> {
  if (explorerPath(path, directory) === null || explorerPrivatePath(path)) return denied();
  const target = resolve(root, path);
  if (!contains(root, target)) return denied();
  let physical: string;
  try { physical = await realpath(target); } catch { return missing(); }
  if (!contains(root, physical) || explorerPrivatePath(relative(root, physical).split(sep).join("/"))) return denied();
  return physical;
}

/** Pin the validated regular file before reading. Replaced files and special devices fail closed. */
async function safeFile(root: string, path: string): Promise<{ file: FileHandle; size: number; modified: string }> {
  const physical = await safePath(root, path);
  const expected = await lstat(physical);
  if (!expected.isFile()) return missing();
  const file = await open(physical, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const actual = await file.stat();
    if (!actual.isFile() || actual.ino !== expected.ino || actual.dev !== expected.dev || await safePath(root, path) !== physical) return denied();
    return { file, size: actual.size, modified: actual.mtime.toISOString() };
  } catch (error) { await file.close(); throw error; }
}

async function fileKind(file: FileHandle, size: number, path: string): Promise<ExplorerFile["kind"]> {
  if (/^(?:image\/(?!svg\+xml)|video\/|audio\/|application\/pdf)/.test(Bun.file(path).type)) return "unsupported";
  const bytes = Buffer.alloc(Math.min(size, 8192));
  const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
  const prefix = bytes.subarray(0, bytesRead);
  if (prefix.includes(0)) return "binary";
  try { new TextDecoder("utf-8", { fatal: true }).decode(prefix, { stream: true }); }
  catch { return "unsupported"; }
  return "text";
}

/** Read the mapping that Sim declares. A matching basename alone enables no pairing. */
export async function declaredExplorerPairs(root: string): Promise<ExplorerPairRule[]> {
  for (const prefix of ["software/", ""]) {
    let file: FileHandle | null = null;
    try {
      const opened = await safeFile(root, prefix + "DEVELOPMENT.md");
      file = opened.file;
      if (opened.size > MAX_DECLARATION_BYTES) continue;
      const buffer = Buffer.alloc(MAX_DECLARATION_BYTES);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      const text = buffer.subarray(0, bytesRead).toString("utf8").replace(/\s+/g, " ");
      const declaration = "Mirror descriptions using `src/<path>` to `pseudocode/<path>.md`.";
      if (!text.includes(declaration)) continue;
      for (const folder of ["src", "pseudocode"]) if (!(await stat(await safePath(root, prefix + folder, true))).isDirectory()) return [];
      return [{ source: prefix + "src/", description: prefix + "pseudocode/", suffix: ".md" }];
    } catch { /* An undeclared or inaccessible mapping enables no pairs. */ }
    finally { await file?.close(); }
  }
  return [];
}

export async function explorerList(root: string, path = "", hidden = false): Promise<ExplorerListing> {
  const physical = await safePath(root, path, true);
  const folder = await opendir(physical);
  const entries: ExplorerListing["entries"] = [];
  let examined = 0;
  let truncated = false;
  for await (const entry of folder) {
    if (++examined > MAX_DIRECTORY_ENTRIES) { truncated = true; break; }
    const child = path ? path + "/" + entry.name : entry.name;
    if (explorerPrivatePath(child) || !hidden && entry.name.startsWith(".")) continue;
    try {
      const target = await safePath(root, child);
      const info = await stat(target);
      entries.push({ name: entry.name, path: child, kind: info.isDirectory() ? "directory" : info.isFile() ? "file" : "blocked",
        ...(info.isFile() ? { size: info.size } : {}) });
    } catch { entries.push({ name: entry.name, path: child, kind: "blocked" }); }
  }
  entries.sort((a, b) => Number(b.kind === "directory") - Number(a.kind === "directory") || a.name.localeCompare(b.name, undefined, { numeric: true }));
  return { path, name: basename(root), entries, truncated, pairing: await declaredExplorerPairs(root) };
}

export async function explorerStat(root: string, path: string): Promise<ExplorerFile> {
  const opened = await safeFile(root, path);
  try { return { path, size: opened.size, modified: opened.modified, kind: await fileKind(opened.file, opened.size, path) }; }
  finally { await opened.file.close(); }
}

/** Stream from the checked descriptor. Download is explicit; ordinary previews retain the source byte cap. */
export async function explorerFile(root: string, path: string, request: Request): Promise<Response> {
  const opened = await safeFile(root, path);
  let transferred = false;
  try {
    const download = new URL(request.url).searchParams.get("download") === "1";
    if (!download && await fileKind(opened.file, opened.size, path) !== "text") throw new ExplorerError("unsupported_file", "This file has no text preview.", 415);
    const range = request.headers.get("range");
    const requested = range === null ? MAX_PREVIEW_BYTES : /^bytes=0-(\d+)$/.exec(range)?.[1];
    if (requested === undefined) throw new ExplorerError("invalid_range", "Use a preview range that starts at zero.", 416);
    const length = download ? opened.size : Math.min(opened.size, MAX_PREVIEW_BYTES, range === null ? MAX_PREVIEW_BYTES : Number(requested) + 1);
    const headers: Record<string, string> = {
      ...NO_STORE, "content-type": download ? "application/octet-stream" : "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff", "content-security-policy": "sandbox; default-src 'none'",
      "content-length": String(length), "content-disposition": (download ? "attachment" : "inline") + "; filename*=UTF-8''" + encodeURIComponent(basename(path)),
    };
    const partial = length < opened.size;
    if (partial) headers["content-range"] = "bytes 0-" + (length - 1) + "/" + opened.size;
    if (request.method === "HEAD") return new Response(null, { status: partial ? 206 : 200, headers });
    let offset = 0;
    let closed = false;
    const close = async () => { if (!closed) { closed = true; request.signal.removeEventListener("abort", abort); await opened.file.close(); } };
    const abort = () => { void close(); };
    request.signal.addEventListener("abort", abort, { once: true });
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          if (closed || request.signal.aborted) { await close(); controller.error(new Error("File preview aborted.")); return; }
          if (offset >= length) { await close(); controller.close(); return; }
          const buffer = Buffer.alloc(Math.min(64 * 1024, length - offset));
          const { bytesRead } = await opened.file.read(buffer, 0, buffer.length, offset);
          if (bytesRead === 0) { await close(); controller.close(); return; }
          offset += bytesRead;
          controller.enqueue(buffer.subarray(0, bytesRead));
        } catch (error) { await close(); controller.error(error); }
      },
      cancel: close,
    });
    transferred = true;
    return new Response(body, { status: partial ? 206 : 200, headers });
  } finally { if (!transferred) await opened.file.close(); }
}

export interface ExplorerDependencies {
  /** Supply authenticated && !readOnly from the existing bridge access decision. */
  canRead: boolean;
  catalog: () => Promise<ProjectCatalog>;
  snapshot: () => Promise<SessionSnapshot>;
}

/** Mount after the bridge's normal authentication, origin, and read-only role gates. */
export async function explorerResponse(request: Request, dependencies: ExplorerDependencies): Promise<Response> {
  try {
    if (!dependencies.canRead) throw new ExplorerError("read_only", "Workspace files need full access.");
    const url = new URL(request.url);
    if (!["GET", "HEAD"].includes(request.method)) throw new ExplorerError("method_not_allowed", "Use GET or HEAD.", 405);
    if (crossSiteFileRead(request)) throw new ExplorerError("cross_site", "Read workspace files from this app.");
    const allowed = new Set(["machine", "project", "workspace", "thread", "pane", "path", "hidden", "download"]);
    if ([...url.searchParams.keys()].some((key) => !allowed.has(key) || url.searchParams.getAll(key).length !== 1)) return denied();
    const context = explorerIdentity(url.searchParams);
    if (!context) return denied();
    // A remote proxy must preserve identity while resolving it on the owning machine.
    if (context.machine !== "local") throw new ExplorerError("remote_unavailable", "This explorer is not available on that PC.", 409);
    const [catalog, snapshot] = await Promise.all([dependencies.catalog(), dependencies.snapshot()]);
    const root = await realpath(resolveExplorerRoot(context, catalog, snapshot));
    const path = url.searchParams.get("path") ?? "";
    if (url.pathname.endsWith("/list")) return jsonResponse(await explorerList(root, path, url.searchParams.get("hidden") === "1"), 200, NO_STORE);
    if (url.pathname.endsWith("/stat")) return jsonResponse(await explorerStat(root, path), 200, NO_STORE);
    if (url.pathname.endsWith("/file")) return await explorerFile(root, path, request);
    throw new ExplorerError("not_found", "This explorer route does not exist.", 404);
  } catch (error) {
    const known = error instanceof ExplorerError ? error : new ExplorerError("unavailable", "The workspace could not be read.", 404);
    return jsonResponse({ error: { code: known.code, message: known.message } }, known.status, NO_STORE);
  }
}
