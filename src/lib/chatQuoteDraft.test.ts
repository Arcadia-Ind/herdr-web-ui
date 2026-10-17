import { expect, it } from "bun:test";
import { ComposerDraftStore } from "./composerDraft.ts";
import { appendChatQuoteDraft } from "./chatQuoteDraft.ts";
import type { ChatQuoteReference } from "./chatHighlights.ts";
import { paneStorageId } from "../../shared/machines.ts";

it("appends repeated quotes to the latest saved draft and keeps other PCs and sends unchanged", () => {
  const saved = new Map<string, string>();
  const store = new ComposerDraftStore(() => ({
    getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => { saved.set(key, value); }, removeItem: (key) => { saved.delete(key); },
  }));
  const key = "herdr-web-ui:composer-draft:" + paneStorageId("pc1", "w1:p1");
  const other = "herdr-web-ui:composer-draft:" + paneStorageId("pc2", "w1:p1");
  store.set(key, "old cached text");
  store.set(other, "another PC's text");
  saved.set(key, "Edited in another tab.  \n");
  const quote: ChatQuoteReference = { paneId: "w1:p1", historyId: "session-a", turnKey: "turn-1", role: "assistant", timestamp: null, text: "Visible answer" };
  expect(appendChatQuoteDraft(store, "pc1", "w1:p1", "session-a", quote, "Codex", 1000)).toBe(true);
  expect(appendChatQuoteDraft(store, "pc1", "w1:p1", "session-a", { ...quote, text: "Second answer" }, "Codex", 1000)).toBe(true);
  expect(store.read(key).text).toStartWith("Edited in another tab.  \n");
  expect(store.read(key).text).toContain("> Visible answer\n\n> Codex\n> Second answer");
  expect(store.read(key).sending).toBe(false);
  expect(store.read(other).text).toBe("another PC's text");
  expect(saved.get(key)).toBe(store.read(key).text);
  const before = store.read(key).text;
  expect(appendChatQuoteDraft(store, "pc1", "w1:p1", "new-session", quote, "Codex", 1000)).toBe(false);
  expect(appendChatQuoteDraft(store, "pc1", "w9:p1", "session-a", quote, "Codex", 1000)).toBe(false);
  expect(appendChatQuoteDraft(store, "pc1", "w1:p1", "session-a", quote, "Codex", 1)).toBe(false);
  expect(store.read(key).text).toBe(before);
});
