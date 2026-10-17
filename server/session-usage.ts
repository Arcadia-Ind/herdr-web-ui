import type { RecordedQuota, SessionUsage } from "../shared/composer-usage.ts";
import { isContextClear } from "./transcript-records.ts";

type Row = Record<string, unknown>;
const record = (value: unknown): Row => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const count = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const positive = (value: unknown): number | null => (count(value) ?? 0) > 0 ? value as number : null;
const sum = (...values: (number | null)[]): number | null => values.every((value) => value !== null) ? count(values.reduce<number>((total, value) => total + value!, 0)) : null;
const modelName = (value: unknown): string | null => typeof value === "string" && value.trim() && !value.startsWith("<") ? value.trim() : null;

function timestamp(value: unknown): string | null {
  const ms = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function epochSeconds(value: unknown): string | null {
  const ms = typeof value === "number" && Number.isFinite(value) && value > 0 ? value * 1000 : NaN;
  return Number.isFinite(ms) && ms <= 8.64e15 ? new Date(ms).toISOString() : null;
}

function empty(provider: SessionUsage["provider"], model: string | null = null): SessionUsage {
  return { provider, model, observed_at: null, context: { used: null, limit: null, basis: provider === "codex" ? "total" : "input" },
    cache: { read_tokens: null, creation_tokens: null, input_tokens: null }, quota: null };
}

/** Codex rollout windows state their length in minutes and their reset in epoch seconds. */
export function codexRecordedQuota(value: unknown, observedAt: unknown): RecordedQuota | null {
  const rate = record(value);
  if (rate.limit_id !== undefined && rate.limit_id !== "codex") return null;
  const windows = [rate.primary, rate.secondary].flatMap((value) => {
    const window = record(value);
    const minutes = positive(window.window_minutes);
    const used = window.used_percent;
    return minutes !== null && typeof used === "number" && Number.isFinite(used) && used >= 0 && used <= 100
      ? [{ minutes, used_percent: used, resets_at: epochSeconds(window.resets_at) }] : [];
  });
  return windows.length ? { observed_at: timestamp(observedAt), windows } : null;
}

/** Installed usagebar's counters-only Claude cache. No credential or file access. */
export function claudeUsagebarQuota(value: unknown): RecordedQuota | null {
  const cache = record(value);
  const window = (value: unknown, minutes: number): Row => {
    const raw = record(value);
    return { used_percent: raw.usedPercentage, window_minutes: raw.windowMinutes ?? minutes, resets_at: raw.resetsAt };
  };
  const observed = typeof cache.fetchedAtMs === "number" && Number.isFinite(cache.fetchedAtMs)
    && cache.fetchedAtMs > 0 && cache.fetchedAtMs <= 8.64e15 ? new Date(cache.fetchedAtMs).toISOString() : null;
  return codexRecordedQuota({ primary: window(cache.fiveHour, 300), secondary: window(cache.sevenDay, 10080) }, observed);
}

/**
 * Fold into the existing transcript reader. Pass only the state of the same bound
 * transcript; clear it on replacement. No file scan, provider request, or timer.
 */
export function foldSessionUsage(before: SessionUsage | null | undefined, source: string, value: unknown): SessionUsage | null {
  const provider = source === "codex-transcript" ? "codex" : source === "claude-transcript" ? "claude" : null;
  if (provider === null) return null;
  const entry = record(value);
  let state = before?.provider === provider ? before : empty(provider);
  if (isContextClear(entry, source)) return empty(provider);
  if (provider === "codex") {
    const payload = record(entry.payload);
    if (entry.type === "compacted" || (entry.type === "event_msg" && payload.type === "context_compacted")) {
      return { ...empty(provider, state.model), quota: state.quota };
    }
    if (entry.type === "turn_context" || entry.type === "session_meta") {
      const model = modelName(payload.model) ?? modelName(record(record(payload.collaboration_mode).settings).model);
      if (model !== null && model !== state.model) state = { ...empty(provider, model), quota: state.quota };
      return state;
    }
    if (entry.type !== "event_msg" || payload.type !== "token_count") return state;
    const info = record(payload.info);
    const quota = payload.rate_limits !== undefined || info.rate_limits !== undefined
      ? codexRecordedQuota(payload.rate_limits ?? info.rate_limits, entry.timestamp) : state.quota;
    // Codex also emits quota-only token_count events. They do not replace request counters.
    if (payload.info === null || payload.info === undefined) return { ...state, quota };
    const usage = record(info.last_token_usage);
    const input = count(usage.input_tokens);
    const cached = count(usage.cached_input_tokens);
    return { ...state, quota, observed_at: timestamp(entry.timestamp),
      context: { used: count(usage.total_tokens) ?? sum(input, count(usage.output_tokens)),
        limit: positive(info.model_context_window), basis: "total" },
      cache: { input_tokens: input, read_tokens: cached !== null && (input === null || cached <= input) ? cached : null,
        creation_tokens: null } };
  }
  // A subagent has a separate context. A compact boundary invalidates old request counters.
  if (entry.isSidechain === true) return state;
  if (entry.type === "system" && entry.subtype === "compact_boundary") return { ...empty(provider, state.model), quota: state.quota };
  if (entry.type !== "assistant") return state;
  const message = record(entry.message);
  const model = modelName(message.model);
  if (model !== null && model !== state.model) state = { ...empty(provider, model), quota: state.quota };
  if (message.usage === undefined || message.usage === null) return state;
  const usage = record(message.usage);
  const input = count(usage.input_tokens);
  const read = count(usage.cache_read_input_tokens);
  const creation = count(usage.cache_creation_input_tokens);
  const totalInput = sum(input, read, creation);
  return { ...state, observed_at: timestamp(entry.timestamp),
    context: { used: totalInput, limit: state.context.limit, basis: "input" },
    cache: { input_tokens: totalInput, read_tokens: read, creation_tokens: creation } };
}

/** Convenience for an already-read transcript slice. Incremental readers can use the fold. */
export function parseSessionUsage(text: string, source: string, before?: SessionUsage | null): SessionUsage | null {
  let state = foldSessionUsage(before, source, {});
  for (const line of text.split("\n")) {
    let entry: unknown;
    try { entry = JSON.parse(line); } catch { continue; }
    state = foldSessionUsage(state, source, entry);
  }
  return source === "codex-transcript" || source === "claude-transcript" ? state : null;
}

/** An actual pane-bound Claude status-line payload can state its context limit. */
export function claudeStatusLineUsage(value: unknown, observedAt: string | null): SessionUsage {
  const data = record(value);
  const context = record(data.context_window);
  const usage = record(context.current_usage);
  const input = sum(count(usage.input_tokens), count(usage.cache_read_input_tokens), count(usage.cache_creation_input_tokens));
  const rate = record(data.rate_limits);
  const window = (value: unknown, minutes: number): Row => {
    const raw = record(value);
    return { used_percent: raw.used_percentage, window_minutes: minutes, resets_at: raw.resets_at };
  };
  return { ...empty("claude", modelName(record(data.model).id)), observed_at: timestamp(observedAt),
    context: { used: input, limit: positive(context.context_window_size), basis: "input" },
    cache: { input_tokens: input, read_tokens: count(usage.cache_read_input_tokens), creation_tokens: count(usage.cache_creation_input_tokens) },
    quota: codexRecordedQuota({ primary: window(rate.five_hour, 300), secondary: window(rate.seven_day, 10080) }, observedAt) };
}
