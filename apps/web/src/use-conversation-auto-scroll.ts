import { useEffect } from "react";

import type { WorkspaceView } from "./WorkspaceViewNavigation";

export function useConversationAutoScroll(input: {
  endRef: React.RefObject<HTMLDivElement | null>;
  messageCount: number;
  streamingText: string;
  running: boolean;
  view: WorkspaceView;
}): void {
  useEffect(() => {
    if (input.view !== "conversation") return;
    input.endRef.current?.scrollIntoView({
      behavior: input.running ? "smooth" : "instant",
      block: "end",
    });
  }, [
    input.endRef,
    input.messageCount,
    input.running,
    input.streamingText,
    input.view,
  ]);
}
