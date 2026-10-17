import { describe, expect, it } from "bun:test";
import { claudeStatusLineUsage, claudeUsagebarQuota, codexRecordedQuota, foldSessionUsage, parseSessionUsage } from "./session-usage.ts";

// Synthetic counters only. These fixtures contain no transcript text or account data.
const at = "2026-10-17T05:00:00.000Z";
const codex = (usage: unknown, limit: unknown = 10_000, extra: Record<string, unknown> = {}) => ({
  type: "event_msg", timestamp: at,
  payload: { type: "token_count", info: { last_token_usage: usage, model_context_window: limit, total_token_usage: { total_tokens: 900_000 } }, ...extra },
});
const claude = (usage: unknown, extra: Record<string, unknown> = {}) => ({
  type: "assistant", timestamp: at, message: { model: "test-model", usage }, ...extra,
});
const foldCodex = (entry: unknown) => foldSessionUsage(null, "codex-transcript", entry)!;
const foldClaude = (entry: unknown) => foldSessionUsage(null, "claude-transcript", entry)!;

describe("session request counters", () => {
  it("uses Codex last request totals and does not add cached input twice", () => {
    const sample = foldCodex(codex({ input_tokens: 1000, cached_input_tokens: 800, output_tokens: 100, total_tokens: 1100 }));
    expect(sample.context).toEqual({ used: 1100, limit: 10_000, basis: "total" });
    expect(sample.cache).toEqual({ input_tokens: 1000, read_tokens: 800, creation_tokens: null });
    expect(sample.observed_at).toBe(at);
  });

  it("can add separately reported input and output, but never uses cumulative totals", () => {
    expect(foldCodex(codex({ input_tokens: 1000, output_tokens: 100 })).context.used).toBe(1100);
    expect(foldCodex(codex(undefined)).context.used).toBeNull();
    expect(foldCodex(codex({ cached_input_tokens: 800 })).cache.input_tokens).toBeNull();
  });

  it("adds Claude uncached input, cache reads, and creation; output is separate", () => {
    const sample = foldClaude(claude({ input_tokens: 100, cache_read_input_tokens: 700, cache_creation_input_tokens: 200, output_tokens: 900 }));
    expect(sample.context).toEqual({ used: 1000, limit: null, basis: "input" });
    expect(sample.cache).toEqual({ input_tokens: 1000, read_tokens: 700, creation_tokens: 200 });
  });

  it("preserves explicit zero counters and does not invent absent counters", () => {
    expect(foldClaude(claude({ input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })).context.used).toBe(0);
    const incomplete = foldClaude(claude({ input_tokens: 50, cache_read_input_tokens: 0 }));
    expect(incomplete.context.used).toBeNull();
    expect(incomplete.cache.creation_tokens).toBeNull();
    expect(foldCodex(codex({ input_tokens: 100, output_tokens: 0 })).cache.read_tokens).toBeNull();
  });

  it("uses each new context limit and never guesses from model names or occupancy", () => {
    const first = foldCodex(codex({ total_tokens: 1000 }, 10_000));
    const second = foldSessionUsage(first, "codex-transcript", codex({ total_tokens: 1000 }, 20_000))!;
    expect(second.context.limit).toBe(20_000);
    expect(foldSessionUsage(second, "codex-transcript", codex({ total_tokens: 1000 }, null))!.context.limit).toBeNull();
    const large = foldClaude(claude({ input_tokens: 300_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }));
    expect(large.context.limit).toBeNull();
    const changed = foldSessionUsage(second, "codex-transcript", { type: "turn_context", payload: { model: "different-model" } })!;
    expect(changed.context).toEqual({ used: null, limit: null, basis: "total" });
  });

  it("rejects negative, nonfinite, fractional, unsafe, and impossible cache counters", () => {
    for (const invalid of [-1, Infinity, NaN, 1.1, Number.MAX_SAFE_INTEGER + 1, "100"]) {
      expect(foldCodex(codex({ total_tokens: invalid }, invalid)).context).toEqual({ used: null, limit: null, basis: "total" });
    }
    expect(foldCodex(codex({ input_tokens: 10, cached_input_tokens: 20 })).cache.read_tokens).toBeNull();
  });

  it("skips Claude sidechains and clears counters on compaction or context clear", () => {
    const sample = foldClaude(claude({ input_tokens: 100, cache_read_input_tokens: 700, cache_creation_input_tokens: 200 }));
    expect(foldSessionUsage(sample, "claude-transcript", claude({ input_tokens: 10 }, { isSidechain: true }))).toEqual(sample);
    expect(foldSessionUsage(sample, "claude-transcript", { type: "system", subtype: "compact_boundary" })!.context.used).toBeNull();
    expect(foldSessionUsage(sample, "claude-transcript", {
      type: "user", message: { role: "user", content: "<command-name>/clear</command-name>" },
    })!.cache.read_tokens).toBeNull();
    expect(foldSessionUsage(foldCodex(codex({ total_tokens: 1000 })), "codex-transcript", { type: "compacted" })!.context.used).toBeNull();
  });

  it("does not carry one provider's counters to another or to an unsupported source", () => {
    const sample = foldCodex(codex({ total_tokens: 1000 }));
    expect(foldSessionUsage(sample, "claude-transcript", {})!.context.used).toBeNull();
    expect(foldSessionUsage(sample, "other-transcript", {})).toBeNull();
  });

  it("folds incremental slices and ignores a partial JSON line", () => {
    const first = parseSessionUsage(JSON.stringify(codex({ total_tokens: 1000 })) + "\n{", "codex-transcript");
    const second = parseSessionUsage(JSON.stringify(codex({ total_tokens: 2000 }, 20_000)), "codex-transcript", first);
    expect(second?.context).toEqual({ used: 2000, limit: 20_000, basis: "total" });
    expect(parseSessionUsage("", "claude-transcript", first)?.provider).toBe("claude");
    expect(parseSessionUsage("", "claude-transcript", first)?.context.used).toBeNull();
  });

  it("uses an actual Claude status-line limit without a model-name lookup", () => {
    const sample = claudeStatusLineUsage({
      model: { id: "any-model" }, context_window: { context_window_size: 500_000,
        current_usage: { input_tokens: 100, cache_read_input_tokens: 700, cache_creation_input_tokens: 200, output_tokens: 999 } },
    }, at);
    expect(sample.context).toEqual({ used: 1000, limit: 500_000, basis: "input" });
  });

  it("leaves a Claude status-line null request unknown after compaction", () => {
    const sample = claudeStatusLineUsage({ context_window: { context_window_size: 500_000, current_usage: null } }, at);
    expect(sample.context).toEqual({ used: null, limit: 500_000, basis: "input" });
    expect(sample.cache.read_tokens).toBeNull();
  });
});

describe("recorded Codex account limits", () => {
  const rate = { primary: { used_percent: 0, window_minutes: 300, resets_at: 1_792_218_000 },
    secondary: { used_percent: 85, window_minutes: 10080, resets_at: 1_792_814_400 } };
  it("keeps the actual periods and converts epoch seconds exactly once", () => {
    const quota = codexRecordedQuota(rate, at)!;
    expect(quota.windows[0]).toEqual({ minutes: 300, used_percent: 0, resets_at: "2026-10-17T06:20:00.000Z" });
    expect(quota.windows[1]?.minutes).toBe(10080);
    expect(quota.observed_at).toBe(at);
  });

  it("reads both rollout locations and keeps request counters for quota-only events", () => {
    const before = foldCodex(codex({ total_tokens: 1000 }, 10_000, { rate_limits: rate }));
    const after = foldSessionUsage(before, "codex-transcript", {
      type: "event_msg", timestamp: at, payload: { type: "token_count", info: null, rate_limits: rate },
    })!;
    expect(after.context).toEqual(before.context);
    const nested = foldCodex({ type: "event_msg", timestamp: at, payload: { type: "token_count", info: { rate_limits: rate } } });
    expect(nested.quota).toEqual(before.quota);
  });

  it("never assumes the primary window is five hours and rejects scoped or invalid limits", () => {
    expect(codexRecordedQuota({ primary: { used_percent: 20, window_minutes: 60 } }, at)?.windows[0]?.minutes).toBe(60);
    expect(codexRecordedQuota({ primary: { used_percent: 20 } }, at)).toBeNull();
    expect(codexRecordedQuota({ ...rate, limit_id: "model-only" }, at)).toBeNull();
    expect(codexRecordedQuota({ primary: { used_percent: 101, window_minutes: 300 } }, at)).toBeNull();
  });

  it("accepts the installed Claude usagebar cache with its original observation time", () => {
    const sample = claudeUsagebarQuota({
      fetchedAtMs: 1_792_213_200_000,
      fiveHour: { usedPercentage: 0, windowMinutes: 300, resetsAt: 1_792_218_000 },
      sevenDay: { usedPercentage: 50, windowMinutes: 10080 },
    })!;
    expect(sample.observed_at).toBe(at);
    expect(sample.windows[0]).toEqual({ minutes: 300, used_percent: 0, resets_at: "2026-10-17T06:20:00.000Z" });
    expect(sample.windows[1]?.resets_at).toBeNull();
    expect(claudeUsagebarQuota({ fetchedAtMs: 0, fiveHour: { usedPercentage: 20 } })?.observed_at).toBeNull();
    expect(claudeUsagebarQuota({})).toBeNull();
  });

  it("reads Claude status-line windows without inventing a missing window", () => {
    const sample = claudeStatusLineUsage({
      rate_limits: { five_hour: { used_percentage: 25, resets_at: 1_792_218_000 } },
    }, at);
    expect(sample.quota?.windows).toEqual([{ minutes: 300, used_percent: 25, resets_at: "2026-10-17T06:20:00.000Z" }]);
  });
});
