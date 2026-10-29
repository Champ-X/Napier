import type { RunEvent } from "./execution-core.js";
import type { RunRecord } from "./execution-runs.js";
import type { ExecutionPlan } from "./execution-plan-v1.js";
import type { ThreadDetail } from "./workspace-bootstrap-v1.js";
import { latestPrimaryRun } from "./primary-run-selection.js";
import {
  taskArtifactHistory,
  taskArtifactHistoryEvent,
  type TaskArtifactHistoryEvent,
} from "./task-artifact-history.js";

export type ConversationArtifact = NonNullable<ThreadDetail["artifacts"]>[number];

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
  history: Record<string, TaskArtifactHistoryEvent[]>;
  intentIds: Record<string, string>;
  runEvents: Record<string, { seq: number; child: boolean }>;
}

const ARTIFACT_EVENT = /^plan\.artifact\.(candidate|produced|verified|missing|superseded)$/u;
const INTENT_ID = /^intent_[a-z0-9]{8,80}$/u;

export function createConversationArtifactEventState(): ConversationArtifactEventState {
  return { latest: {}, history: {}, intentIds: {}, runEvents: {} };
}

/** Cache recorded assertions only. The current plan is bound again at read time. */
export function applyConversationArtifactEvent(
  state: ConversationArtifactEventState,
  event: RunEvent,
): ConversationArtifactEventState {
  const prior = state.runEvents[event.runId];
  const payload = event.payload && typeof event.payload === "object" &&
    !Array.isArray(event.payload) ? event.payload : undefined;
  const next = {
    ...state,
    runEvents: { ...state.runEvents, [event.runId]: {
      seq: Math.max(prior?.seq ?? 0, event.seq),
      child: prior?.child === true ||
        (event.type === "run.started" && payload?.["source"] === "subagent"),
    } },
  };
  const intentId = payload?.["intentId"];
  if (event.type === "run.started" && typeof intentId === "string" && INTENT_ID.test(intentId))
    next.intentIds = { ...state.intentIds, [event.runId]: intentId };
  const key = conversationArtifactEventKey(event);
  if (!key) return next;
  const [planId, artifactId] = key;
  const identity = JSON.stringify(key);
  const history = taskArtifactHistoryEvent(event);
  if (history && !(next.history[identity] ?? []).some((entry) => entry.eventId === event.id))
    next.history = { ...state.history, [identity]: [...(state.history[identity] ?? []), history] };
  if ((next.latest[identity]?.seq ?? -1) >= event.seq) return next;
  next.latest = { ...state.latest, [identity]: {
    id: event.id, seq: event.seq, createdAt: event.createdAt,
    runId: event.runId, planId, artifactId,
  } };
  return next;
}

export function projectConversationArtifacts(
  plans: readonly ExecutionPlan[],
  runs: readonly RunRecord[],
  state: ConversationArtifactEventState,
  limit = 6,
): ConversationArtifact[] {
  const plansById = new Map(plans.map((plan) => [plan.id, plan]));
  const currentRunId = latestPrimaryRun(runs)?.id ?? (runs.length === 0
    ? Object.entries(state.runEvents).filter(([, entry]) => !entry.child)
      .sort(([, a], [, b]) => a.seq - b.seq).at(-1)?.[0]
    : undefined);
  const currentIntentId = currentRunId ? state.intentIds[currentRunId] : undefined;
  return Object.entries(state.latest)
    .flatMap(([identity, binding]): ConversationArtifact[] => {
      const plan = plansById.get(binding.planId);
      const artifact = plan?.artifacts.find((candidate) => candidate.id === binding.artifactId);
      if (!plan || !artifact) return [];
      const currentVersion = taskArtifactHistory(plan, artifact, state.history[identity] ?? []).currentVersion;
      // Never display new manifest bytes at an old or incomplete event's position.
      // Unbound current declarations remain available in Task deliverables/history.
      if (currentVersion?.eventId !== binding.id || currentVersion.eventSeq !== binding.seq) return [];
      const current = [binding.runId, ...(artifact.sourceRunId ? [artifact.sourceRunId] : [])]
        .some((runId) => runId === currentRunId ||
          (currentIntentId !== undefined && state.intentIds[runId] === currentIntentId));
      return [{
        id: binding.id, seq: binding.seq, createdAt: binding.createdAt,
        runId: binding.runId, planId: binding.planId,
        attemptScope: current ? "current" : "previous",
        threadId: plan.threadId, planRevision: plan.revision,
        artifact: structuredClone(artifact),
      }];
    })
    .sort((left, right) => left.seq - right.seq)
    .slice(-limit);
}

export function conversationArtifactEventKey(event: RunEvent): readonly [string, string] | undefined {
  if (event.visibility !== "user" || !ARTIFACT_EVENT.test(event.type) ||
      !event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) return;
  const planId = event.payload["planId"], artifactId = event.payload["artifactId"];
  return typeof planId === "string" && planId.length > 0 &&
    typeof artifactId === "string" && artifactId.length > 0 ? [planId, artifactId] : undefined;
}
