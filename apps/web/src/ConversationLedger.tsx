import { useEffect, useMemo, useState } from "react";

import type { WebThreadDetail } from "./api";
import { clearInvalidConversationArtifactAnchor } from "./conversation-artifact-anchor";
import { conversationFeedProjection } from "./conversation-feed-projection";
import type { ConversationFeedEntry } from "./conversation-feed-grouping";
import { shellCopy } from "./shell-copy";
import { ConversationActivityGroupCard } from "./ConversationActivityGroupCard";
import { ConversationApprovalCard } from "./ConversationApprovalCard";
import { ConversationArtifactCard } from "./ConversationArtifactCard";
import { ConversationBrowserActivityCard } from "./ConversationBrowserActivityCard";
import { ConversationCitationCard } from "./ConversationCitationCard";
import {
  ConversationGenericActivityCard,
  ConversationMessageCard,
  ConversationStreamingCard,
} from "./ConversationMessageCards";
import { ConversationNetworkActivityCard } from "./ConversationNetworkActivityCard";
import { ConversationPlanCard } from "./ConversationPlanCard";
import { ConversationRecoveryCard } from "./ConversationRecoveryCard";
import { ConversationSubagentCard } from "./ConversationSubagentCard";
import { ConversationToolActivityCard } from "./ConversationToolActivityCard";
import type { MessageView } from "./use-workspace-view-model";

const INITIAL_FEED_WINDOW = 160;
const FEED_WINDOW_STEP = 160;

export interface ConversationLedgerProps {
  messages: MessageView[];
  detail: WebThreadDetail | undefined;
  streamingText: string;
  endRef: React.RefObject<HTMLDivElement | null>;
  onBranch(seq: number): void;
  onLedgerChanged(): Promise<void>;
  onOpenSubagentHub(taskId?: string): void;
}

export function ConversationLedger({
  messages,
  detail,
  streamingText,
  endRef,
  onBranch,
  onLedgerChanged,
  onOpenSubagentHub,
}: ConversationLedgerProps) {
  const projection = useMemo(
    () => conversationFeedProjection(messages, detail),
    [detail, messages],
  );
  const artifactAnchorKey = projection.artifactAnchorIds.join("|");
  const [visibleLimit, setVisibleLimit] = useState(INITIAL_FEED_WINDOW);
  useEffect(() => setVisibleLimit(INITIAL_FEED_WINDOW), [detail?.thread.id]);
  useEffect(() => {
    const validate = () =>
      clearInvalidConversationArtifactAnchor(
        new Set(projection.artifactAnchorIds),
      );
    validate();
    window.addEventListener("hashchange", validate);
    return () => window.removeEventListener("hashchange", validate);
  }, [artifactAnchorKey, projection.artifactAnchorIds]);
  const hiddenCount = Math.max(0, projection.feed.length - visibleLimit);
  const visibleFeed = projection.feed.slice(hiddenCount);

  return (
    <div className="message-ledger">
      {hiddenCount > 0 ? (
        <button
          className="conversation-show-earlier"
          type="button"
          onClick={() =>
            setVisibleLimit((current) => current + FEED_WINDOW_STEP)
          }
        >
          {shellCopy.conversationFeed.showEarlier} · {hiddenCount}
        </button>
      ) : null}
      {visibleFeed.map((item) =>
        renderFeedItem(
          item,
          projection,
          onBranch,
          onLedgerChanged,
          onOpenSubagentHub,
        ),
      )}
      {streamingText ? (
        <ConversationStreamingCard
          text={streamingText}
          workspaceLinks={projection.workspaceLinks}
          citationLinks={projection.citationLinks}
        />
      ) : null}
      <div ref={endRef} />
    </div>
  );
}

function renderFeedItem(
  item: ConversationFeedEntry,
  projection: ReturnType<typeof conversationFeedProjection>,
  onBranch: ConversationLedgerProps["onBranch"],
  onLedgerChanged: ConversationLedgerProps["onLedgerChanged"],
  onOpenSubagentHub: ConversationLedgerProps["onOpenSubagentHub"],
) {
  if (item.kind === "activity-group") {
    return <ConversationActivityGroupCard key={item.id} group={item} />;
  }
  if (item.kind === "message") {
    return (
      <ConversationMessageCard
        key={`message-${item.message.id}`}
        message={item.message}
        workspaceLinks={projection.workspaceLinks}
        citationLinks={projection.citationLinks}
        {...(item.message.role === "assistant"
          ? { onBranch: () => onBranch(item.message.seq) }
          : {})}
      />
    );
  }
  if (item.kind === "activity") {
    return (
      <ConversationGenericActivityCard
        key={`activity-${item.activity.id}`}
        activity={item.activity}
      />
    );
  }
  if (item.kind === "artifact") {
    return (
      <ConversationArtifactCard
        key={`artifact-${item.artifact.planId}-${item.artifact.artifact.id}`}
        item={item.artifact}
        threadId={item.artifact.threadId}
        onLedgerChanged={onLedgerChanged}
      />
    );
  }
  if (item.kind === "citation") {
    return (
      <ConversationCitationCard
        key={`citation-${item.citation.citationId}`}
        citation={item.citation}
        index={
          projection.citationLinks.find(
            (link) => link.citationId === item.citation.citationId,
          )?.index ?? 1
        }
      />
    );
  }
  return renderExecutionFeedItem(item, onOpenSubagentHub);
}

type ExecutionFeedItem = Exclude<
  ConversationFeedEntry,
  | { kind: "activity-group" }
  | { kind: "message" }
  | { kind: "activity" }
  | { kind: "artifact" }
  | { kind: "citation" }
>;

function renderExecutionFeedItem(
  item: ExecutionFeedItem,
  onOpenSubagentHub: ConversationLedgerProps["onOpenSubagentHub"],
) {
  if (item.kind === "network") {
    return (
      <ConversationNetworkActivityCard
        key={`network-${item.activity.callId}`}
        activity={item.activity}
      />
    );
  }
  if (item.kind === "browser") {
    return (
      <ConversationBrowserActivityCard
        key={`browser-${item.activity.callId}`}
        activity={item.activity}
      />
    );
  }
  if (item.kind === "plan") {
    return (
      <ConversationPlanCard
        key={`plan-${item.plan.plan.id}`}
        item={item.plan}
      />
    );
  }
  if (item.kind === "approval") {
    return (
      <ConversationApprovalCard
        key={`approval-${item.approval.decision.id}`}
        approval={item.approval}
      />
    );
  }
  if (item.kind === "subagent") {
    return (
      <ConversationSubagentCard
        key={`subagent-${item.subagent.task.id}`}
        item={item.subagent}
        onOpenHub={onOpenSubagentHub}
      />
    );
  }
  if (item.kind === "recovery") {
    return (
      <ConversationRecoveryCard
        key={`recovery-${item.recovery.id}`}
        item={item.recovery}
      />
    );
  }
  return (
    <ConversationToolActivityCard
      key={`tool-${item.activity.callId}`}
      activity={item.activity}
    />
  );
}
