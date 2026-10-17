import type { ExplorerContext, ExplorerListing, ExplorerPairRule } from "../../../shared/explorer.ts";
import type { ExplorerApi } from "../../lib/explorerApi.ts";
import { emptyExplorerState, openExplorerTab } from "../../lib/explorerState.ts";
import type { ExplorerTarget } from "../../lib/explorerRoute.ts";
import { PairedExplorer } from "./PairedExplorer.tsx";

/** Fictional files only. Mount under SettingsProvider; this fixture contacts no API or native session. */
const files: Record<string, string | null> = {
  "software/src/drive/control.cpp": "// CONTROL-001 advance_control.\nint advance_control(int request) {\n  return request;\n}\n",
  "software/pseudocode/drive/control.cpp.md": "# Drive control\n\n## CONTROL-001 advance_control\n\nReturn the accepted request.\n\n```text\nRETURN request.\n```\n",
  "software/src/drive/unpaired.py": "# No description exists for this file.\nprint('sample')\n",
  "docs/README.md": "# Read-only file explorer\n\nOpen two groups. Hide the code. Close a pair.\n\nThis fixture contains no user files.\n",
  "assets/model.bin": null,
  "logs/large.log": "line one\nline two\n",
};
export const explorerFixtureContext: ExplorerContext = { machine: "local", project: "demo", thread: "t-0001", workspace: "w1", pane: "w1:p1" };
export const explorerFixturePairs: ExplorerPairRule[] = [{ source: "software/src/", description: "software/pseudocode/", suffix: ".md" }];
const encoder = new TextEncoder();

function fixtureListing(path: string): ExplorerListing {
  const entries: ExplorerListing["entries"] = [];
  const names = new Set<string>();
  const prefix = path ? path + "/" : "";
  for (const [file, text] of Object.entries(files)) {
    if (!file.startsWith(prefix)) continue;
    const tail = file.slice(prefix.length);
    const name = tail.split("/")[0]!;
    if (names.has(name)) continue;
    names.add(name);
    entries.push({ name, path: prefix + name, kind: tail.includes("/") ? "directory" : "file", size: text === null ? 3 : encoder.encode(text).length });
  }
  return { path, name: "example-workspace", pairing: explorerFixturePairs, entries, truncated: false };
}
export const explorerFixtureListing = fixtureListing("");
export const explorerFixtureApi: ExplorerApi = {
  list: async (_context, path) => fixtureListing(path),
  async stat(_context, path) {
    if (!(path in files)) throw Object.assign(new Error("missing fixture"), { code: "not_found" });
    return { path, modified: "2026-10-17T00:00:00Z", size: path === "logs/large.log" ? 20_000_000 : encoder.encode(files[path] ?? "").length, kind: files[path] === null ? "binary" : "text" };
  },
  async read(_context, file, signal) {
    if (signal.aborted) throw new Error("Fixture read aborted.");
    return { text: files[file.path] ?? "", truncated: file.path === "logs/large.log", total: file.size, ...(file.path === "logs/large.log" ? { truncatedBy: "bytes" as const } : {}) };
  },
  // The fixture uses an inert synthetic download, never the real filesystem endpoint.
  download: () => "data:text/plain,example",
};

export function explorerFixtureTarget(): ExplorerTarget {
  let state = openExplorerTab(emptyExplorerState(), "software/src/drive/control.cpp", explorerFixturePairs);
  state = openExplorerTab(state, "docs/README.md", explorerFixturePairs);
  state = { ...state, active: state.tabs[0]!.id };
  return { context: explorerFixtureContext, state };
}

export function ExplorerFixture() {
  return <PairedExplorer target={explorerFixtureTarget()} api={explorerFixtureApi} initialListing={explorerFixtureListing} history={false} />;
}
