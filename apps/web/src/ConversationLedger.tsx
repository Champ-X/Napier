import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  GitBranch,
} from "lucide-react";
import { useEffect } from "react";

import type { RunEvent } from "@napier/contracts";
import type { WebThreadDetail } from "./api";
import {
  conversationApprovalEventId,
  conversationApprovals,
} from "./conversation-approval-view-model";
import {
  conversationArtifactEventKey,
  conversationArtifactTargetId,
  conversationArtifactWorkspaceLinks,
  conversationArtifacts,
} from "./conversation-artifact-view-model";
import { clearInvalidConversationArtifactAnchor } from "./conversation-artifact-anchor";
import {
  conversationCitationLinks,
  conversationCitations,
} from "./conversation-citation-view-model";
import { conversationBrowserActivities } from "./conversation-browser-activity-view-model";
import { conversationNetworkActivities } from "./conversation-network-activity-view-model";
import {
  conversationPlanEventId,
  conversationPlans,
} from "./conversation-plan-view-model";
import { conversationRecoveries } from "./conversation-recovery-view-model";
import {
  conversationSubagentEventId,
  conversationSubagents,
} from "./conversation-subagent-view-model";
import { conversationToolActivities } from "./conversation-tool-activity-view-model";
import { copy } from "./copy";
import {
  conversationActivities,
  conversationActivitiesFromCandidates,
  excludeConversationActivityCandidates,
  type ConversationActivity,
} from "./conversation-activity-view-model";
import { ConversationArtifactCard } from "./ConversationArtifactCard";
import { ConversationActivityGroupCard } from "./ConversationActivityGroupCard";
import { ConversationApprovalCard } from "./ConversationApprovalCard";
import { ConversationCitationCard } from "./ConversationCitationCard";
import { ConversationBrowserActivityCard } from "./ConversationBrowserActivityCard";
import { ConversationNetworkActivityCard } from "./ConversationNetworkActivityCard";
import { ConversationPlanCard } from "./ConversationPlanCard";
import { ConversationRecoveryCard } from "./ConversationRecoveryCard";
import { ConversationSubagentCard } from "./ConversationSubagentCard";
import { ConversationToolActivityCard } from "./ConversationToolActivityCard";
import {
  MessageMarkdown,
  type MessageCitationLink,
  type MessageWorkspaceLink,
} from "./message-markdown";
import type { MessageView } from "./use-workspace-view-model";
import {
  groupConversationFeed,
  type ConversationFeedItem,
} from "./conversation-feed-grouping";

export function ConversationLedger({
  messages,
  detail,
  streamingText,
  endRef,
  onBranch,
  onLedgerChanged,
}: {
  messages: MessageView[];
  detail: WebThreadDetail | undefined;
  streamingText: string;
  endRef: React.RefObject<HTMLDivElement | null>;
  onBranch: (seq: number) => void;
  onLedgerChanged: () => Promise<void>;
}) {
  const events = detail?.events ?? [];
  const activitySource = detail?.activityEvents ?? events;
  const plans = detail?.plans ?? [];
  const runs = detail?.runs ?? [];
  const artifacts =
    detail?.artifacts ?? conversationArtifacts(events, plans, 6, runs);
  const artifactAnchorIds = artifacts.map(conversationArtifactTargetId);
  const artifactAnchorKey = artifactAnchorIds.join("|");
  useEffect(() => {
    const validate = () =>
      clearInvalidConversationArtifactAnchor(new Set(artifactAnchorIds));
    validate();
    window.addEventListener("hashchange", validate);
    return () => window.removeEventListener("hashchange", validate);
  }, [artifactAnchorKey]);
  const artifactKeys = new Set(
    artifacts.map((item) => `${item.planId}:${item.artifact.id}`),
  );
  const workspaceLinks: MessageWorkspaceLink[] =
    conversationArtifactWorkspaceLinks(artifacts);
  const citations = detail?.citations ?? conversationCitations(events);
  const citationLinks: MessageCitationLink[] =
    conversationCitationLinks(citations);
  const citationEventIds = new Set(citations.map((citation) => citation.id));
  const citationCallIds = new Set(citations.map((citation) => citation.callId));
  const networkActivities = conversationNetworkActivities(
    activitySource,
    activitySource.length,
  );
  const networkCallIds = new Set(
    networkActivities.map((activity) => activity.callId),
  );
  const browserActivities = conversationBrowserActivities(
    activitySource,
    activitySource.length,
  );
  const browserCallIds = new Set(
    browserActivities.map((activity) => activity.callId),
  );
  const toolItems = conversationToolActivities(
    activitySource,
    new Set([...citationCallIds, ...networkCallIds, ...browserCallIds]),
    activitySource.length,
  );
  const toolEventIds = new Set(
    toolItems.flatMap((activity) => activity.eventIds),
  );
  const planItems =
    detail?.conversationPlans ??
    conversationPlans(events, plans, 4, runs, detail?.activePlan);
  const planIds = new Set(planItems.map((item) => item.plan.id));
  const approvals = conversationApprovals(detail?.operatorDecisions ?? []);
  const approvalIds = new Set(
    approvals.map((approval) => approval.decision.id),
  );
  const subagentItems =
    detail?.subagentCards ??
    conversationSubagents(events, detail?.subagents ?? []);
  const subagentIds = new Set(
    subagentItems.map((subagent) => subagent.task.id),
  );
  const recoveryItems =
    detail?.recoveries ??
    conversationRecoveries(
      events,
      detail?.automaticRecoveryAssessments ?? [],
      detail?.automaticRecoveryAttempts ?? [],
    );
  const recoveryEventIds = new Set(
    recoveryItems.flatMap((recovery) => recovery.eventIds),
  );
  const excludedEventIds = new Set([
    ...citationEventIds,
    ...recoveryEventIds,
    ...toolEventIds,
  ]);
  const excludedCallIds = new Set([...networkCallIds, ...browserCallIds]);
  const genericActivities = detail?.activityCandidates
    ? conversationActivitiesFromCandidates(
        excludeConversationActivityCandidates(detail.activityCandidates, {
          eventIds: excludedEventIds,
          callIds: excludedCallIds,
          planIds,
          decisionIds: approvalIds,
          taskIds: subagentIds,
          artifactKeys,
        }),
      )
    : conversationActivities(
        events.filter((event) =>
          includeLegacyActivity(event, {
            excludedEventIds,
            excludedCallIds,
            planIds,
            approvalIds,
            subagentIds,
            artifactKeys,
          }),
        ),
      );
  const feed = groupConversationFeed(
    [
      ...messages.map((message) => ({
        kind: "message" as const,
        seq: message.seq,
        message,
      })),
      ...genericActivities.map((activity) => ({
        kind: "activity" as const,
        seq: activity.seq,
        activity,
      })),
      ...artifacts.map((artifact) => ({
        kind: "artifact" as const,
        seq: artifact.seq,
        artifact,
      })),
      ...citations.map((citation) => ({
        kind: "citation" as const,
        seq: citation.seq,
        citation,
      })),
      ...networkActivities.map((activity) => ({
        kind: "network" as const,
        seq: activity.seq,
        activity,
      })),
      ...browserActivities.map((activity) => ({
        kind: "browser" as const,
        seq: activity.seq,
        activity,
      })),
      ...planItems.map((plan) => ({
        kind: "plan" as const,
        seq: plan.seq,
        plan,
      })),
      ...approvals.map((approval) => ({
        kind: "approval" as const,
        seq: approval.seq,
        approval,
      })),
      ...subagentItems.map((subagent) => ({
        kind: "subagent" as const,
        seq: subagent.seq,
        subagent,
      })),
      ...recoveryItems.map((recovery) => ({
        kind: "recovery" as const,
        seq: recovery.seq,
        recovery,
      })),
      ...toolItems.map((activity) => ({
        kind: "tool" as const,
        seq: activity.seq,
        activity,
      })),
    ].sort((left, right) => left.seq - right.seq) as ConversationFeedItem[],
  );

  return (
    <div className="message-ledger">
      {feed.map((item) =>
        item.kind === "activity-group" ? (
          <ConversationActivityGroupCard key={item.id} group={item} />
        ) : item.kind === "message" ? (
          <MessageCard
            key={`message-${item.message.id}`}
            message={item.message}
            workspaceLinks={workspaceLinks}
            citationLinks={citationLinks}
            {...(item.message.role === "assistant"
              ? { onBranch: () => onBranch(item.message.seq) }
              : {})}
          />
        ) : item.kind === "activity" ? (
          <ActivityCard
            key={`activity-${item.activity.id}`}
            activity={item.activity}
          />
        ) : item.kind === "artifact" ? (
          <ConversationArtifactCard
            key={`artifact-${item.artifact.planId}-${item.artifact.artifact.id}`}
            item={item.artifact}
            threadId={item.artifact.threadId}
            onLedgerChanged={onLedgerChanged}
          />
        ) : item.kind === "citation" ? (
          <ConversationCitationCard
            key={`citation-${item.citation.citationId}`}
            citation={item.citation}
            index={
              citationLinks.find(
                (link) => link.citationId === item.citation.citationId,
              )?.index ?? 1
            }
          />
        ) : item.kind === "network" ? (
          <ConversationNetworkActivityCard
            key={`network-${item.activity.callId}`}
            activity={item.activity}
          />
        ) : item.kind === "browser" ? (
          <ConversationBrowserActivityCard
            key={`browser-${item.activity.callId}`}
            activity={item.activity}
          />
        ) : item.kind === "plan" ? (
          <ConversationPlanCard
            key={`plan-${item.plan.plan.id}`}
            item={item.plan}
          />
        ) : item.kind === "approval" ? (
          <ConversationApprovalCard
            key={`approval-${item.approval.decision.id}`}
            approval={item.approval}
          />
        ) : item.kind === "subagent" ? (
          <ConversationSubagentCard
            key={`subagent-${item.subagent.task.id}`}
            item={item.subagent}
          />
        ) : item.kind === "recovery" ? (
          <ConversationRecoveryCard
            key={`recovery-${item.recovery.id}`}
            item={item.recovery}
          />
        ) : (
          <ConversationToolActivityCard
            key={`tool-${item.activity.callId}`}
            activity={item.activity}
          />
        ),
      )}
      {streamingText ? (
        <StreamingCard
          text={streamingText}
          workspaceLinks={workspaceLinks}
          citationLinks={citationLinks}
        />
      ) : null}
      <div ref={endRef} />
    </div>
  );
}

export default ConversationLedger;

function ActivityCard({ activity }: { activity: ConversationActivity }) {
  const Icon =
    activity.tone === "completed"
      ? CheckCircle2
      : activity.tone === "blocked"
        ? AlertTriangle
        : activity.tone === "waiting"
          ? Clock3
          : Activity;
  return (
    <details className={`activity-card tone-${activity.tone}`}>
      <summary>
        <Icon size={13} aria-hidden="true" />
        <span>{activity.label}</span>
        <strong>{activity.summary}</strong>
        {activity.count > 1 ? <small>×{activity.count}</small> : null}
        <time dateTime={activity.createdAt}>
          {formatTime(activity.createdAt)}
        </time>
      </summary>
      <code>{activity.type}</code>
    </details>
  );
}

function MessageCard({
  message,
  onBranch,
  workspaceLinks,
  citationLinks,
}: {
  message: MessageView;
  onBranch?: () => void;
  workspaceLinks: readonly MessageWorkspaceLink[];
  citationLinks: readonly MessageCitationLink[];
}) {
  return (
    <article className={`message-card role-${message.role}`}>
      <div className="message-gutter">
        <span>{String(message.seq).padStart(3, "0")}</span>
        <i />
      </div>
      <div className="message-content">
        <header>
          <span>{message.role === "user" ? "Operator" : "Napier"}</span>
          <time dateTime={message.createdAt}>
            {formatTime(message.createdAt)}
          </time>
          {message.model ? <small>{message.model}</small> : null}
        </header>
        <div className="message-text">
          <MessageMarkdown
            text={message.text}
            workspaceLinks={workspaceLinks}
            citationLinks={citationLinks}
          />
        </div>
        {onBranch ? (
          <button className="branch-action" type="button" onClick={onBranch}>
            <GitBranch size={13} aria-hidden="true" />
            {copy.branch}
          </button>
        ) : null}
      </div>
    </article>
  );
}

function StreamingCard({
  text,
  workspaceLinks,
  citationLinks,
}: {
  text: string;
  workspaceLinks: readonly MessageWorkspaceLink[];
  citationLinks: readonly MessageCitationLink[];
}) {
  return (
    <article
      className="message-card role-assistant is-streaming"
      aria-live="polite"
    >
      <div className="message-gutter">
        <span>•••</span>
        <i />
      </div>
      <div className="message-content">
        <header>
          <span>Napier</span>
          <small>{copy.running}</small>
        </header>
        <div className="message-text">
          <MessageMarkdown
            text={text}
            workspaceLinks={workspaceLinks}
            citationLinks={citationLinks}
          />
          <span className="ink-caret" aria-hidden="true" />
        </div>
      </div>
    </article>
  );
}

function eventCallId(event: RunEvent): string | undefined {
  if (
    !event.payload ||
    typeof event.payload !== "object" ||
    Array.isArray(event.payload)
  ) {
    return undefined;
  }
  const callId = event.payload["callId"];
  return typeof callId === "string" ? callId : undefined;
}

function includeLegacyActivity(
  event: RunEvent,
  exclusions: {
    excludedEventIds: ReadonlySet<string>;
    excludedCallIds: ReadonlySet<string>;
    planIds: ReadonlySet<string>;
    approvalIds: ReadonlySet<string>;
    subagentIds: ReadonlySet<string>;
    artifactKeys: ReadonlySet<string>;
  },
): boolean {
  const key = conversationArtifactEventKey(event);
  const callId = eventCallId(event);
  const planId = conversationPlanEventId(event);
  const approvalId = conversationApprovalEventId(event);
  const subagentId = conversationSubagentEventId(event);
  return (
    !exclusions.excludedEventIds.has(event.id) &&
    (!callId || !exclusions.excludedCallIds.has(callId)) &&
    (!planId || !exclusions.planIds.has(planId)) &&
    (!approvalId || !exclusions.approvalIds.has(approvalId)) &&
    (!subagentId || !exclusions.subagentIds.has(subagentId)) &&
    (!key || !exclusions.artifactKeys.has(`${key[0]}:${key[1]}`))
  );
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
