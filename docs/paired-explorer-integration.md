# Paired file explorer integration

Scope: Arcadia-Ind/sim#420. The parent integration is Arcadia-Ind/herdr-web-ui#1.
These modules are read-only. T0164 owns the shared app, routing, locale dictionaries, and final checks.

## Module interface

- `PairedExplorer` in `src/components/explorer/PairedExplorer.tsx` accepts an `ExplorerTarget`,
  optional `onClose`, and optional `onNavigate`.
- `history=true` writes complete standalone addresses and handles Back and Forward.
  Use `history=false` when the host router owns history. Pass restored targets back through `target`.
- `ExplorerReader` supplies the standalone cookie gate. It accepts a target or null for an invalid link.
  Mount it inside the existing SettingsProvider. It does not attach to a native terminal.
- `explorerFromSearch` and `explorerHref` in `src/lib/explorerRoute.ts` parse and write addresses.
  Context includes machine, project, workspace, thread, and pane identity. File paths are relative.
- `explorerResponse(request, dependencies)` in `server/explorer.ts` serves the three read routes.
  Dependencies are `canRead`, `catalog()`, and `snapshot()`. No root is accepted from a URL.

## Shared adapters for T0164

1. Import `explorerResponse` into `server/index.ts`.
2. Place this adapter after the existing access decision and authentication checks:

```ts
if (/^\/api\/workspace\/explorer\/(?:list|stat|file)$/.test(pathname)) {
  return explorerResponse(request, {
    canRead: authenticated && !readOnly,
    catalog: readProjects,
    snapshot: options.customization?.snapshot ?? sessionSnapshot,
  });
}
```

The existing `/api/workspace/` authentication rule covers these routes.
The explicit `canRead` argument also refuses watching devices before any catalog or file read.
Keep the existing origin checks. The handler adds its own cross-site, method, query, and identity checks.
Do not mount this handler as an unauthenticated static route.

3. Route standalone requests in `src/main.tsx` before the app:

```tsx
const wantsExplorer = new URLSearchParams(window.location.search).has("explore");
const explorer = explorerFromSearch(window.location.search);
// Inside the existing SettingsProvider:
wantsExplorer ? <ExplorerReader target={explorer} /> : /* existing reader/app choice */
```

An invalid explorer address must render the refusal view. It must not fall through to App.
That prevents a bad standalone address from attaching to a native terminal.

4. Add an app action that mounts `PairedExplorer` in the existing content area.
   Build its target from the selected catalog row and workspace. Do not pass a filesystem root.
   Set `thread` to the selected thread ID and `pane` to that thread's recorded pane.
   For a coordinator view, use `thread: null` and its recorded coordinator pane.
5. Give the content area a definite height and `min-height: 0`.
6. Add the locale entries below. Keep dictionary ownership in T0164.
7. Add HTTP integration tests for the normal authentication and watching-device gates.
8. Run the final combined build, desktop/narrow browser checks, and standalone navigation checks.

## Pairing and reads

The engineering site's workspace and review readers were inspected.
Sim declares its mirror in `software/DEVELOPMENT.md`:
`software/src/<path>` pairs with `software/pseudocode/<path>.md`.
The source extension stays in the description filename, including scripts.
The software-root form is supported when that directory is the granted root.
The server enables this rule only when it finds the declaration and both folders.
Other repositories remain unpaired. A same-name file is insufficient.
Authored Markdown such as the pseudocode README remains a separate document.

Each group has one canonical ID, selected member, and code visibility.
Opening either member reuses the group. Closing either member closes both.
The URL retains tab order, active group, selected members, code visibility, and context.
Restored members are checked against the current declared mapping before content loads.
The tab count is limited to 32. Encoded state also has a size bound so every UI-created link reloads.

Missing partners keep an explicit retry view. Binary and unsupported files keep an explicit
notice and a scoped download. Large text uses the existing byte, line, timeout, highlight,
Markdown parse, and virtual-source limits, with an incomplete-preview notice.
Markdown images remain links. No image is loaded through the generic filesystem API.
Document links stay inside the granted workspace.

The generic file and diff APIs are unchanged. The directory cap is reused.
Scoped file reads use a pinned regular-file descriptor after lexical and symlink checks.
Private configuration paths are excluded. Replies contain relative paths and no raw filesystem errors.
Downloads stream with bounded memory and an explicit attachment response.

## Current bounds

The catalog supplied by the parent change contains local projects only.
Remote machine contexts receive an explicit refusal; they never read this machine's same-name project.
Do not add a remote proxy route until that machine can supply its own trusted catalog and session.
A coordinator view uses its current recorded pane directory.
A thread view uses its saved worktree, including after its pane closes.
No project repository path is inferred from a project name.

## Visual fixture

Mount `ExplorerFixture` from `src/components/explorer/ExplorerFixture.tsx` under SettingsProvider.
It uses an in-memory API and contacts no native session.
It includes a C++ pair, Markdown, a missing description, a binary file, and a large-file notice.
Use both inherited light and dark themes at desktop and narrow widths.
No browser or full build was started in this worker.

## New locale keys

The exact English keys are:

```json
[
  "File explorer",
  "Read only",
  "Close pair {name}",
  "Pseudocode",
  "Hide code",
  "Show code",
  "Select a file.",
  "The tab limit has been reached.",
  "Workspace files could not be loaded.",
  "Folder list is incomplete.",
  "No matching file is available.",
  "This file has no text preview.",
  "Preview is incomplete."
]
```

The existing keys Files, Refresh, Open in a new tab, Close files, Show hidden,
Opening…, Retry, Preview, Source, and Download are reused.
Locale completeness remains an integration check until T0164 inserts the new keys.

## Validation

Run the worker checks without a native session:

```sh
HERDR_TEST_MODE=unit bun test src/lib/explorer*.test.ts server/explorer.test.ts
bun run typecheck
HERDR_TEST_MODE=unit bun test src/conventions.test.ts server/conventions.test.ts scripts/changelog-fold.test.ts
```

The server tests use temporary roots and synthetic catalog/session records.
The component checks render static markup; they do not prove browser navigation or layout.
No live prompt, approval, browser draft, native layout, port 7317, or Tailscale setting is changed.
