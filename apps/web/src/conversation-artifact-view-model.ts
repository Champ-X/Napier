import type {
  ArtifactManifestEntry,
  ExecutionPlan,
  RunEvent,
  RunRecord,
} from "@napier/contracts";
import {
  currentRunAttempt,
  projectRunIntentIds,
  runIdsBelongToCurrentAttempt,
} from "./run-intent-id";
import { conversationArtifactAnchorId } from "./conversation-artifact-anchor";

export interface ConversationArtifact {
  id: string;
  seq: number;
  createdAt: string;
  attemptScope: "current" | "previous";
  threadId: string;
  runId: string;
  planId: string;
  planRevision: number;
  artifact: ArtifactManifestEntry;
}

export interface ConversationArtifactWorkspaceLink {
  path: string;
  targetId: string;
}

const ARTIFACT_STATUS_EVENT =
  /^plan\.artifact\.(candidate|produced|verified|missing|superseded)$/u;

export function conversationArtifacts(
  events: RunEvent[],
  plans: ExecutionPlan[],
  limit = 6,
  runs: RunRecord[] = [],
): ConversationArtifact[] {
  const intentIds = projectRunIntentIds(events);
  const current = currentRunAttempt(runs, events, intentIds);
  const plansById = new Map(plans.map((plan) => [plan.id, plan]));
  const latestByArtifact = new Map<string, ConversationArtifact>();
  for (const event of events) {
    const key = conversationArtifactEventKey(event);
    if (!key) continue;
    const [planId, artifactId] = key;
    const plan = plansById.get(planId);
    const artifact = plan?.artifacts.find(
      (candidate) => candidate.id === artifactId,
    );
    if (!plan || !artifact) continue;
    latestByArtifact.set(`${planId}:${artifactId}`, {
      id: event.id,
      seq: event.seq,
      createdAt: event.createdAt,
      attemptScope: runIdsBelongToCurrentAttempt(
        [event.runId, ...(artifact.sourceRunId ? [artifact.sourceRunId] : [])],
        current,
        intentIds,
      )
        ? "current"
        : "previous",
      threadId: plan.threadId,
      runId: event.runId,
      planId,
      planRevision: plan.revision,
      artifact,
    });
  }
  return [...latestByArtifact.values()]
    .sort((left, right) => left.seq - right.seq)
    .slice(-limit);
}

export function conversationArtifactEventKey(
  event: RunEvent,
): readonly [planId: string, artifactId: string] | undefined {
  if (event.visibility !== "user" || !ARTIFACT_STATUS_EVENT.test(event.type)) {
    return undefined;
  }
  const planId = payloadString(event.payload, "planId");
  const artifactId = payloadString(event.payload, "artifactId");
  return planId && artifactId ? [planId, artifactId] : undefined;
}

export function conversationArtifactWorkspaceLinks(
  artifacts: readonly ConversationArtifact[],
): ConversationArtifactWorkspaceLink[] {
  return artifacts.flatMap((item) =>
    item.artifact.kind === "file" &&
    (item.artifact.status === "produced" || item.artifact.status === "verified")
      ? [
          {
            path: item.artifact.path,
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

function payloadString(value: unknown, key: string): string | undefined {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return undefined;
  }
  const entry = (value as Record<string, unknown>)[key];
  return typeof entry === "string" ? entry : undefined;
}
