import type {
  ExecutionPlan,
  RunEvent,
  RunRecord,
  ThreadDetail,
} from "@napier/contracts";

import { projectRunIntents } from "./run-intents.js";

export type ConversationArtifact = NonNullable<
  ThreadDetail["artifacts"]
>[number];

interface ArtifactEventBinding {
  id: string;
  seq: number;
  createdAt: string;
  runId: string;
  planId: string;
  artifactId: string;
}

export interface ConversationArtifactEventState {
  latest: Record<string, ArtifactEventBinding>;
  intentIds: Record<string, string>;
  latestRunId?: string;
}

const ARTIFACT_EVENT =
  /^plan\.artifact\.(candidate|produced|verified|missing|superseded)$/u;

export function createConversationArtifactEventState(): ConversationArtifactEventState {
  return { latest: {}, intentIds: {} };
}

export function applyConversationArtifactEvent(
  state: ConversationArtifactEventState,
  event: RunEvent,
): ConversationArtifactEventState {
  const next = structuredClone(state);
  next.latestRunId = event.runId;
  const intentId = projectRunIntents([event]).get(event.runId);
  if (intentId) next.intentIds[event.runId] = intentId;
  const key = artifactEventKey(event);
  if (!key) return next;
  const [planId, artifactId] = key;
  next.latest[`${planId}:${artifactId}`] = {
    id: event.id,
    seq: event.seq,
    createdAt: event.createdAt,
    runId: event.runId,
    planId,
    artifactId,
  };
  return next;
}

export function projectConversationArtifacts(
  plans: readonly ExecutionPlan[],
  runs: readonly RunRecord[],
  state: ConversationArtifactEventState,
  limit = 6,
): ConversationArtifact[] {
  const plansById = new Map(plans.map((plan) => [plan.id, plan]));
  const currentRunId = runs.at(-1)?.id ?? state.latestRunId;
  const currentIntentId = currentRunId
    ? state.intentIds[currentRunId]
    : undefined;
  return Object.values(state.latest)
    .flatMap((binding): ConversationArtifact[] => {
      const plan = plansById.get(binding.planId);
      const artifact = plan?.artifacts.find(
        (candidate) => candidate.id === binding.artifactId,
      );
      if (!plan || !artifact) return [];
      const runIds = [
        binding.runId,
        ...(artifact.sourceRunId ? [artifact.sourceRunId] : []),
      ];
      const current = runIds.some(
        (runId) =>
          runId === currentRunId ||
          (currentIntentId !== undefined &&
            state.intentIds[runId] === currentIntentId),
      );
      return [
        {
          ...binding,
          attemptScope: current ? "current" : "previous",
          threadId: plan.threadId,
          planRevision: plan.revision,
          artifact: structuredClone(artifact),
        },
      ];
    })
    .sort((left, right) => left.seq - right.seq)
    .slice(-limit);
}

function artifactEventKey(
  event: RunEvent,
): readonly [string, string] | undefined {
  if (event.visibility !== "user" || !ARTIFACT_EVENT.test(event.type)) {
    return undefined;
  }
  if (
    !event.payload ||
    typeof event.payload !== "object" ||
    Array.isArray(event.payload)
  ) {
    return undefined;
  }
  const planId = event.payload["planId"];
  const artifactId = event.payload["artifactId"];
  return typeof planId === "string" && typeof artifactId === "string"
    ? [planId, artifactId]
    : undefined;
}
