import { afterEach, expect, it } from "bun:test";
import { explorerApiUrl, workspaceExplorerApi } from "./explorerApi.ts";

const originalFetch = globalThis.fetch;
function setFetch(implementation: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): void {
  globalThis.fetch = Object.assign(implementation, { preconnect: originalFetch.preconnect });
}
afterEach(() => { globalThis.fetch = originalFetch; });
const context = { machine: "local", project: "sim", thread: "t-0165", workspace: "w68", pane: "w68:p1" };
const file = { path: "software/src/unit.cpp", size: 100, modified: "", kind: "text" as const };

it("keeps every context identity in list, stat, text and download requests", async () => {
  const seen: string[] = [];
  setFetch(async (input: RequestInfo | URL) => {
    seen.push(String(input));
    return new Response('{"path":"software/src/unit.cpp","size":0,"kind":"text"}');
  });
  const signal = new AbortController().signal;
  await workspaceExplorerApi.list(context, "", false, signal);
  await workspaceExplorerApi.stat(context, file.path, signal);
  await workspaceExplorerApi.read(context, file, signal);
  seen.push(workspaceExplorerApi.download(context, file.path));
  for (const url of seen) {
    const query = new URL(url, "http://fixture").searchParams;
    for (const [key, value] of Object.entries(context)) expect(query.get(key)).toBe(value);
    expect(query.has("root")).toBe(false);
  }
  expect(explorerApiUrl(context, "file", "docs/A #1.md")).toContain("path=docs%2FA+%231.md");
});

it("never renders an HTTP refusal as source text", async () => {
  setFetch(async () => new Response("private failure", { status: 403 }));
  await expect(workspaceExplorerApi.read(context, file, new AbortController().signal)).rejects.toThrow("could not be opened");
});

it("bounds a peer that ignores Range and marks a large preview as incomplete", async () => {
  setFetch(async (_input: RequestInfo | URL, init?: RequestInit) => {
    expect((init?.headers as Record<string, string>).Range).toBe("bytes=0-262143");
    return new Response("a".repeat(262145));
  });
  const result = await workspaceExplorerApi.read(context, file, new AbortController().signal);
  expect(result.text).toHaveLength(262144);
  expect(result.truncated).toBe(true);
});

it("rejects late binary bytes and cancels an obsolete read", async () => {
  setFetch(async () => new Response("header\0private"));
  await expect(workspaceExplorerApi.read(context, file, new AbortController().signal)).rejects.toThrow("no text preview");
  const controller = new AbortController();
  controller.abort();
  await expect(workspaceExplorerApi.read(context, file, controller.signal)).rejects.toThrow("aborted");
});
