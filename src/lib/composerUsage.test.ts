import { describe, expect, it } from "bun:test";
import type { ProviderUsage } from "../../shared/protocol.ts";
import type { SessionUsage } from "../../shared/composer-usage.ts";
import type { Translate } from "./i18n.ts";
import { QUOTA_STALE_MS, SESSION_STALE_MS, usageBarItems } from "./composerUsage.ts";

const at = "2026-10-17T05:00:00.000Z";
const now = Date.parse(at);
const t: Translate = (key, vars) => key.replace(/\{(\w+)\}/g, (match, name: string) => String(vars?.[name] ?? match));
const session: SessionUsage = { provider: "codex", model: "test", observed_at: at,
  context: { used: 1100, limit: 10_000, basis: "total" },
  cache: { input_tokens: 1000, read_tokens: 800, creation_tokens: null }, quota: null };
const account: ProviderUsage = { id: "codex", key: "codex:test", account: "example account", plan: null, checked_at: at, problem: null,
  windows: [
    { kind: "session", scope: null, used_percent: 0, starts_at: "2026-10-17T04:00:00Z", resets_at: "2026-10-17T09:00:00Z" },
    { kind: "week", scope: null, used_percent: 85, starts_at: "2026-10-13T05:00:00Z", resets_at: "2026-10-20T05:00:00Z" },
  ] };
const items = (s: SessionUsage | null = session, a: ProviderUsage | null = account, clock = now, agent: string | null = "codex") =>
  usageBarItems({ agent, session: s, account: a, now: clock }, t);

describe("usage bar semantics", () => {
  it("shows context occupancy and cache read share with separate denominators", () => {
    const [context, cache, short, week] = items();
    expect(context?.percent).toBe(11);
    expect(context?.value).toBe("1.1K / 10K · 11%");
    expect(cache?.percent).toBe(80);
    expect(cache?.value).toBe("800 · 80%");
    expect(cache?.detail).toContain("800 / 1,000 tokens");
    expect(cache?.detail).toContain("Cache creation: Unknown");
    expect(short?.value).toBe("0%");
    expect(week?.value).toBe("85%");
    expect(short?.detail).toContain("The pane's account is not verified");
    expect(short?.detail).toContain("Resets 2026-10-17T09:00:00.000Z.");
  });

  it("does not treat Claude cache creation as a cache hit", () => {
    const sample: SessionUsage = { ...session, provider: "claude", context: { used: 1000, limit: null, basis: "input" },
      cache: { input_tokens: 1000, read_tokens: 700, creation_tokens: 200 } };
    const result = items(sample, null, now, "claude");
    expect(result[0]?.value).toBe("1K / ?");
    expect(result[0]?.state).toBe("unknown");
    expect(result[1]?.percent).toBe(70);
    expect(result[1]?.detail).toContain("Cache creation: 200");
    expect(result[0]?.detail).toContain("Last request input;");
    const created = { ...sample, cache: { input_tokens: 1000, read_tokens: 0, creation_tokens: 1000 } };
    expect(items(created, null, now, "claude")[1]?.percent).toBe(0);
  });

  it("changes the context percentage with a reported limit and leaves an unknown limit unknown", () => {
    expect(items({ ...session, context: { ...session.context, limit: 20_000 } })[0]?.percent).toBe(5.5);
    expect(items({ ...session, context: { ...session.context, limit: null } })[0]?.percent).toBeNull();
    expect(items({ ...session, context: { ...session.context, used: 12_000 } })[0]?.value).toContain("120%");
  });

  it("distinguishes missing cache counts from a measured zero and a zero denominator", () => {
    expect(items({ ...session, cache: { ...session.cache, read_tokens: null } })[1]?.state).toBe("unknown");
    expect(items({ ...session, cache: { ...session.cache, read_tokens: 0 } })[1]?.percent).toBe(0);
    expect(items({ ...session, cache: { ...session.cache, input_tokens: 0, read_tokens: 0 } })[1]?.percent).toBeNull();
  });

  it("marks stale, missing, future, and unknown observation times", () => {
    expect(items(session, account, now + SESSION_STALE_MS + 1)[0]?.state).toBe("stale");
    expect(items(session, account, now + QUOTA_STALE_MS + 1)[2]?.state).toBe("stale");
    expect(items({ ...session, observed_at: null })[0]?.state).toBe("unknown");
    expect(items(session, { ...account, checked_at: null })[2]?.state).toBe("unknown");
    expect(items(session, account, now - 1)[2]?.state).toBe("unknown");
  });

  it("marks retained quota data after rate limiting, failure, expiry, or a past reset", () => {
    expect(items(session, { ...account, problem: "rate_limited" })[2]?.state).toBe("rate_limited");
    for (const problem of ["failed", "expired", "locked"] as const) {
      expect(items(session, { ...account, problem })[2]?.state).toBe("stale");
    }
    expect(items(session, account, Date.parse("2026-10-17T09:00:00Z"))[2]?.state).toBe("stale");
    expect(items(session, { ...account, windows: [], problem: "rate_limited" })[2]?.value).toBe("Unavailable");
  });

  it("does not substitute a scoped, different-period, or another provider's quota", () => {
    expect(items(session, { ...account, windows: account.windows.map((window) => ({ ...window, scope: "model" })) })[2]?.percent).toBeNull();
    const hour = { ...account, windows: [{ ...account.windows[0]!, starts_at: "2026-10-17T08:00:00Z" }] };
    expect(items(session, hour)[2]?.percent).toBeNull();
    expect(items(session, { ...account, id: "claude" })[2]?.state).toBe("unavailable");
  });

  it("requires an exact Codex period but can use Claude's named periods without a reset time", () => {
    const noDuration = { ...account, windows: account.windows.map((window) => ({ ...window, starts_at: null, resets_at: null })) };
    expect(items(session, noDuration)[2]?.percent).toBeNull();
    const claude = { ...noDuration, id: "claude" as const };
    expect(items(null, claude, now, "claude")[2]?.percent).toBe(0);
    expect(items(null, claude, now, "claude")[2]?.detail).toContain("Reset time unknown.");
  });

  it("uses local Codex limit records only without a selected account reference", () => {
    const recorded: SessionUsage = { ...session, quota: { observed_at: at, windows: [
      { minutes: 300, used_percent: 23, resets_at: "2026-10-17T10:00:00Z" },
      { minutes: 10080, used_percent: 45, resets_at: null },
    ] } };
    expect(items(recorded, null)[2]?.value).toBe("23%");
    expect(items(recorded, null)[3]?.detail).toContain("Reset time unknown.");
    expect(items(recorded, { ...account, windows: [] })[2]?.percent).toBeNull();
    expect(items(recorded, null)[2]?.detail).toContain("current account is not verified");
  });

  it("shows unsupported or unavailable observations honestly and discards another provider's sample", () => {
    expect(items(null, null).every((item) => item.percent === null)).toBe(true);
    expect(items(session, account, now, "other").every((item) => item.state === "unavailable")).toBe(true);
    expect(items(session, null, now, "claude")[0]?.state).toBe("unavailable");
  });
});
