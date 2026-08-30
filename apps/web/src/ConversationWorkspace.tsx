import { lazy, Suspense } from "react";

import { advancedSurfaceCopy } from "./advanced-surface-copy";
import type { ArtifactInspection } from "./artifact-inspection";
import { ConversationFollowButton } from "./ConversationFollowButton";
import { useConversationFollow } from "./use-conversation-follow";
import type { useWorkspaceViewModel } from "./use-workspace-view-model";
import { shouldShowWelcomePanel, WelcomePanel } from "./WelcomePanel";

const LazyConversationLedger = lazy(() =>
  import("./ConversationLedger").then(({ ConversationLedger }) => ({
    default: ConversationLedger,
  })),
);

type WorkspaceViewModel = ReturnType<typeof useWorkspaceViewModel>;

export function ConversationWorkspace({
  vm,
  endRef,
  viewportRef,
  onOpenSubagentHub,
  onInspectArtifact,
}: ConversationWorkspaceProps) {
  const accessibilityCopy = advancedSurfaceCopy.accessibility;
  const follow = useConversationFollow({
    endRef,
    viewportRef,
    itemCount: vm.messages.length,
    streamingText: vm.streamingText,
    running: vm.isRunning,
    view: "conversation",
  });
  const showWelcome = shouldShowConversationWelcome(
    vm.messages,
    vm.detail?.events.length ?? 0,
  );
  return (
    <section
      ref={viewportRef}
      className="conversation"
      aria-label={accessibilityCopy.conversation}
    >
      {showWelcome ? (
        <WelcomePanel />
      ) : (
        <Suspense fallback={<div className="message-ledger" />}>
          <LazyConversationLedger
            messages={vm.messages}
            detail={vm.detail}
            streamingText={vm.streamingText}
            endRef={endRef}
            onBranch={(seq) => void vm.branchFrom(seq)}
            onLedgerChanged={vm.refreshActiveThread}
            onOpenSubagentHub={onOpenSubagentHub}
            onInspectArtifact={onInspectArtifact}
          />
        </Suspense>
      )}
      {showWelcome ? null : (
        <ConversationFollowButton
          paused={follow.paused}
          pendingCount={follow.pendingCount}
          onJump={follow.jumpToLatest}
        />
      )}
    </section>
  );
}

export interface ConversationWorkspaceProps {
  vm: Pick<
    WorkspaceViewModel,
    | "branchFrom"
    | "detail"
    | "isRunning"
    | "messages"
    | "refreshActiveThread"
    | "streamingText"
  >;
  endRef: React.RefObject<HTMLDivElement | null>;
  viewportRef: React.RefObject<HTMLElement | null>;
  onOpenSubagentHub(taskId?: string): void;
  onInspectArtifact(inspection: ArtifactInspection): void;
}

export function shouldShowConversationWelcome(
  messages: Parameters<typeof shouldShowWelcomePanel>[0],
  eventCount: number,
): boolean {
  return shouldShowWelcomePanel(messages) && eventCount === 0;
}
