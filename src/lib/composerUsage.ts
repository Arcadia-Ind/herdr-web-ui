import type { ProviderUsage, UsageWindow } from "../../shared/protocol.ts";
import type { SessionUsage } from "../../shared/composer-usage.ts";
import type { Translate } from "./i18n.ts";

/** Display policies, not provider validity guarantees. The server caches quotas for five minutes. */
export const QUOTA_STALE_MS = 5 * 60_000;
export const SESSION_STALE_MS = 30 * 60_000;
export type UsageState = "ready" | "unknown" | "stale" | "unavailable" | "rate_limited";
export interface UsageBarItem {
  readonly id: "context" | "cache" | "five_hour" | "week";
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  readonly percent: number | null;
  readonly state: UsageState;
}
export interface UsageBarData {
  readonly agent: string | null;
  /** Only the same pane's bound transcript may supply this sample. */
  readonly session: SessionUsage | null;
  /** Explicit account reference from the existing UsageReport; never an inferred pane account. */
  readonly account: ProviderUsage | null;
  /** Use an existing display clock. This module starts no polling. */
  readonly now: number;
}

const validCount = (value: number | null): value is number => value !== null && Number.isSafeInteger(value) && value >= 0;
const share = (used: number | null, limit: number | null): number | null =>
  validCount(used) && validCount(limit) && limit > 0 ? used / limit * 100 : null;
const time = (value: string | null): number => value === null ? NaN : Date.parse(value);

function ageState(observedAt: string | null, now: number, maxAge: number): UsageState {
  const checked = time(observedAt);
  return !Number.isFinite(checked) || checked > now ? "unknown" : now - checked > maxAge ? "stale" : "ready";
}

export function usageStateLabel(state: UsageState, t: Translate): string {
  return state === "stale" ? t("Stale") : state === "unavailable" ? t("Unavailable")
    : state === "rate_limited" ? t("Rate limited") : state === "unknown" ? t("Unknown") : "";
}

function percentText(percent: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(percent) + "%";
}

function tokenItems(session: SessionUsage | null, now: number, locale: string, t: Translate): UsageBarItem[] {
  const compact = (count: number | null): string => validCount(count) ? new Intl.NumberFormat(locale, { notation: "compact", maximumSignificantDigits: 3 }).format(count) : "?";
  const exact = (count: number | null): string => validCount(count) ? new Intl.NumberFormat(locale).format(count) : t("Unknown");
  const observed = session?.observed_at ?? null;
  const recorded = observed === null ? t("Observation time unknown.") : t("Reported {time}.", { time: observed });
  const age = ageState(observed, now, SESSION_STALE_MS);
  const context = session?.context;
  const occupancy = context ? share(context.used, context.limit) : null;
  const cache = session?.cache;
  const cachePercent = cache && (cache.read_tokens === null || cache.input_tokens === null || cache.read_tokens <= cache.input_tokens)
    ? share(cache.read_tokens, cache.input_tokens) : null;
  const contextValue = context && validCount(context.used)
    ? `${compact(context.used)} / ${compact(context.limit)}${occupancy === null ? "" : ` · ${percentText(occupancy, locale)}`}` : t("Unknown");
  const cacheValue = cache && validCount(cache.read_tokens)
    ? `${compact(cache.read_tokens)}${cachePercent === null ? "" : ` · ${percentText(cachePercent, locale)}`}` : t("Unknown");
  return [
    { id: "context", label: t("Context"), value: session === null ? t("Unavailable") : contextValue,
      percent: occupancy, state: session === null ? "unavailable" : occupancy === null ? "unknown" : age,
      detail: [
        session === null ? t("No session usage reported.") : context?.basis === "input" ? t("Last request input; includes cache reads and cache creation.")
          : t("Last request input and output; excludes cumulative session usage."),
        t("{used} / {limit} tokens", { used: exact(context?.used ?? null), limit: exact(context?.limit ?? null) }),
        recorded,
      ].join(" ") },
    { id: "cache", label: t("Cache read"), value: session === null ? t("Unavailable") : cacheValue,
      percent: cachePercent, state: session === null ? "unavailable" : cachePercent === null ? "unknown" : age,
      detail: [
        t("Cache reads / all input tokens in the last request."),
        t("{used} / {limit} tokens", { used: exact(cache?.read_tokens ?? null), limit: exact(cache?.input_tokens ?? null) }),
        t("Cache creation: {tokens} tokens.", { tokens: exact(cache?.creation_tokens ?? null) }),
        recorded,
      ].join(" ") },
  ];
}

/** Codex's session/week buckets cover several lengths. Claude's keys state exact periods. */
function matchingWindow(window: UsageWindow, minutes: number, provider: ProviderUsage["id"]): boolean {
  if (window.scope !== null || window.kind !== (minutes === 300 ? "session" : "week")) return false;
  const start = time(window.starts_at);
  const reset = time(window.resets_at);
  return Number.isFinite(start) && Number.isFinite(reset) ? reset - start === minutes * 60_000 : provider === "claude";
}

function quotaItem(id: "five_hour" | "week", data: UsageBarData, session: SessionUsage | null, locale: string, t: Translate): UsageBarItem {
  const minutes = id === "five_hour" ? 300 : 10080;
  const label = id === "five_hour" ? t("5h") : t("Weekly");
  const account = data.account?.id === data.agent ? data.account : null;
  const window = account?.windows.find((window) => matchingWindow(window, minutes, account.id));
  // A selected reference never falls back to a different account's recorded sample.
  const local = data.account === null ? session?.quota?.windows.find((window) => window.minutes === minutes) : undefined;
  const raw = window?.used_percent ?? local?.used_percent;
  const percent = typeof raw === "number" && Number.isFinite(raw) && raw >= 0 && raw <= 100 ? raw : null;
  const checked = account?.checked_at ?? (data.account === null ? session?.quota?.observed_at : null) ?? null;
  const reset = window?.resets_at ?? local?.resets_at ?? null;
  const resetMs = time(reset);
  let state: UsageState = percent === null ? "unavailable" : ageState(checked, data.now, QUOTA_STALE_MS);
  if (percent !== null && Number.isFinite(resetMs) && resetMs <= data.now) state = "stale";
  if (account?.problem !== null && account?.problem !== undefined) state = account.problem === "rate_limited" ? "rate_limited" : percent === null ? "unavailable" : "stale";
  const reference = account ? t("Account reference: {account}. The pane's account is not verified.", { account: account.account ?? account.key })
    : t("Recorded account limits; the current account is not verified.");
  const problem = account?.problem ? t("Quota status: {status}.", { status: account.problem }) : "";
  return { id, label, value: percent === null ? t("Unavailable") : percentText(percent, locale), percent, state,
    detail: [
      reference, id === "five_hour" ? t("Used share of the five-hour account limit.") : t("Used share of the weekly account limit."),
      reset !== null && Number.isFinite(resetMs) ? t("Resets {time}.", { time: new Date(resetMs).toISOString() }) : t("Reset time unknown."),
      checked === null ? t("Observation time unknown.") : t("Reported {time}.", { time: checked }), problem,
    ].filter(Boolean).join(" ") };
}

/** Pure presentation: consumes existing observations and makes no provider or network calls. */
export function usageBarItems(data: UsageBarData, t: Translate, locale = "en-US"): UsageBarItem[] {
  const session = data.session?.provider === data.agent ? data.session : null;
  return [...tokenItems(session, data.now, locale, t), quotaItem("five_hour", data, session, locale, t), quotaItem("week", data, session, locale, t)];
}
