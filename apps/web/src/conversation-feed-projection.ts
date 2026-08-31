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
import { conversationBrowserActivities } from "./conversation-browser-activity-view-model";
import {
  conversationCitationLinks,
  conversationCitations,
} from "./conversation-citation-view-model";
import {
  conversationActivities,
  conversationActivitiesFromCandidates,
  excludeConversationActivityCandidates,
} from "./conversation-activity-view-model";
import {
  groupConversationFeed,
  type ConversationFeedEntry,
  type ConversationFeedItem,
} from "./conversation-feed-grouping";
import { conversationNetworkActivities } from "./conversation-network-activity-view-model";
import {
  conversationMilestones,
  type ConversationMilestone,
} from "./conversation-milestone-view-model";
import {
  conversationPlanEventId,
  conversationPlans,
} from "./conversation-plan-view-model";
import { conversationRecoveries } from "./conversation-recovery-view-model";
import { conversationProgressNotes } from "./conversation-progress-view-model";
import {
  conversationSubagentEventId,
  conversationSubagents,
} from "./conversation-subagent-view-model";
import {
  conversationToolActivities,
  type ConversationToolActivity,
} from "./conversation-tool-activity-view-model";
import {
  activeConversationThinkingActivity,
  conversationThinkingActivities,
} from "./conversation-thinking-view-model";
import {
  projectLocalToolDisplays,
  type LocalConversationToolDisplay,
} from "./conversation-tool-display-view-model";
import type {
  MessageCitationLink,
  MessageWorkspaceLink,
} from "./message-markdown";
import type { MessageView } from "./use-workspace-view-model";

export interface ConversationFeedProjection {
  activeThinkingId?: string;
  artifactAnchorIds: string[];
  citationLinks: MessageCitationLink[];
  feed: ConversationFeedEntry[];
  workspaceLinks: MessageWorkspaceLink[];
}

export function conversationFeedProjection(
  messages: readonly MessageView[],
  detail: WebThreadDetail | undefined,
  toolDisplays: readonly LocalConversationToolDisplay[] = [],
): ConversationFeedProjection {
  const events = projectLocalToolDisplays(detail?.events ?? [], toolDisplays);
  const activitySource = projectLocalToolDisplays(
    detail?.activityEvents ?? events,
    toolDisplays,
  );
  const plans = detail?.plans ?? [];
  const runs = detail?.runs ?? [];
  const artifacts =
    detail?.artifacts ?? conversationArtifacts(events, plans, 6, runs);
  const artifactAnchorIds = artifacts.map(conversationArtifactTargetId);
  const artifactKeys = new Set(
    artifacts.map((item) => `${item.planId}:${item.artifact.id}`),
  );
  const workspaceLinks = conversationArtifactWorkspaceLinks(artifacts);
  const citations = detail?.citations ?? conversationCitations(events);
  const retainedThinkingActivities = conversationThinkingActivities(events);
  const milestones = conversationMilestones(events);
  const progressNotes = conversationProgressNotes(events);
  const currentRunId = detail?.thread.currentRunId;
  const runIsActive = Boolean(
    currentRunId &&
      (detail?.thread.status === "running" ||
        runs.some((run) => run.id === currentRunId && run.status === "running")),
  );
  const activeThinking = activeConversationThinkingActivity(
    events,
    currentRunId,
    runIsActive,
    retainedThinkingActivities,
  );
  const activeThinkingId = activeThinking?.id;
  const thinkingActivities =
    activeThinking &&
    !retainedThinkingActivities.some(
      (activity) => activity.id === activeThinking.id,
    )
      ? [...retainedThinkingActivities, activeThinking]
      : retainedThinkingActivities;
  const citationLinks = conversationCitationLinks(citations);
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
  const projectedToolItems = conversationToolActivities(
    activitySource,
    new Set([...citationCallIds, ...networkCallIds, ...browserCallIds]),
    activitySource.length,
  );
  const toolEventIds = new Set(
    projectedToolItems.flatMap((activity) => activity.eventIds),
  );
  const toolItems = projectedToolItems.filter(
    (activity) =>
      activity.toolName !== "record_run_milestone" ||
      activity.status !== "completed" ||
      !activityRecordedMilestone(activity, milestones, events),
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
      ...thinkingActivities.map((activity) => ({
        kind: "thinking" as const,
        seq: activity.seq,
        activity,
      })),
      ...milestones.map((milestone) => ({
        kind: "milestone" as const,
        seq: milestone.seq,
        milestone,
      })),
      ...progressNotes.map((note) => ({
        kind: "progress" as const,
        seq: note.seq,
        note,
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
  return {
    ...(activeThinkingId ? { activeThinkingId } : {}),
    artifactAnchorIds,
    citationLinks,
    feed,
    workspaceLinks,
  };
}

function activityRecordedMilestone(
  activity: ConversationToolActivity,
  milestones: readonly ConversationMilestone[],
  events: readonly RunEvent[],
): boolean {
  const ids = new Set(activity.eventIds);
  const relatedEvents = events
    .filter((event) => ids.has(event.id))
    .sort((left, right) => left.seq - right.seq);
  const first = relatedEvents[0];
  const last = relatedEvents.at(-1);
  if (!first || !last || first.runId !== last.runId) return false;
  return milestones.some(
    (milestone) =>
      milestone.runId === first.runId &&
      milestone.seq > first.seq &&
      milestone.seq < last.seq,
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
  if (event.type === "run.progress.message") return false;
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
