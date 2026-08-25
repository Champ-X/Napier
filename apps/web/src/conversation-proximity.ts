/**
 * Pure viewport proximity helper for the conversation feed (design §9.1).
 * Kept side-effect free so both the follow-state reducer and its hook can
 * decide when auto-follow should engage without touching the DOM directly.
 */
export type ConversationProximityViewport = Pick<
  HTMLElement,
  "clientHeight" | "scrollHeight" | "scrollTop"
>;

export function conversationIsNearBottom(
  viewport: ConversationProximityViewport,
  threshold = 96,
): boolean {
  return (
    viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <=
    threshold
  );
}
