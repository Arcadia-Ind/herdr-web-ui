/** Explorer addresses contain identity and relative paths, never a client-selected root. */
export interface ExplorerContext {
  machine: string;
  project: string;
  workspace: string;
  thread: string | null;
  pane: string | null;
}

export function explorerIdentity(query: URLSearchParams): ExplorerContext | null {
  const machine = query.get("machine") ?? "local";
  const project = query.get("project") ?? "";
  const workspace = query.get("workspace") ?? "";
  const thread = query.get("thread");
  const pane = query.get("pane");
  const id = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
  return id.test(machine) && /^[a-z0-9][a-z0-9-]{0,79}$/.test(project) && id.test(workspace) &&
    (thread === null || /^t-\d{4,}$/.test(thread)) && (pane === null || id.test(pane))
    ? { machine, project, workspace, thread, pane } : null;
}

export function explorerContextQuery(context: ExplorerContext): URLSearchParams {
  return new URLSearchParams({ machine: context.machine, project: context.project, workspace: context.workspace,
    ...(context.thread ? { thread: context.thread } : {}), ...(context.pane ? { pane: context.pane } : {}) });
}

export interface ExplorerPairRule { source: string; description: string; suffix: string }
export interface ExplorerEntry {
  name: string;
  path: string;
  kind: "directory" | "file" | "blocked";
  size?: number;
}
export interface ExplorerListing {
  path: string;
  name: string;
  entries: ExplorerEntry[];
  truncated: boolean;
  pairing: ExplorerPairRule[];
}
export interface ExplorerFile {
  path: string;
  size: number;
  modified: string;
  kind: "text" | "binary" | "unsupported";
}

/** Reject ambiguous paths before asking either a local or remote filesystem. */
export function explorerPath(value: string, directory = false): string | null {
  if (directory && value === "") return "";
  if (!value || value.length > 4096 || /^[~\/\\]|^[a-z]:/i.test(value) || /[\\\x00-\x1f\x7f]/.test(value)) return null;
  return value.split("/").some((part) => !part || part === "." || part === "..") ? null : value;
}

/** Private configuration and native agent records are outside this read-only view. */
export function explorerPrivatePath(path: string): boolean {
  return path.split("/").some((part) => /^(?:\.git|\.ssh|\.aws|\.codex|\.claude|\.herdr|\.herdr-projects|\.config|\.local|\.gnupg|\.kube|\.azure|\.npmrc|\.netrc|\.pypirc|\.env(?:\..*)?|credentials(?:\..*)?|secrets?(?:\..*)?|id_(?:rsa|ed25519)(?:\.pub)?)$/i.test(part) || /\.(?:pem|key|p12|pfx)$/i.test(part));
}
