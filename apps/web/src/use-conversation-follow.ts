import { useCallback, useEffect, useReducer, useRef } from "react";

import {
  conversationIsNearBottom,
  type ConversationProximityViewport,
} from "./conversation-proximity";
import {
  initialConversationFollowState,
  reduceConversationFollow,
} from "./conversation-follow-model";
import { motionScrollBehavior } from "./reduced-motion";
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
  const explicitJumpRef = useRef(false);

  useEffect(() => {
    const viewport = input.viewportRef.current;
    if (!viewport || input.view !== "conversation") return;
    const update = () =>
      dispatch({
        type: "proximity",
        nearBottom: conversationIsNearBottom(viewport),
      });
    update();
    viewport.addEventListener("scroll", update, { passive: true });
    return () => viewport.removeEventListener("scroll", update);
  }, [input.view, input.viewportRef]);

  useEffect(() => {
    dispatch({ type: "sync", count: input.itemCount });
  }, [input.itemCount, input.streamingText, input.running]);

  useEffect(() => {
    if (input.view !== "conversation" || !followingRef.current) return;
    if (explicitJumpRef.current) {
      explicitJumpRef.current = false;
      return;
    }
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

  useEffect(() => {
    const viewport = input.viewportRef.current;
    if (
      input.view !== "conversation" ||
      !viewport ||
      typeof ResizeObserver === "undefined"
    ) {
      return;
    }

    let observedLedger: Element | null = null;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (!followingRef.current) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        input.endRef.current?.scrollIntoView({
          behavior: "auto",
          block: "end",
        });
      });
    });
    const observeLedger = () => {
      const ledger = input.endRef.current?.parentElement ?? null;
      if (ledger === observedLedger) return;
      if (observedLedger) observer.unobserve(observedLedger);
      observedLedger = ledger;
      if (observedLedger) observer.observe(observedLedger);
    };
    observeLedger();

    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(observeLedger);
    mutationObserver?.observe(viewport, { childList: true, subtree: true });

    return () => {
      cancelAnimationFrame(frame);
      mutationObserver?.disconnect();
      observer.disconnect();
    };
  }, [input.endRef, input.view, input.viewportRef]);

  const jumpToLatest = useCallback(() => {
    explicitJumpRef.current = !followingRef.current;
    dispatch({ type: "jump" });
    input.endRef.current?.scrollIntoView({
      behavior: motionScrollBehavior(),
      block: "end",
    });
  }, [input.endRef]);

  return {
    pendingCount: state.pendingCount,
    paused: !state.following,
    jumpToLatest,
  };
}

export { conversationIsNearBottom };
export type { ConversationProximityViewport };
