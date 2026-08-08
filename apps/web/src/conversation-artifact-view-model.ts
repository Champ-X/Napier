import type {
  ArtifactManifestEntry,
  ExecutionPlan,
  RunEvent,
} from "@napier/contracts";

export interface ConversationArtifact {
  id: string;
  seq: number;
  createdAt: string;
  threadId: string;
  planId: string;
  planRevision: number;
  artifact: ArtifactManifestEntry;
}

const ARTIFACT_STATUS_EVENT =
  /^plan\.artifact\.(produced|verified|missing|superseded)$/u;

export function conversationArtifacts(
  events: RunEvent[],
  plans: ExecutionPlan[],
  limit = 6,
): ConversationArtifact[] {
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
      threadId: plan.threadId,
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
  if (
    event.visibility !== "user" ||
    !ARTIFACT_STATUS_EVENT.test(event.type)
  ) {
    return undefined;
  }
  const planId = payloadString(event.payload, "planId");
  const artifactId = payloadString(event.payload, "artifactId");
  return planId && artifactId ? [planId, artifactId] : undefined;
}

function payloadString(value: unknown, key: string): string | undefined {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return undefined;
  }
  const entry = (value as Record<string, unknown>)[key];
  return typeof entry === "string" ? entry : undefined;
}
