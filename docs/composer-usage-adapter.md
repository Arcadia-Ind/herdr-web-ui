# Composer usage adapter (sim issue 421)

This branch supplies dedicated modules and tests. T0164 owns the integration PR:
https://github.com/Arcadia-Ind/herdr-web-ui/pull/1.
Task: https://github.com/Arcadia-Ind/sim/issues/421.

## Files and public interface

- `shared/composer-usage.ts`: counters-only `SessionUsage` and `RecordedQuota`.
- `server/session-usage.ts`: `foldSessionUsage(before, source, entry)` and
  `parseSessionUsage(alreadyReadText, source, before?)`.
- The same server module exports `claudeStatusLineUsage(payload, observedAt)` and
  `claudeUsagebarQuota(cachePayload)`. Both are pure adapters. They read no files.
- `src/lib/composerUsage.ts`: `usageBarItems(data, translate, locale?)`.
- `src/components/ComposerUsageBar.tsx`: `ComposerUsageBar(data)`.
  `ComposerUsageReadings` exposes the same view for synthetic fixtures.

The component props are:

```ts
interface UsageBarData {
  agent: string | null;
  session: SessionUsage | null;
  account: ProviderUsage | null;
  now: number; // epoch milliseconds from an existing display clock
}
```

The component uses the existing SettingsProvider for language. It starts no timer,
fetch, subscription, file scan, or provider request.

## Minimal owner changes

1. Import the `SessionUsage` type into `shared/protocol.ts`.
2. Add `usage?: SessionUsage | null` to `ConversationMetadata`.
3. Import `foldSessionUsage` into `server/conversation-metadata.ts`.
4. Fold each already-parsed entry into `metadata.usage` in the existing loop.

```ts
metadata.usage = foldSessionUsage(metadata.usage, source, entry);
```

The metadata reader already has the correct transcript binding and incremental state.
Initialize usage to null for a new transcript. Keep the existing state only for the same
bound transcript. Clear it on replacement, history identity change, source change, and pane change.
Do not scan session directories or read transcript files a second time.

5. Include `usage` in PaneTerminal's `onChatMetadata` equality comparison.

Its current comparison reads only model, effort, context used, and context window.
Without this change, cache-only and quota-only updates will be discarded.
Compare the small counters-only usage object, for example with JSON.stringify on both values.

6. Pass the metadata usage object through the owner's composer data path.
7. Render this component immediately above the input card.

```tsx
<ComposerUsageBar
  agent={agent}
  session={metadata?.usage ?? null}
  account={selectedAccountReference ?? null}
  now={now}
/>
```

Use the existing cached UsageReport and display clock. The existing `useUsage` hook reads
every minute while visible. UsageService shares concurrent reads, caches success for five
minutes, and respects account rate-limit backoff. Do not add refresh=1 polling.
For a remote pane, use its machine's usage report. Never pair local account data with a remote pane.
Honor the existing usage visibility and hidden-account settings when choosing an account reference.

An agent name does not identify its account. Pass an explicit account reference from the
existing report, or null. Do not silently choose an arbitrary account among several.
The detail text says that an account reference does not establish the pane's account.
A selected reference cannot fall back to a different recorded account observation.

8. Add the translation keys below to the three shared locale dictionaries.
9. Complete the existing demo transport work and the coordinator's build/browser checks.

No shared owner file is changed by this branch. The source, tests, and dictionaries of the
explorer specialist are also unchanged.

## Sources and field semantics

| Metric | Source and definition |
| --- | --- |
| Codex context used | `event_msg/token_count.info.last_token_usage.total_tokens`; fallback to reported input plus output. Never `total_token_usage`. |
| Codex context limit | `info.model_context_window` from that usage record. No model-name mapping. |
| Codex cache read | `last_token_usage.cached_input_tokens`, divided by `last_token_usage.input_tokens`. Codex input already includes cache reads. |
| Codex cache creation | Unknown in the inspected rollout format. It does not become zero. |
| Claude context used | Latest main-conversation request: input + cache reads + cache creation. Output is excluded, as in Claude's status line. |
| Claude context limit | Unknown from ordinary transcript usage. A real pane-bound status-line payload can supply `context_window.context_window_size`. |
| Claude cache read | `cache_read_input_tokens` divided by input + cache reads + cache creation, for the latest request. Creation is a separate counter. |
| Account limits | Existing `ProviderUsage`: plan-wide session and weekly windows, checked_at, problem, and reset timestamps. |
| Recorded Codex limits | `rate_limits` in the token_count payload or info, with actual window_minutes and epoch-second resets_at. Only 300/10080-minute windows supply 5h/weekly labels. |
| Recorded Claude limits | Installed usagebar's counters-only cache shape, or a pane-bound native status-line rate_limits payload. |

The bar labels cache as the last request's read share. The installed usagebar sidebar uses
a cumulative cache share; these are different periods. Do not substitute one for the other.
The context figure is a recorded request observation. It is not a live tokenizer measurement.
Codex includes response tokens in this observation; Claude uses the request's input. The
details state the basis so the percentages do not imply identical provider accounting.

The existing metadata context reader has a Claude long-window inference. Do not feed that
inferred window into this bar. A model name or a large request does not establish a session limit.

The current quota service groups Codex durations into broad session/week kinds.
The bar requires an exact five-hour/seven-day span from starts_at and resets_at before it uses
those labels. Missing Codex period evidence leaves that limit unavailable. Claude's named
five_hour/seven_day provider fields establish their periods even without reset timestamps.

Official sources checked on 2026-10-17:

- [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching):
  cached input is part of input usage; cache writes are a separate concept.
- [Codex App Server](https://learn.chatgpt.com/docs/app-server):
  official API context; the local rollout adapters supply the inspected field names.
- [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching):
  total input adds input, cache reads, and cache creation.
- [Claude status-line fields](https://code.claude.com/docs/en/statusline#context-window-fields):
  an actual payload states its context size and last-request usage. The input-only percentage
  matches the adapter. These counters can be absent after compaction.

Installed usagebar source inspected: Codex extract/limits, Claude context counters,
Claude limits cache, and the LimitWindow JSON contract. No private counters or credential
files were inspected or copied. No code was copied from that Go implementation.

## Cached quota adapter limits

`claudeUsagebarQuota` accepts only the installed cache's counter fields:
`fetchedAtMs`, `fiveHour`, `sevenDay`, `usedPercentage`, `windowMinutes`, and `resetsAt`.
The integration owner can pass an already-read cache payload. An unknown cache timestamp
stays unknown; the adapter never replaces it with the current time.
An absent payload, unsupported period, or invalid percentage cannot produce a zero limit.

This branch adds no cache-file discovery, account discovery, credential access, or HTTP route.
The installed default cache does not prove a pane/account association.
Use it only as a clearly labeled recorded account reference. Do not apply one profile's cache
to another profile or machine. No Claude status-line capture or settings change is included.

## Unknown and stale states

- Missing counters, denominators, and observation times remain unknown.
- Unsupported session sources show unavailable context/cache metrics.
- A reported zero cache read or quota percentage remains a measured zero.
- Session request observations older than 30 minutes show stale.
- Account observations older than five minutes show stale.
- A passed reset time makes retained data stale; it never resets a counter to zero.
- A rate-limited refresh keeps the last numbers and displays Rate limited.
- Other reported quota failures mark retained numbers stale.
- These time limits are display policies, not provider validity guarantees.
- A model change, compaction, or context clear invalidates old request counters.

The strip scrolls horizontally within its container. Each item has a native details/summary
control for keyboard and touch access to its denominator, period, timestamp, and reset time.
Visual meter fills are clamped to 100 percent. Text retains an actual over-limit percentage.
No zero-valued meter is drawn for unavailable data.

## Checks and remaining integration

Run focused checks with `HERDR_TEST_MODE=unit`. The default Bun preload otherwise tries
to start an isolated herdr test server. No provider or live agent is needed.

```sh
HERDR_TEST_MODE=unit bun test server/session-usage.test.ts src/lib/composerUsage.test.ts src/components/ComposerUsageBar.test.ts
bun run typecheck
HERDR_TEST_MODE=unit bun test src/conventions.test.ts server/conventions.test.ts
```

Full locale checks need the owner to add the keys below. Full build, demo, browser,
320/390-pixel overflow checks, remote-machine routing, and deployed checks belong to T0164.
Static markup tests prove accessible controls and meter states, not browser geometry.

The baseline scripts convention test fails on three demo routes:
`/api/themes`, `/api/workspace/diff/summaries`, and `/api/workspace/projects`.
The relevant files are identical to baseline 461c949 in this branch. The usage modules add no route.

## Exact translation keys

The integration owner must add or reuse these English keys in KO, JA, and ZH.
Preserve each placeholder name. This branch does not edit the shared locale dictionaries.

- `5h`
- `Account reference: {account}. The pane's account is not verified.`
- `Cache creation: {tokens} tokens.`
- `Cache read`
- `Cache reads / all input tokens in the last request.`
- `Context`
- `Context, cache, and account usage`
- `Last request input and output; excludes cumulative session usage.`
- `Last request input; includes cache reads and cache creation.`
- `No session usage reported.`
- `Observation time unknown.`
- `Quota status: {status}.`
- `Rate limited`
- `Recorded account limits; the current account is not verified.`
- `Reported {time}.`
- `Reset time unknown.`
- `Resets {time}.`
- `Stale`
- `Unavailable`
- `Unknown`
- `Used share of the five-hour account limit.`
- `Used share of the weekly account limit.`
- `Weekly`
- `{used} / {limit} tokens`
