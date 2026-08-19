import { useEffect, useRef } from "react";

import type { WorkspaceView } from "./WorkspaceViewNavigation";

export function useConversationAutoScroll(input: {
  endRef: React.RefObject<HTMLDivElement | null>;
  viewportRef: React.RefObject<HTMLElement | null>;
  messageCount: number;
  streamingText: string;
  running: boolean;
  view: WorkspaceView;
}): void {
  const nearBottomRef = useRef(true);
  useEffect(() => {
    const viewport = input.viewportRef.current;
    if (!viewport || input.view !== "conversation") return;
    const update = () => {
      nearBottomRef.current = conversationIsNearBottom(viewport);
    };
    update();
    viewport.addEventListener("scroll", update, { passive: true });
    return () => viewport.removeEventListener("scroll", update);
  }, [input.view, input.viewportRef]);
  useEffect(() => {
    if (input.view !== "conversation" || !nearBottomRef.current) return;
    const frame = requestAnimationFrame(() => {
      input.endRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
    });
    return () => cancelAnimationFrame(frame);
  }, [
    input.endRef,
    input.messageCount,
    input.running,
    input.streamingText,
    input.view,
  ]);
}

export function conversationIsNearBottom(
  viewport: Pick<HTMLElement, "clientHeight" | "scrollHeight" | "scrollTop">,
  threshold = 96,
): boolean {
  return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= threshold;
}
