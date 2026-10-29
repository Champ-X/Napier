import type {
  ArtifactManifestEntry,
  ExecutionPlan,
  RunEvent,
  RunRecord,
  ThreadDetail,
} from "@napier/contracts";
import {
  applyConversationArtifactEvent,
  createConversationArtifactEventState,
  projectConversationArtifacts,
  taskArtifactBinding,
  type ConversationArtifact,
} from "@napier/contracts/task-narrative";
import { conversationArtifactAnchorId } from "./conversation-artifact-anchor";
import { currentRunAttempt, projectRunIntentIds, runIdsBelongToCurrentAttempt } from "./run-intent-id";
export { conversationArtifactEventKey, type ConversationArtifact } from "@napier/contracts/task-narrative";

export interface ConversationArtifactWorkspaceLink {
  artifact: ArtifactManifestEntry;
  path: string;
  planId: string;
  planRevision: number;
  threadId: string;
  targetId: string;
}

export function conversationArtifacts(
  events: RunEvent[],
  plans: ExecutionPlan[],
  limit = 6,
  runs: RunRecord[] = [],
): ConversationArtifact[] {
  return projectConversationArtifacts(plans, runs,
    events.reduce(applyConversationArtifactEvent, createConversationArtifactEventState()), limit);
}

/** A late/legacy server projection cannot attach current bytes to an old event. */
export function currentConversationArtifacts(input: {
  events: RunEvent[];
  plans: ExecutionPlan[];
  runs: RunRecord[];
  projected?: ConversationArtifact[];
  deliverables?: NonNullable<ThreadDetail["taskNarrative"]>["deliverables"];
}): ConversationArtifact[] {
  let replay: ConversationArtifact[] | undefined;
  const replayed = () => replay ??= conversationArtifacts(input.events, input.plans, 6, input.runs);
  if (!input.projected) return replayed();
  const orderedEvents = input.events.toSorted((left, right) => left.seq - right.seq);
  const intentIds = projectRunIntentIds(orderedEvents);
  const current = currentRunAttempt(input.runs, orderedEvents, intentIds);
  return input.projected.filter((item) => {
    const plan = input.plans.find((value) => value.id === item.planId && value.threadId === item.threadId);
    const artifact = plan?.artifacts.find((value) => value.id === item.artifact.id);
    if (!plan || !artifact || selectionBinding(item.planId, item.planRevision, item.artifact) !==
        selectionBinding(plan.id, plan.revision, artifact)) return false;
    const entry = input.deliverables?.find((value) => value.planId === item.planId && value.artifact.id === item.artifact.id);
    if (!entry?.history || !entry.currentVersion?.eventRunId || !entry.currentVersion.eventCreatedAt)
      return replayed().some((value) => value.id === item.id &&
      value.seq === item.seq && value.runId === item.runId && value.planId === item.planId &&
      value.planRevision === item.planRevision && value.createdAt === item.createdAt);
    const version = entry.currentVersion;
    return version?.source === "recorded_assertion" && version.eventId === item.id &&
      version.eventSeq === item.seq && version.planRevision === item.planRevision &&
      entry.sourceEventId === item.id && version.planId === item.planId &&
      version.eventRunId === item.runId && version.eventCreatedAt === item.createdAt &&
      version.artifactId === item.artifact.id && version.path === item.artifact.path &&
      version.sha256 === item.artifact.sha256 && version.sizeBytes === item.artifact.sizeBytes &&
      version.status === item.artifact.status && version.runId === item.artifact.sourceRunId &&
      (version.runId === undefined || version.runId === item.runId) &&
      taskArtifactBinding(entry) === selectionBinding(item.planId, item.planRevision, item.artifact);
  }).map((item) => ({ ...item, attemptScope: runIdsBelongToCurrentAttempt(
    [item.runId, ...(item.artifact.sourceRunId ? [item.artifact.sourceRunId] : [])], current, intentIds,
  ) ? "current" : "previous" }));
}

function selectionBinding(planId: string, planRevision: number, artifact: ArtifactManifestEntry): string {
  return taskArtifactBinding({ planId, planRevision, artifact, path: artifact.path,
    source: "plan", accessibility: "unchecked", verification: "unverified", previousVersions: [] });
}

export function conversationArtifactWorkspaceLinks(
  artifacts: readonly ConversationArtifact[],
): ConversationArtifactWorkspaceLink[] {
  return artifacts.flatMap((item) =>
    item.artifact.kind === "file" &&
    (item.artifact.status === "produced" || item.artifact.status === "verified")
      ? [
          {
            artifact: item.artifact,
            path: item.artifact.path,
            planId: item.planId,
            planRevision: item.planRevision,
            threadId: item.threadId,
            targetId: conversationArtifactTargetId(item),
          },
        ]
      : [],
  );
}

export function conversationArtifactTargetId(
  item: ConversationArtifact,
): string {
  return conversationArtifactAnchorId({
    threadId: item.threadId,
    runId: item.runId,
    planId: item.planId,
    artifactId: item.artifact.id,
    eventSeq: item.seq,
  });
}
