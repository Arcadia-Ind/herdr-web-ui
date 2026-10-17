import type { ConversationPart, ConversationTurn } from "../../shared/protocol.ts";

/** A reference to visible prose in one parsed turn, never tool output or reasoning. */
export interface ChatQuoteReference {
  paneId: string;
  historyId: string;
  turnKey: string;
  role: ConversationTurn["role"];
  timestamp: string | null;
  text: string;
}

/** The owner app appends to its existing per-pane draft; this callback cannot send. */
export type AppendChatQuote = (quote: ChatQuoteReference) => boolean;

export function chatProse(turn: ConversationTurn): string {
  return turn.parts.filter((part): part is Extract<ConversationPart, { kind: "text" }> => part.kind === "text")
    .map((part) => part.text).filter((text) => text.trim().length > 0).join("\n\n");
}

/** Match by parsed order, including loaded earlier pages, without guessing outside that context. */
export function matchingChatPrompts(turns: readonly ConversationTurn[]): Map<ConversationTurn, ConversationTurn | null> {
  const result = new Map<ConversationTurn, ConversationTurn | null>();
  let prompt: ConversationTurn | null = null;
  for (const turn of turns) {
    if (turn.parts.some((part) => part.kind === "compact")) prompt = null;
    if (turn.role === "user") {
      // Runtime notices and tool-result records are not a user's question.
      if (turn.parts.some((part) => part.kind === "text" || part.kind === "image")) prompt = turn;
    } else result.set(turn, prompt);
  }
  return result;
}

export type ChatPromptState = "available" | "missing" | "empty";
export function chatPromptState(prompt: ConversationTurn | null): ChatPromptState {
  return prompt === null ? "missing" : chatProse(prompt).trim() ? "available" : "empty";
}

/** The prompt comes only from the matching parsed user turn, not a scan or the current composer. */
export function copyChatExchange(prompt: ConversationTurn | null, answer: string, labels: { prompt: string; answer: string }): string | null {
  if (chatPromptState(prompt) !== "available" || !answer.trim()) return null;
  const quoted = chatProse(prompt!).split(/\r?\n/).map((line) => `> ${line}`).join("\n");
  return `## ${labels.prompt}\n\n${quoted}\n\n## ${labels.answer}\n\n${answer}`;
}

/** Preserve every existing draft character. Return null rather than clearing or truncating it. */
export function appendChatQuote(draft: string, quote: ChatQuoteReference, max: number, roleLabel: string): string | null {
  if (!quote.text.trim()) return null;
  const label = roleLabel.replace(/[\r\n]+/g, " ");
  const time = quote.timestamp ? ` · ${quote.timestamp.replace(/[\r\n]+/g, " ")}` : "";
  const body = quote.text.split(/\r?\n/).map((line) => `> ${line}`).join("\n");
  const gap = !draft || draft.endsWith("\n\n") ? "" : draft.endsWith("\n") ? "\n" : "\n\n";
  const next = `${draft}${gap}> ${label}${time}\n${body}\n\n`;
  return next.length <= max ? next : null;
}

/** Accept one selection wholly inside this message's prose, including nested Markdown nodes. */
export function selectedChatText(selection: Pick<Selection, "isCollapsed" | "rangeCount" | "getRangeAt" | "toString"> | null, body: Pick<Node, "contains"> | null): string | null {
  if (!selection || !body || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  if (!body.contains(range.startContainer) || !body.contains(range.endContainer)) return null;
  const text = selection.toString();
  return text.trim() ? text : null;
}
