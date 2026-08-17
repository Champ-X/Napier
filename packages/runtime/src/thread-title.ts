const TITLE_MAX_LENGTH = 40;
const DEFAULT_THREAD_TITLE = "Untitled ledger";

export interface ThreadTitleMessages {
  system: string;
  user: string;
}

/**
 * Build a bounded prompt that asks the model for a short thread title in the
 * same language as the user's request. Mirrors the auxiliary-call convention
 * used by the memory extractor: system + single user message, no tools.
 */
export function buildThreadTitleMessages(
  firstUserText: string,
): ThreadTitleMessages {
  const bounded = firstUserText.replace(/\s+/gu, " ").trim().slice(0, 2_000);
  return {
    system: [
      "You generate a short title for a work session from the user's first request.",
      "Do NOT answer, explain, or perform the request.",
      "Output ONLY the title: a concise noun phrase, at most 8 words (for Chinese, at most 16 characters),",
      "in the same language as the request, with no surrounding quotes and no ending punctuation.",
      'Example — request: "设计实现精美的网页来生动地介绍挂谷猜想" -> title: "挂谷猜想的精美网页设计".',
      'Example — request: "help me debug the failing auth test" -> title: "Auth test debugging".',
    ].join(" "),
    user: bounded,
  };
}

/**
 * Parse a model title response into a clean, bounded title. Returns undefined
 * when the response is empty so the caller can fall back to prompt-derivation.
 */
export function parseThreadTitleResponse(
  responseText: string,
): string | undefined {
  const firstLine = responseText
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return undefined;
  const cleaned = firstLine
    .replace(/^["'“”「『]+/u, "")
    .replace(/["'“”」』]+$/u, "")
    .replace(/[。．.!！?？]+$/u, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (!cleaned) return undefined;
  // A response far longer than a title is almost certainly an answer, not a
  // title; reject so the caller falls back to prompt derivation.
  if (cleaned.length > TITLE_MAX_LENGTH * 2) return undefined;
  return cleaned.slice(0, TITLE_MAX_LENGTH);
}

/**
 * Derive a title directly from the first user request. Used as a zero-cost
 * fallback when a model title call is unavailable (e.g. the demo model).
 */
export function deriveThreadTitleFromPrompt(
  firstUserText: string,
): string | undefined {
  const bounded = firstUserText.replace(/\s+/gu, " ").trim();
  if (!bounded) return undefined;
  return bounded.slice(0, TITLE_MAX_LENGTH);
}

export function isDefaultThreadTitle(title: string): boolean {
  return title.trim() === DEFAULT_THREAD_TITLE;
}
