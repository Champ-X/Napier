import { useCallback, useEffect, useReducer, useRef } from "react";

import {
  conversationIsNearBottom,
  type ConversationProximityViewport,
} from "./conversation-proximity";
import {
  initialConversationFollowState,
  reduceConversationFollow,
} from "./conversation-follow-model";
import type { WorkspaceView } from "./WorkspaceViewNavigation";

export interface ConversationFollow {
  /** Items awaiting the reader while auto-follow is paused. */
  pendingCount: number;
  /** True once the reader has scrolled away from the latest output. */
  paused: boolean;
  /** Scrolls to the newest item and resumes following. */
  jumpToLatest(): void;
}

export function useConversationFollow(input: {
  endRef: React.RefObject<HTMLDivElement | null>;
  viewportRef: React.RefObject<HTMLElement | null>;
  itemCount: number;
  streamingText: string;
  running: boolean;
  view: WorkspaceView;
}): ConversationFollow {
  const [state, dispatch] = useReducer(
    reduceConversationFollow,
    input.itemCount,
    initialConversationFollowState,
  );
  const followingRef = useRef(state.following);
  followingRef.current = state.following;

  useEffect(() => {
    const viewport = input.viewportRef.current;
    if (!viewport || input.view !== "conversation") return;
    const update = () =>
      dispatch({ type: "proximity", nearBottom: conversationIsNearBottom(viewport) });
    update();
    viewport.addEventListener("scroll", update, { passive: true });
    return () => viewport.removeEventListener("scroll", update);
  }, [input.view, input.viewportRef]);

  useEffect(() => {
    dispatch({ type: "sync", count: input.itemCount });
  }, [input.itemCount, input.streamingText, input.running]);

  useEffect(() => {
    if (input.view !== "conversation" || !followingRef.current) return;
    const frame = requestAnimationFrame(() => {
      input.endRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
    });
    return () => cancelAnimationFrame(frame);
  }, [
    input.endRef,
    input.itemCount,
    input.running,
    input.streamingText,
    input.view,
    state.following,
  ]);

  const jumpToLatest = useCallback(() => {
    dispatch({ type: "jump" });
    input.endRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
  }, [input.endRef]);

  return {
    pendingCount: state.pendingCount,
    paused: !state.following,
    jumpToLatest,
  };
}

export { conversationIsNearBottom };
export type { ConversationProximityViewport };
