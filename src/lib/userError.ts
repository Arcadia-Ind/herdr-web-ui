import { ApiError } from "./api.ts";
import { t } from "./i18n.ts";

export interface UserError {
  message: string;
  /** the server's or the browser's own words, kept visible and selectable; null when they add nothing */
  detail: string | null;
}

/** What fetch rejects with when the request never got an answer: Chrome, Firefox and Safari words. */
const NETWORK_FAILURE = /failed to fetch|networkerror|network request failed|load failed/i;

function sentence(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.status === 401 || cause.status === 403) return t("This browser is not signed in to this PC any more. Pair it again in Settings → Phone & devices.");
    if (cause.status === 404) return t("That item no longer exists on the PC. Refresh and try again.");
    if (cause.status === 409) return t("It changed on the PC while you were acting. Check it and try again.");
    if (cause.status === 408 || cause.status === 504) return t("The PC took too long to answer. Try again.");
    if (cause.status >= 500) return t("The PC could not do that. Try again; if it keeps failing, restart herdr web ui on the PC.");
    return t("Something went wrong. Try again.");
  }
  if (cause instanceof Error && (cause.name === "AbortError" || cause.name === "TimeoutError")) return t("The PC took too long to answer. Try again.");
  if (cause instanceof TypeError && NETWORK_FAILURE.test(cause.message)) return t("Can't reach the PC. Check your connection, then try again.");
  return t("Something went wrong. Try again.");
}

/** A plain sentence for a failure, with what the server or the browser said kept beside it. */
export function userErrorMessage(cause: unknown): UserError {
  const message = sentence(cause);
  const original = cause instanceof ApiError ? cause.detail : cause instanceof Error ? cause.message : String(cause);
  return { message, detail: original.trim() === "" || original === message ? null : original };
}
