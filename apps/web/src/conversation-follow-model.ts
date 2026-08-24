/**
 * Pure follow-state model for the conversation feed (design §9.1).
 *
 * The conversation auto-follows new output while the reader is near the bottom.
 * Once the reader scrolls up, following pauses and newly arrived items are
 * counted so the view can offer a "new activity" affordance that restores
 * following on demand. This module is side-effect free so it can be unit
 * tested independently of the DOM.
 */
export interface ConversationFollowState {
  /** Whether the view should auto-scroll as new items arrive. */
  following: boolean;
  /** Count of items that arrived while following was paused. */
  pendingCount: number;
  /** Last observed feed item count, used to derive arrival deltas. */
  observedCount: number;
}

export type ConversationFollowAction =
  | { type: "sync"; count: number }
  | { type: "proximity"; nearBottom: boolean }
  | { type: "jump" };

export function initialConversationFollowState(
  count = 0,
): ConversationFollowState {
  return { following: true, pendingCount: 0, observedCount: count };
}

export function reduceConversationFollow(
  state: ConversationFollowState,
  action: ConversationFollowAction,
): ConversationFollowState {
  switch (action.type) {
    case "sync": {
      const arrived = Math.max(0, action.count - state.observedCount);
      if (state.following) {
        return { ...state, pendingCount: 0, observedCount: action.count };
      }
      return {
        ...state,
        pendingCount: state.pendingCount + arrived,
        observedCount: action.count,
      };
    }
    case "proximity": {
      if (action.nearBottom) {
        if (state.following && state.pendingCount === 0) return state;
        return { ...state, following: true, pendingCount: 0 };
      }
      if (!state.following) return state;
      return { ...state, following: false };
    }
    case "jump": {
      if (state.following && state.pendingCount === 0) return state;
      return { ...state, following: true, pendingCount: 0 };
    }
  }
}
