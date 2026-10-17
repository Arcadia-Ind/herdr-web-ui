import { describe, expect, it } from "bun:test";
import type { ConversationTurn } from "../../shared/protocol.ts";
import { ComposerDraftStore } from "./composerDraft.ts";
import { appendChatQuote, chatPromptState, chatProse, copyChatExchange, matchingChatPrompts, selectedChatText, type ChatQuoteReference } from "./chatHighlights.ts";

const user = (text: string): ConversationTurn => ({ role: "user", ts: null, parts: [{ kind: "text", text }] });
const assistant = (text: string): ConversationTurn => ({ role: "assistant", ts: null, parts: [{ kind: "text", text, phase: "final_answer" }] });
const labels = { prompt: "Prompt", answer: "Answer" };
const quote: ChatQuoteReference = { paneId: "pane-a", historyId: "history-a", turnKey: "row-7", role: "assistant", timestamp: null, text: "First point.\nSecond point." };

describe("Chat Highlights: parsed prose and prompt matching", () => {
  it("retains Codex commentary and final prose without reasoning or tool input/output", () => {
    const turn: ConversationTurn = { role: "assistant", ts: null, parts: [
      { kind: "thinking", text: "PRIVATE REASONING" },
      { kind: "text", text: "Progress", phase: "commentary" },
      { kind: "tool", name: "exec", summary: "tool", input: "PRIVATE INPUT", output: "PRIVATE OUTPUT" },
      { kind: "text", text: "Answer", phase: "final_answer" },
    ] };
    expect(chatProse(turn)).toBe("Progress\n\nAnswer");
  });

  it("retains Claude unphased prose before and after tool use", () => {
    const turn = assistant("Before");
    turn.parts = [{ kind: "text", text: "Before" }, { kind: "thinking", text: "hidden" }, { kind: "tool", name: "Read", summary: "x", input: "x", output: "x" }, { kind: "text", text: "After" }];
    expect(chatProse(turn)).toBe("Before\n\nAfter");
  });

  it("uses actual preceding parsed user turns, including repeated answers and loaded earlier context", () => {
    const first = user("Question one"), a = assistant("Answer one"), continuation = assistant("More"), second = user("Question two"), b = assistant("Answer two");
    const prompts = matchingChatPrompts([first, a, continuation, second, b]);
    expect(prompts.get(a)).toBe(first);
    expect(prompts.get(continuation)).toBe(first);
    expect(prompts.get(b)).toBe(second);
    expect(copyChatExchange(prompts.get(b)!, "Answer two", labels)).toBe("## Prompt\n\n> Question two\n\n## Answer\n\nAnswer two");
  });

  it("does not invent the prompt for an assistant at a paginated boundary", () => {
    const a = assistant("Visible answer");
    expect(matchingChatPrompts([a]).get(a)).toBeNull();
    expect(copyChatExchange(null, "Visible answer", labels)).toBeNull();
    expect(copyChatExchange(assistant("Not a user prompt"), "Visible answer", labels)).toBeNull();
    const earlier = user("Loaded later");
    expect(matchingChatPrompts([earlier, a]).get(a)).toBe(earlier);
  });

  it("does not carry a prompt through a compaction boundary or replace it with runtime notices", () => {
    const p = user("Real user prompt"), a = assistant("Result");
    const notice: ConversationTurn = { role: "user", ts: null, parts: [{ kind: "notice", text: "Background result" }] };
    expect(matchingChatPrompts([p, notice, a]).get(a)).toBe(p);
    const compact: ConversationTurn = { role: "assistant", ts: null, parts: [{ kind: "compact", text: "Summary" }] };
    expect(matchingChatPrompts([p, compact, a]).get(a)).toBeNull();
  });

  it("reports an image-only prompt separately and preserves a multiline prompt in combined copy", () => {
    const image: ConversationTurn = { role: "user", ts: null, parts: [{ kind: "image", media_type: "image/png", ref: "image-1" }] };
    expect(chatPromptState(image)).toBe("empty");
    expect(chatPromptState(null)).toBe("missing");
    expect(copyChatExchange(user("One\n\nTwo"), "Answer", labels)).toContain("> One\n> \n> Two");
    expect(copyChatExchange(image, "Answer", labels)).toBeNull();
  });
});

describe("Chat Highlights: draft preservation and selection", () => {
  it("appends repeated references and replies, preserving existing bytes", () => {
    const original = "An existing reply.  \n";
    const first = appendChatQuote(original, quote, 1000, "Assistant")!;
    const edited = `${first}My first answer.\n`;
    const combined = appendChatQuote(edited, { ...quote, turnKey: "row-8", text: "Another point" }, 1000, "Assistant")!;
    expect(first.startsWith(original)).toBe(true);
    expect(combined.startsWith(edited)).toBe(true);
    expect(combined).toContain("> First point.\n> Second point.");
    expect(combined).toContain("> Another point");
  });

  it("refuses an oversized or empty quote instead of truncating a draft", () => {
    expect(appendChatQuote("keep me", quote, 10, "Assistant")).toBeNull();
    expect(appendChatQuote("keep me", { ...quote, text: " \n" }, 1000, "Assistant")).toBeNull();
    const next = appendChatQuote("", quote, 1000, "Assistant")!;
    expect(appendChatQuote("", quote, next.length, "Assistant")).toBe(next);
  });

  it("uses existing per-pane persistence without starting a send or changing another pane", () => {
    const saved = new Map<string, string>();
    const store = new ComposerDraftStore(() => ({ getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => { saved.set(key, value); }, removeItem: (key) => { saved.delete(key); } }));
    store.set("pane-a", "Draft A"); store.set("pane-b", "Draft B");
    const append = (ref: ChatQuoteReference): boolean => {
      const next = appendChatQuote(store.read(ref.paneId).text, ref, 1000, "Assistant");
      if (next === null) return false;
      store.set(ref.paneId, next); return true;
    };
    expect(append(quote)).toBe(true); expect(append({ ...quote, text: "Next" })).toBe(true);
    expect(store.read("pane-a").text.startsWith("Draft A")).toBe(true);
    expect(store.read("pane-a").sending).toBe(false);
    expect(store.read("pane-b").text).toBe("Draft B");
    expect([...saved.keys()].some((key) => key.includes("sending"))).toBe(false);
    expect(new ComposerDraftStore(() => ({ getItem: (key) => saved.get(key) ?? null, setItem: () => {}, removeItem: () => {} })).read("pane-a").text).toBe(store.read("pane-a").text);
  });

  it("accepts nested message selection and rejects cross-message, empty, and multiple ranges", () => {
    const start = {} as Node, end = {} as Node, outside = {} as Node;
    const body = { contains: (node: Node | null) => node === start || node === end };
    const selection = (last: Node, text = "Selected text", count = 1, collapsed = false) => ({ isCollapsed: collapsed, rangeCount: count, getRangeAt: () => ({ startContainer: start, endContainer: last } as Range), toString: () => text });
    expect(selectedChatText(selection(end), body)).toBe("Selected text");
    expect(selectedChatText(selection(outside), body)).toBeNull();
    expect(selectedChatText(selection(end, "  "), body)).toBeNull();
    expect(selectedChatText(selection(end, "x", 2), body)).toBeNull();
    expect(selectedChatText(selection(end, "x", 1, true), body)).toBeNull();
    expect(selectedChatText(null, body)).toBeNull();
  });
});
