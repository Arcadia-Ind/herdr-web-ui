# Local appearance and project navigation

This fork can read the installed Herdr Theme Picker palettes and Herdr Projects registry. It does not change native configuration.

## Themes

Appearance → Herdr theme lists the installed palette files. Theme Picker bundles, user themes, and cached themes retain their names. The active custom token set is also available. Each palette uses its own light or dark background. Text, links, and status colors are adjusted for contrast on the app surfaces. The terminal uses the same mapped colors. Choose Web colors to return to the existing Dark, Light, or System controls. Selection is saved in this browser.

Only allowed color tokens are returned. The app does not fetch a theme from the internet or execute a plugin script. The catalog refreshes on app reload; the server shares a one-minute cache. A missing or unreadable theme is reported without changing the saved choice.

Theme files follow the installed Theme Picker layout under the Herdr configuration, XDG state, and XDG cache directories. HERDR_CONFIG_PATH can select the native theme configuration file.

## Projects

The sidebar reads project names, coordinator identities, and thread metadata from HERDR_PROJECTS_ROOT, or the normal .herdr-projects folder in the user's home directory. A registry must name this bridge's exact Herdr socket. Live pane and workspace identities establish each row. Labels and branch names do not establish membership or status.

A project fold is saved per project and PC. The compact control shows stable native project numbers and thread IDs. Full titles remain in accessible names and tooltips. Expanded width and selection are retained. Other tabs and split panes remain within their project. Grouped panes do not appear again in the generic workspace and agent lists. Unregistered workspaces remain available.

Connected, visible pages refresh the registry every fifteen seconds. Disconnected PCs retain the last known group with an unknown live state. Unreadable records are reported. No native focus, pane size, or layout changes are needed.

## Thread changes

Each live thread has a change control. Counts compare its recorded worktree with HEAD, including staged and unstaged edits without counting a line twice. A repository without a commit compares with the empty tree. The new combined comparison is also available in the existing Changes view. Working tree, Staged, and Commits keep their original scopes.

The question-mark count names untracked files. An asterisk means that some lines are unknown, such as binary files or a truncated listing. Such results are not called clean. Missing repositories, missing directories, unavailable data, closed panes, and disconnected PCs have separate states.

The client sends batches of at most eight visible thread IDs. The server permits only current registered thread identities. It derives directories from metadata, shares in-flight reads, runs at most two repository listings at once, and keeps at most 128 cached directories for fifteen seconds. Existing git byte and time limits remain in effect.

The existing authentication, watch-device, same-origin, and cross-site controls still apply. Browser checks use fictional data and temporary browser contexts.
