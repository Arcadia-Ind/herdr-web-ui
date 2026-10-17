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

## Paired file explorer

Each project header and thread row has a File explorer action. It opens a read-only pane in the app. The folder tree reads only that registered workspace. Sim's declared source mapping opens code and its pseudocode as one tab group. Several groups can stay open. Hide code keeps the description visible, and closing either member closes the pair. Unpaired documents remain independent.

The app address retains the explorer context, tab order, selected member, and code visibility. Back, Forward, and reload restore that state. Open in a new tab opens a standalone reader with the same state. An invalid standalone address shows a refusal and attaches to no native terminal.

The current bridge can grant its own local catalog only. Remote contexts show an explicit refusal and never use local roots. No URL can supply an arbitrary filesystem root. Authentication and full device access are required. Watching devices, private configuration paths, root escapes, external symlinks, and special files are refused. Existing preview budgets remain in effect.

## Composer usage

The strip above the message box shows recorded context use, cache reads, and five-hour and weekly account limits. It is available at narrow widths and follows the pane's PC. The existing Show usage setting controls its visibility.

Request counters are folded in the existing transcript metadata reader. No second transcript scan is needed. Codex uses the latest request's reported total and context limit. Claude adds uncached input, cache reads, and cache creation; its ordinary transcript does not establish a context limit. Model names do not supply a missing limit. Unsupported sources and absent counters remain unavailable.

Cache percentage is the last request's cache reads divided by all input tokens. It is separate from cumulative session billing. Expand each item to see its denominator and observation time. New models, compaction, context clears, and replacement transcripts clear old request counters.

Account observations use the existing cached usage service for that PC. One visible account can supply a reference. Several accounts require an explicit Settings order. The reference does not prove which account the pane uses. Without a selected reference, recorded transcript limits can be shown with that same identity limit. Codex limits need the actual period before they can be called five-hour or weekly. Missing periods remain unavailable.

Unknown times remain unknown. Request observations older than thirty minutes and account observations older than five minutes are marked stale. A passed reset time does not set a counter to zero. A failed or rate-limited refresh retains its last observation with a separate state.

## Chat Highlights

Codex and Claude Chat have a Text only option. It retains assistant prose, including commentary, and hides tools and reasoning. The option is saved in this browser.

Quote message and Quote selected text append a reference to the existing editable pane draft. Repeated quotes can be combined with typed replies. The adapter checks the pane, PC, and current conversation history, reads the latest saved draft, and refuses oversized additions. It does not send a message or clear existing text.

Copy prompt and answer uses the actual matching parsed user turn. If the earlier prompt is not loaded, the action is disabled with a visible reason. Existing answer-only Markdown and plain-text copy remain available.
