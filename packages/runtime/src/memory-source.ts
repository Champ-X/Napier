import type { MemorySource } from "@napier/contracts";

const MAX_TEXT_CHARACTERS = 500;
const MAX_MESSAGE_IDS = 30;

export function normalizeMemorySource(source: MemorySource): MemorySource {
  const taskTitle = normalizeText(source.taskTitle);
  const persistenceReason = normalizeText(source.persistenceReason);
  const differenceSummary = normalizeText(source.differenceSummary);
  const messageIds = source.messageIds
    ? [...new Set(source.messageIds.filter(validSourceId))].slice(
        0,
        MAX_MESSAGE_IDS,
      )
    : undefined;
  const evidence = source.repositoryEvidence;
  const repositoryEvidence = evidence
    ? evidence.status === "linked" &&
      validSourceId(evidence.eventId) &&
      Number.isSafeInteger(evidence.eventSeq) &&
      evidence.eventSeq! > 0 &&
      /^[a-f0-9]{64}$/u.test(evidence.workspaceSnapshotSha256 ?? "") &&
      validIsoTimestamp(evidence.capturedAt)
      ? {
          status: "linked" as const,
          eventId: evidence.eventId,
          eventSeq: evidence.eventSeq,
          workspaceSnapshotSha256: evidence.workspaceSnapshotSha256,
          capturedAt: evidence.capturedAt,
        }
      : { status: "unavailable" as const }
    : undefined;
  return {
    type: source.type,
    ...(source.threadId ? { threadId: source.threadId } : {}),
    ...(source.runId ? { runId: source.runId } : {}),
    ...(taskTitle ? { taskTitle } : {}),
    ...(messageIds?.length ? { messageIds } : {}),
    ...(persistenceReason ? { persistenceReason } : {}),
    ...(differenceSummary ? { differenceSummary } : {}),
    ...(repositoryEvidence ? { repositoryEvidence } : {}),
  };
}

function normalizeText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > MAX_TEXT_CHARACTERS) {
    throw new Error(
      `Memory provenance text must be 1-${MAX_TEXT_CHARACTERS} characters`,
    );
  }
  return normalized;
}

function validSourceId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9_]{2,100}$/u.test(value);
}

function validIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
