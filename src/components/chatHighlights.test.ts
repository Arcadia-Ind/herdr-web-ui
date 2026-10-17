import { describe, expect, it } from "bun:test";
import { createElement, createRef, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ConversationTurn } from "../../shared/protocol.ts";
import { SettingsProvider } from "../lib/settings.ts";
import { ChatHighlightsActions, ChatHighlightsMode, ChatHighlightsProse, type ChatTurnHighlights } from "./ChatHighlights.tsx";

function render(children: ReactNode): string {
  const saved = Object.getOwnPropertyDescriptor(navigator, "languages");
  Object.defineProperty(navigator, "languages", { configurable: true, value: ["en"] });
  try { return renderToStaticMarkup(createElement(SettingsProvider, { children })); }
  finally { if (saved) Object.defineProperty(navigator, "languages", saved); else Reflect.deleteProperty(navigator, "languages"); }
}

const prompt: ConversationTurn = { role: "user", ts: null, parts: [{ kind: "text", text: "A matching question" }] };
const highlights: ChatTurnHighlights = { reference: { paneId: "pane-a", historyId: "h1", turnKey: "t2", role: "assistant", timestamp: null, text: "An answer" }, prompt, textOnly: true, onAppendQuote: () => true };

describe("Chat Highlights controls", () => {
  it("renders assistant prose without any reasoning, tool details, or tool result controls", () => {
    const turn: ConversationTurn = { role: "assistant", ts: null, parts: [
      { kind: "thinking", text: "SECRET REASONING" }, { kind: "text", text: "Visible progress", phase: "commentary" },
      { kind: "tool", name: "exec", summary: "SECRET SUMMARY", input: "SECRET INPUT", output: "SECRET RESULT" },
      { kind: "text", text: "**Visible answer**", phase: "final_answer" },
    ] };
    const html = render(createElement(ChatHighlightsProse, { turn }));
    expect(html).toContain("Visible progress"); expect(html).toContain("Visible answer"); expect(html).toContain("<strong>");
    expect(html).not.toContain("SECRET"); expect(html).not.toContain("chat-tool");
  });

  it("exposes keyboard/touch buttons and a pressed state for the text-only option", () => {
    const html = render(createElement(ChatHighlightsMode, { textOnly: true, onChange: () => {} }));
    expect(html).toContain('type="button"'); expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Text only"); expect(html).toContain("Tool details and reasoning are hidden");
  });

  it("offers message and selected-text quotes without a submit or send control", () => {
    const html = render(createElement(ChatHighlightsActions, { body: createRef<HTMLDivElement>(), highlights, answer: "An answer" }));
    expect(html).toContain("Quote message"); expect(html).toContain("Quote selected text");
    expect(html).toContain("Copy prompt and answer"); expect(html).not.toContain('type="submit"');
    expect(html).not.toContain("Send now"); expect(html).not.toContain("Reply draft unavailable");
  });

  it("disables combined copy with a visible reason when the paginated prompt is not loaded", () => {
    const html = render(createElement(ChatHighlightsActions, { body: createRef<HTMLDivElement>(), highlights: { ...highlights, prompt: null }, answer: "An answer" }));
    expect(html).toContain("Matching prompt unavailable — load earlier messages.");
    expect(html).toMatch(/disabled=""[^>]*title="Matching prompt unavailable/);
    expect(html).not.toContain("A matching question");
  });

  it("does not offer combined copy for a user message or enable a missing draft adapter", () => {
    const html = render(createElement(ChatHighlightsActions, { body: createRef<HTMLDivElement>(), highlights: { ...highlights, reference: { ...highlights.reference, role: "user" }, onAppendQuote: undefined }, answer: "" }));
    expect(html).not.toContain("Copy prompt and answer"); expect(html).toContain("Reply draft unavailable");
    expect(html.match(/disabled=""/g)?.length).toBe(2);
  });
});
