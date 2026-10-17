import { explorerPath } from "../../shared/explorer.ts";

/** Resolve a document link within its workspace. Absolute paths and root escapes never open. */
export function explorerLinkedPath(document: string, href: string): string | null {
  if (!href || /^(?:[a-z][a-z0-9+.-]*:|[/\\~#])/i.test(href)) return null;
  let target: string;
  try { target = decodeURIComponent(href.split(/[?#]/)[0]!); } catch { return null; }
  if (!target || /^(?:[a-z][a-z0-9+.-]*:|[/\\~])/i.test(target)) return null;
  const parts = document.split("/").slice(0, -1);
  for (const part of target.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") { if (!parts.length) return null; parts.pop(); }
    else parts.push(part);
  }
  return explorerPath(parts.join("/"));
}
