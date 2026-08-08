import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  GitBranch,
} from "lucide-react";

import type { RunEvent } from "@napier/contracts";
import type { WebThreadDetail } from "./api";
import {
  conversationApprovalEventId,
  conversationApprovals,
  type ConversationApproval,
} from "./conversation-approval-view-model";
import {
  conversationArtifactEventKey,
  conversationArtifactWorkspaceLinks,
  conversationArtifacts,
  type ConversationArtifact,
} from "./conversation-artifact-view-model";
import {
  conversationCitationLinks,
  conversationCitations,
  type ConversationCitation,
} from "./conversation-citation-view-model";
import {
  conversationBrowserActivities,
  type ConversationBrowserActivity,
} from "./conversation-browser-activity-view-model";
import {
  conversationNetworkActivities,
  type ConversationNetworkActivity,
} from "./conversation-network-activity-view-model";
import {
  conversationPlanEventId,
  conversationPlans,
  type ConversationPlan,
} from "./conversation-plan-view-model";
import {
  conversationRecoveries,
  type ConversationRecovery,
} from "./conversation-recovery-view-model";
import {
  conversationSubagentEventId,
  conversationSubagents,
  type ConversationSubagent,
} from "./conversation-subagent-view-model";
import { copy } from "./copy";
import {
  conversationActivities,
  type ConversationActivity,
} from "./conversation-activity-view-model";
import { ConversationArtifactCard } from "./ConversationArtifactCard";
import { ConversationApprovalCard } from "./ConversationApprovalCard";
import { ConversationCitationCard } from "./ConversationCitationCard";
import { ConversationBrowserActivityCard } from "./ConversationBrowserActivityCard";
import { ConversationNetworkActivityCard } from "./ConversationNetworkActivityCard";
import { ConversationPlanCard } from "./ConversationPlanCard";
import { ConversationRecoveryCard } from "./ConversationRecoveryCard";
import { ConversationSubagentCard } from "./ConversationSubagentCard";
import {
  MessageMarkdown,
  type MessageCitationLink,
  type MessageWorkspaceLink,
} from "./message-markdown";
import type { MessageView } from "./use-workspace-view-model";

type FeedItem =
  | { kind: "message"; seq: number; message: MessageView }
  | { kind: "activity"; seq: number; activity: ConversationActivity }
  | { kind: "artifact"; seq: number; artifact: ConversationArtifact }
  | { kind: "citation"; seq: number; citation: ConversationCitation }
  | {
      kind: "network";
      seq: number;
      activity: ConversationNetworkActivity;
    }
  | {
      kind: "browser";
      seq: number;
      activity: ConversationBrowserActivity;
    }
  | {
      kind: "plan";
      seq: number;
      plan: ConversationPlan;
    }
  | {
      kind: "approval";
      seq: number;
      approval: ConversationApproval;
    }
  | {
      kind: "subagent";
      seq: number;
      subagent: ConversationSubagent;
    }
  | {
      kind: "recovery";
      seq: number;
      recovery: ConversationRecovery;
    };

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
  const plans = detail?.plans ?? [];
  const artifacts = conversationArtifacts(events, plans);
  const artifactKeys = new Set(
    artifacts.map((item) => `${item.planId}:${item.artifact.id}`),
  );
  const workspaceLinks: MessageWorkspaceLink[] =
    conversationArtifactWorkspaceLinks(artifacts);
  const citations = conversationCitations(events);
  const citationLinks: MessageCitationLink[] =
    conversationCitationLinks(citations);
  const citationEventIds = new Set(citations.map((citation) => citation.id));
  const networkActivities = conversationNetworkActivities(events);
  const networkCallIds = new Set(
    networkActivities.map((activity) => activity.callId),
  );
  const browserActivities = conversationBrowserActivities(events);
  const browserCallIds = new Set(
    browserActivities.map((activity) => activity.callId),
  );
  const planItems = conversationPlans(events, plans);
  const planIds = new Set(planItems.map((item) => item.plan.id));
  const approvals = conversationApprovals(detail?.operatorDecisions ?? []);
  const approvalIds = new Set(
    approvals.map((approval) => approval.decision.id),
  );
  const subagentItems = conversationSubagents(events, detail?.subagents ?? []);
  const subagentIds = new Set(
    subagentItems.map((subagent) => subagent.task.id),
  );
  const recoveryItems = conversationRecoveries(
    events,
    detail?.automaticRecoveryAssessments ?? [],
    detail?.automaticRecoveryAttempts ?? [],
  );
  const recoveryEventIds = new Set(
    recoveryItems.flatMap((recovery) => recovery.eventIds),
  );
  const activityEvents = events.filter((event) => {
    const key = conversationArtifactEventKey(event);
    const callId = eventCallId(event);
    const planId = conversationPlanEventId(event);
    const approvalId = conversationApprovalEventId(event);
    const subagentId = conversationSubagentEventId(event);
    return (
      !citationEventIds.has(event.id) &&
      !recoveryEventIds.has(event.id) &&
      (!callId || !networkCallIds.has(callId)) &&
      (!callId || !browserCallIds.has(callId)) &&
      (!planId || !planIds.has(planId)) &&
      (!approvalId || !approvalIds.has(approvalId)) &&
      (!subagentId || !subagentIds.has(subagentId)) &&
      (!key || !artifactKeys.has(`${key[0]}:${key[1]}`))
    );
  });
  const feed: FeedItem[] = [
    ...messages.map((message) => ({
      kind: "message" as const,
      seq: message.seq,
      message,
    })),
    ...conversationActivities(activityEvents).map((activity) => ({
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
  ].sort((left, right) => left.seq - right.seq);

  return (
    <div className="message-ledger">
      {feed.map((item) =>
        item.kind === "message" ? (
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
        ) : (
          <ConversationRecoveryCard
            key={`recovery-${item.recovery.id}`}
            item={item.recovery}
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

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
