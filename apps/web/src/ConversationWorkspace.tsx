import { lazy, Suspense } from "react";

import type { useWorkspaceViewModel } from "./use-workspace-view-model";
import { shouldShowWelcomePanel, WelcomePanel } from "./WelcomePanel";

const LazyConversationLedger = lazy(() => import("./ConversationLedger"));

type WorkspaceViewModel = ReturnType<typeof useWorkspaceViewModel>;

export function ConversationWorkspace({
  vm,
  endRef,
}: {
  vm: Pick<
    WorkspaceViewModel,
    | "branchFrom"
    | "detail"
    | "messages"
    | "refreshActiveThread"
    | "streamingText"
  >;
  endRef: React.RefObject<HTMLDivElement | null>;
}) {
  const showWelcome = shouldShowConversationWelcome(
    vm.messages,
    vm.detail?.events.length ?? 0,
  );
  return (
    <section className="conversation" aria-label="Conversation">
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
          />
        </Suspense>
      )}
    </section>
  );
}

export function shouldShowConversationWelcome(
  messages: Parameters<typeof shouldShowWelcomePanel>[0],
  eventCount: number,
): boolean {
  return shouldShowWelcomePanel(messages) && eventCount === 0;
}
