import { paneStorageId } from "../../shared/machines.ts";
import { appendChatQuote, type ChatQuoteReference } from "./chatHighlights.ts";
import type { ComposerDraftStore } from "./composerDraft.ts";

/** The shared integration adapter writes only the existing editable draft. */
export function appendChatQuoteDraft(store: ComposerDraftStore, machine: string, pane: string | null,
  history: string | null, quote: ChatQuoteReference, roleLabel: string, max: number): boolean {
  if (pane === null || quote.paneId !== pane || history !== quote.historyId) return false;
  const key = "herdr-web-ui:composer-draft:" + paneStorageId(machine, pane);
  store.refresh(key);
  const next = appendChatQuote(store.read(key).text, quote, max, roleLabel);
  if (next === null) return false;
  store.set(key, next);
  return true;
}
