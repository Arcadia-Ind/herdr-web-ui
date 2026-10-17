import { useEffect, useState, type RefObject } from "react";
import { Copy, Quote } from "lucide-react";
import type { ConversationTurn } from "../../shared/protocol.ts";
import { chatPromptState, chatProse, copyChatExchange, selectedChatText, type AppendChatQuote, type ChatQuoteReference } from "../lib/chatHighlights.ts";
import { copyText } from "../lib/clipboard.ts";
import { useT } from "../lib/i18n.ts";
import type { SkillMatcher } from "../lib/skillMentions.ts";
import { Markdown } from "./Markdown.tsx";
import "./ChatHighlights.css";

export interface ChatTurnHighlights {
  reference: ChatQuoteReference;
  prompt: ConversationTurn | null;
  textOnly: boolean;
  onAppendQuote?: AppendChatQuote;
}

export function ChatHighlightsProse({ turn, skills = null }: { turn: ConversationTurn; skills?: SkillMatcher | null }) {
  return <Markdown skills={skills}>{chatProse(turn)}</Markdown>;
}

export function ChatHighlightsMode({ textOnly, onChange }: { textOnly: boolean; onChange: (next: boolean) => void }) {
  const t = useT();
  return <div className="chat-highlights-mode">
    <button type="button" className="btn btn-ghost" aria-pressed={textOnly} onClick={() => onChange(!textOnly)}>{t("Text only")}</button>
    {textOnly && <span>{t("Tool details and reasoning are hidden")}</span>}
  </div>;
}

/** Message actions only copy or append a draft. There is no terminal/send callback here. */
export function ChatHighlightsActions({ body, highlights, answer }: { body: RefObject<HTMLDivElement | null>; highlights: ChatTurnHighlights; answer: string }) {
  const t = useT();
  const { reference, prompt, onAppendQuote } = highlights;
  const [selection, setSelection] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  useEffect(() => {
    setSelection(null);
    setStatus("");
    const update = () => setSelection(selectedChatText(window.getSelection(), body.current));
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, [body, reference.historyId, reference.turnKey, reference.text]);

  const quote = (text: string) => {
    if (!text.trim() || !onAppendQuote) return;
    const ok = onAppendQuote({ ...reference, text });
    setStatus(ok ? t("Added to the message draft") : t("Couldn't add the quote. The draft is unchanged."));
  };
  const copyPair = async () => {
    const text = copyChatExchange(prompt, answer, { prompt: t("Prompt"), answer: t("Answer") });
    if (text === null) return;
    const ok = await copyText(text);
    setStatus(ok ? t("Copied") : t("Couldn't copy. Select the text and copy it manually."));
  };
  const promptState = chatPromptState(prompt);
  const missing = promptState === "missing" ? t("Matching prompt unavailable — load earlier messages.")
    : promptState === "empty" ? t("The matching prompt has no text.") : null;

  return <div className="chat-highlights-actions">
    <div className="chat-highlights-buttons">
      <button type="button" className="chat-meta-btn" disabled={!onAppendQuote} onClick={() => quote(reference.text)}>
        <Quote aria-hidden="true" />{t("Quote message")}
      </button>
      <button type="button" className="chat-meta-btn" disabled={!onAppendQuote || selection === null}
        onPointerDown={(event) => event.preventDefault()} onClick={() => { if (selection !== null) quote(selection); }}>
        <Quote aria-hidden="true" />{t("Quote selected text")}
      </button>
      {reference.role === "assistant" && answer.trim() && <button type="button" className="chat-meta-btn"
        disabled={promptState !== "available"} title={missing ?? undefined} onClick={() => void copyPair()}>
        <Copy aria-hidden="true" />{t("Copy prompt and answer")}
      </button>}
    </div>
    {!onAppendQuote && <p className="chat-highlights-note">{t("Reply draft unavailable")}</p>}
    {reference.role === "assistant" && answer.trim() && missing !== null && <p className="chat-highlights-note">{missing}</p>}
    {status && <p className="chat-highlights-note" role="status">{status}</p>}
  </div>;
}
