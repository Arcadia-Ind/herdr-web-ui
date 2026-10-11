# Feature Map

Stable selectors, data attributes, routes, and keyboard shortcuts for browser testing.
All entries are verified against the codebase.

## Routes

| Route | Purpose |
|-------|---------|
| `/?pane={id}` | Open specific pane |
| `/?pane={id}&view=chat` | Open pane in chat lens |
| `/?pane={id}&view=terminal` | Open pane in terminal lens |
| `/?ws={id}-{slug}` | Open workspace |
| `/?settings` | Open settings dialog |
| `/?settings&section={page}` | Open specific settings page |
| `/?new` | Open new workspace dialog |
| `/api/health` | Health check endpoint |
| `/api/health?scope=bridge` | Bridge-only health check |

## Keyboard shortcuts

All global shortcuts use `Mod+Shift+key` (Ctrl on Windows/Linux, Cmd on Mac).

| Shortcut | Action | ID |
|----------|--------|-----|
| `Mod+Shift+K` | Command palette | `palette` |
| `Mod+Shift+F` | Find in terminal | `find` |
| `Mod+Shift+J` | Switch chat/terminal | `toggle-view` |
| `Mod+Shift+B` | Toggle sidebar | `toggle-sidebar` |
| `Mod+Shift+O` | New workspace | `new-session` |
| `Mod+Shift+↑` | Previous pane | `previous-pane` |
| `Mod+Shift+↓` | Next pane | `next-pane` |
| `Mod+Shift+,` | Settings | `settings` |
| `Mod+Shift+Space` (hold) | Dictate | `voice` |

## Data attributes

### Workspace and pane identification
```css
.workspace-group[data-workspace="{workspace_id}"]
.workspace-group[data-branch="{branch_name}"]
.pane-select[data-pane="{pane_id}"]
.agent-item[data-machine="{machine_id}"][data-pane="{pane_id}"]
.palette-pane[data-machine="{machine_id}"][data-pane="{pane_id}"]
.palette-section[data-section="{workspace_id}"][data-machine="{machine_id}"]
```

### Status indicators
```css
.sidebar-status[data-status="working"]
.sidebar-status[data-status="blocked"]
.sidebar-status[data-status="done"]
.sidebar-status[data-status="restore-error"]
.tab-strip-dot[data-status="working"]
.tab-strip-dot[data-status="blocked"]
.tab-strip-dot[data-status="done"]
.tab-strip-dot[data-status="waiting"]
.composer-status[data-status="{status}"]
.palette-filter[data-status="{status}"]
```

### Test IDs
```css
[data-testid="background-tasks"]
```

## ARIA labels (for getByRole)

### Dialogs
- `dialog[aria-label="Settings"]`
- `dialog[aria-label="Command palette"]`
- `dialog[aria-label="Key bar"]`

### Input fields
- `textbox[aria-label="Message"]` — Chat composer
- `textbox[aria-label="Terminal input line"]` — Terminal input
- `searchbox[aria-label="Search panes and actions"]` — Palette search
- `textbox[aria-label="Workspace name"]` — Rename field
- `textbox[aria-label="Password or PIN"]` — Secret input

### Buttons
- `button[aria-label="Close settings"]`
- `button[aria-label="Back to settings"]`
- `button[aria-label="Resize sidebar"]`
- `button[aria-label="Send now"]`
- `button[aria-label="Discard"]`
- `button[aria-label="Cancel dictation"]`
- `button[aria-label="Insert dictation"]`
- `button[aria-label="More for {title}"]` — Row menu toggle

### Navigation
- `nav[aria-label="Settings"]` — Settings page nav
- `nav[aria-label="Herdr workspaces"]` — Workspace list

### Regions
- `region[aria-label="Agent is asking"]` — Prompt card
- `scrollbar[aria-label="Terminal scrollback"]`

### Lists
- `ol[aria-label="Queued messages"]` — Pending messages
- `ol[aria-label="Accounts"]` — Usage accounts
- `ol[aria-label="Questions"]` — Prompt card steps

## CSS classes for state

### Connection status
- `.conn-live` — Connection is live (rendered as 1px element)
- `.app.is-offline` — App is disconnected

### Selection
- `.is-selected` — Selected row/item
- `.is-offline` — Machine offline

### Sidebar
- `.sidebar-shell` — Main sidebar container
- `.sidebar-list` — Workspace list
- `.agents-sidebar` — Agents panel
- `.workspace-header` — Workspace row header
- `.workspace-name` — Workspace name text
- `.workspace-toggle` — Worktree fold toggle

### Terminal
- `.xterm-helper-textarea` — xterm's input element
- `.terminal-viewport` — Terminal container

### Chat
- `.composer` — Message composer
- `.composer-status` — Status line
- `.voice-mic` — Voice dictation button
- `.chat-turn` — Conversation turn
- `.work-block` — Tool/thinking block

### Dialogs
- `.modal` — Any modal dialog
- `.settings-dialog` — Settings specifically
- `.row-menu` — Context menu popover
- `.row-sheet` — Mobile context sheet

## Viewport breakpoints

| Breakpoint | Behavior |
|------------|----------|
| `< 769px` | Mobile layout, sheet menus |
| `>= 769px` | Desktop layout, popover menus |

## Phone testing viewports

Standard test viewports from the regression scripts:
- iPhone SE: 375×667
- iPhone 14 Pro: 390×844
- Small phone: 320×568
- Landscape: 844×390

## Wait patterns

### Wait for live connection
```typescript
await page.locator(".conn-live").waitFor();
```

### Wait for pane paint
```typescript
const painted = new Set<string>();
page.on("websocket", (ws) => {
  ws.on("framereceived", ({ payload }) => {
    const msg = JSON.parse(String(payload));
    if (msg.type === "pty-data") painted.add(msg.pane_id);
  });
});
await until(() => painted.has(paneId), "pane painted");
```

### Wait for input ready
```typescript
const inputStates = new Map();
ws.on("framereceived", ({ payload }) => {
  const msg = JSON.parse(String(payload));
  if (msg.type === "input-ready") inputStates.set(msg.pane_id, msg.ready !== false);
});
await until(() => inputStates.get(paneId) === true, "input ready");
```

## Settings pages

Accessible via `openSettingsPage(page, "PageName")` from `scripts/settings-page.ts`:
- `"Appearance"`
- `"Terminal"`
- `"Chat"`
- `"Devices"`
- `"About"`
- `"Remote PCs"` / `"Machines"` (same)
