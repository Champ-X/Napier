import type {
  ExecutionPlanBlueprintRecordReplayEventVerification,
  ExecutionPlanBlueprintRecordReplayHistory,
  ExecutionPlanBlueprintRecordReplayHistoryVerification,
  ExecutionPlanBlueprintRecordReplayOutcomes,
  ExecutionPlanBlueprintRecordReplayOutcomesVerification,
  RunEvent,
  VerifyExecutionPlanBlueprintRecordReplayEventRequest,
} from "@napier/contracts";

import { executionPlanBlueprintRecordReplayFromEvent } from "./execution-plan-blueprint-replay-projection.js";
import {
  storeCanonicalJson as canonicalJson,
  storeSha256 as sha256,
} from "./store-hashing.js";

export function verifyExecutionPlanBlueprintRecordReplayOutcomesProjection(
  input: unknown,
  expectedRecordId: string,
  observed: ExecutionPlanBlueprintRecordReplayOutcomes,
): ExecutionPlanBlueprintRecordReplayOutcomesVerification {
  const diagnostics: string[] = [];
  const declared = readOutcomesDeclaration(input, diagnostics);
  pushDiagnostic(
    diagnostics,
    declared.record?.["kind"] !==
      "napier.execution-plan-blueprint-replay-outcomes",
    "kind_mismatch",
  );
  pushDiagnostic(
    diagnostics,
    declared.record?.["schemaVersion"] !== 1,
    "schema_mismatch",
  );
  pushDiagnostic(
    diagnostics,
    declared.recordId !== expectedRecordId,
    "record_mismatch",
  );
  pushDiagnostic(diagnostics, !declared.contentSha256, "content_hash_missing");
  pushOutcomesHashDiagnostics(diagnostics, declared, observed);
  pushOutcomesCountDiagnostics(diagnostics, declared, observed);
  const status: ExecutionPlanBlueprintRecordReplayOutcomesVerification["status"] =
    diagnostics.length === 0 ? "valid" : "invalid";
  const verificationContent = {
    schemaVersion: 1 as const,
    status,
    diagnostics,
    expectedRecordId,
    observedContentSha256: observed.contentSha256,
    observedReplayHistorySha256: observed.replayHistorySha256,
    observedOutcomeSetSha256: observed.outcomeSetSha256,
    observedReplayCount: observed.replayCount,
    observedCompletedCount: observed.completedCount,
    observedBlockedCount: observed.blockedCount,
    observedInvalidCount: observed.invalidCount,
    ...definedProperties({
      recordId: declared.recordId || undefined,
      declaredContentSha256: declared.contentSha256,
      recomputedContentSha256: declared.recomputedContentSha256,
      declaredReplayHistorySha256: declared.replayHistorySha256,
      declaredOutcomeSetSha256: declared.outcomeSetSha256,
      replayCount: declared.replayCount,
      completedCount: declared.completedCount,
      blockedCount: declared.blockedCount,
      invalidCount: declared.invalidCount,
    }),
  };
  return {
    ...verificationContent,
    contentSha256: sha256(canonicalJson(verificationContent)),
  };
}

export function verifyExecutionPlanBlueprintRecordReplayHistoryProjection(
  input: unknown,
  expectedRecordId: string,
  observed: ExecutionPlanBlueprintRecordReplayHistory,
): ExecutionPlanBlueprintRecordReplayHistoryVerification {
  const diagnostics: string[] = [];
  const declared = readHistoryDeclaration(input, diagnostics);
  pushDiagnostic(
    diagnostics,
    declared.record?.["kind"] !==
      "napier.execution-plan-blueprint-replay-history",
    "kind_mismatch",
  );
  pushDiagnostic(
    diagnostics,
    declared.record?.["schemaVersion"] !== 1,
    "schema_mismatch",
  );
  pushDiagnostic(
    diagnostics,
    declared.recordId !== expectedRecordId,
    "record_mismatch",
  );
  pushDiagnostic(diagnostics, !declared.contentSha256, "content_hash_missing");
  pushHistoryHashDiagnostics(diagnostics, declared, observed);
  pushHistoryCountDiagnostics(diagnostics, declared, observed);
  const status: ExecutionPlanBlueprintRecordReplayHistoryVerification["status"] =
    diagnostics.length === 0 ? "valid" : "invalid";
  const verificationContent = {
    schemaVersion: 1 as const,
    status,
    diagnostics,
    expectedRecordId,
    observedContentSha256: observed.contentSha256,
    observedEventSetSha256: observed.eventSetSha256,
    observedReplayCount: observed.replayCount,
    observedThreadCount: observed.threadCount,
    observedPlanCount: observed.planCount,
    ...definedProperties({
      recordId: declared.recordId || undefined,
      declaredContentSha256: declared.contentSha256,
      recomputedContentSha256: declared.recomputedContentSha256,
      declaredEventSetSha256: declared.eventSetSha256,
      replayCount: declared.replayCount,
      threadCount: declared.threadCount,
      planCount: declared.planCount,
      firstSeq: declared.firstSeq,
      observedFirstSeq: observed.firstSeq,
      lastSeq: declared.lastSeq,
      observedLastSeq: observed.lastSeq,
    }),
  };
  return {
    ...verificationContent,
    contentSha256: sha256(canonicalJson(verificationContent)),
  };
}

interface ReplayOutcomesDeclaration {
  record: Record<string, unknown> | undefined;
  recordId: string | undefined;
  contentSha256: string | undefined;
  recomputedContentSha256: string | undefined;
  replayHistorySha256: string | undefined;
  outcomeSetSha256: string | undefined;
  replayCount: number | undefined;
  completedCount: number | undefined;
  blockedCount: number | undefined;
  invalidCount: number | undefined;
}

interface ReplayHistoryDeclaration {
  record: Record<string, unknown> | undefined;
  recordId: string | undefined;
  contentSha256: string | undefined;
  recomputedContentSha256: string | undefined;
  eventSetSha256: string | undefined;
  replayCount: number | undefined;
  threadCount: number | undefined;
  planCount: number | undefined;
  firstSeq: number | undefined;
  lastSeq: number | undefined;
}

function readOutcomesDeclaration(
  input: unknown,
  diagnostics: string[],
): ReplayOutcomesDeclaration {
  const record = isRecord(input) ? input : undefined;
  pushDiagnostic(diagnostics, !record, "outcomes_not_object");
  return {
    record,
    recordId: stringValue(record?.["recordId"]),
    contentSha256: sha256Value(record?.["contentSha256"]),
    recomputedContentSha256: recomputedHash(record),
    replayHistorySha256: sha256Value(record?.["replayHistorySha256"]),
    outcomeSetSha256: sha256Value(record?.["outcomeSetSha256"]),
    replayCount: nonNegativeInteger(record?.["replayCount"]),
    completedCount: nonNegativeInteger(record?.["completedCount"]),
    blockedCount: nonNegativeInteger(record?.["blockedCount"]),
    invalidCount: nonNegativeInteger(record?.["invalidCount"]),
  };
}

function readHistoryDeclaration(
  input: unknown,
  diagnostics: string[],
): ReplayHistoryDeclaration {
  const record = isRecord(input) ? input : undefined;
  pushDiagnostic(diagnostics, !record, "history_not_object");
  return {
    record,
    recordId: stringValue(record?.["recordId"]),
    contentSha256: sha256Value(record?.["contentSha256"]),
    recomputedContentSha256: recomputedHash(record),
    eventSetSha256: sha256Value(record?.["eventSetSha256"]),
    replayCount: nonNegativeInteger(record?.["replayCount"]),
    threadCount: nonNegativeInteger(record?.["threadCount"]),
    planCount: nonNegativeInteger(record?.["planCount"]),
    firstSeq: nonNegativeInteger(record?.["firstSeq"]),
    lastSeq: nonNegativeInteger(record?.["lastSeq"]),
  };
}

function pushOutcomesHashDiagnostics(
  diagnostics: string[],
  declared: ReplayOutcomesDeclaration,
  observed: ExecutionPlanBlueprintRecordReplayOutcomes,
): void {
  pushDiagnostic(
    diagnostics,
    Boolean(
      declared.contentSha256 &&
      declared.recomputedContentSha256 &&
      declared.contentSha256 !== declared.recomputedContentSha256,
    ),
    "content_hash_mismatch",
  );
  pushDiagnostic(
    diagnostics,
    Boolean(
      declared.contentSha256 &&
      declared.contentSha256 !== observed.contentSha256,
    ),
    "current_outcomes_mismatch",
  );
  pushDiagnostic(
    diagnostics,
    declared.replayHistorySha256 !== observed.replayHistorySha256,
    "replay_history_mismatch",
  );
  pushDiagnostic(
    diagnostics,
    declared.outcomeSetSha256 !== observed.outcomeSetSha256,
    "outcome_set_mismatch",
  );
}

function pushOutcomesCountDiagnostics(
  diagnostics: string[],
  declared: ReplayOutcomesDeclaration,
  observed: ExecutionPlanBlueprintRecordReplayOutcomes,
): void {
  pushDiagnostic(
    diagnostics,
    declared.replayCount !== observed.replayCount,
    "replay_count_mismatch",
  );
  pushDiagnostic(
    diagnostics,
    declared.completedCount !== observed.completedCount,
    "completed_count_mismatch",
  );
  pushDiagnostic(
    diagnostics,
    declared.blockedCount !== observed.blockedCount,
    "blocked_count_mismatch",
  );
  pushDiagnostic(
    diagnostics,
    declared.invalidCount !== observed.invalidCount,
    "invalid_count_mismatch",
  );
}

function pushHistoryHashDiagnostics(
  diagnostics: string[],
  declared: ReplayHistoryDeclaration,
  observed: ExecutionPlanBlueprintRecordReplayHistory,
): void {
  pushDiagnostic(
    diagnostics,
    Boolean(
      declared.contentSha256 &&
      declared.recomputedContentSha256 &&
      declared.contentSha256 !== declared.recomputedContentSha256,
    ),
    "content_hash_mismatch",
  );
  pushDiagnostic(
    diagnostics,
    Boolean(
      declared.contentSha256 &&
      declared.contentSha256 !== observed.contentSha256,
    ),
    "current_history_mismatch",
  );
  pushDiagnostic(
    diagnostics,
    declared.eventSetSha256 !== observed.eventSetSha256,
    "event_set_mismatch",
  );
}

function pushHistoryCountDiagnostics(
  diagnostics: string[],
  declared: ReplayHistoryDeclaration,
  observed: ExecutionPlanBlueprintRecordReplayHistory,
): void {
  pushDiagnostic(
    diagnostics,
    declared.replayCount !== observed.replayCount,
    "replay_count_mismatch",
  );
  pushDiagnostic(
    diagnostics,
    declared.threadCount !== observed.threadCount,
    "thread_count_mismatch",
  );
  pushDiagnostic(
    diagnostics,
    declared.planCount !== observed.planCount,
    "plan_count_mismatch",
  );
  pushDiagnostic(
    diagnostics,
    declared.firstSeq !== observed.firstSeq ||
      declared.lastSeq !== observed.lastSeq,
    "seq_range_mismatch",
  );
}

export function verifyExecutionPlanBlueprintRecordReplayEventProjection(
  expectedRecordId: string,
  request: VerifyExecutionPlanBlueprintRecordReplayEventRequest,
  events: RunEvent[],
): ExecutionPlanBlueprintRecordReplayEventVerification {
  const diagnostics: string[] = [];
  const eventBySeq = events.find((event) => event.seq === request.seq);
  const eventById = events.find((event) => event.id === request.eventId);
  const observedEvent = eventBySeq ?? eventById;
  if (!eventBySeq && !eventById) diagnostics.push("event_not_found");
  if (eventBySeq && eventBySeq.id !== request.eventId) {
    diagnostics.push("event_id_mismatch");
  }
  if (eventById && eventById.seq !== request.seq) {
    diagnostics.push("event_seq_mismatch");
  }
  if (eventBySeq && eventById && eventBySeq.id !== eventById.id) {
    diagnostics.push("event_anchor_mismatch");
  }
  const observedEventSha256 = observedEvent
    ? sha256(JSON.stringify(observedEvent))
    : undefined;
  if (
    observedEventSha256 !== undefined &&
    request.eventSha256 !== observedEventSha256
  ) {
    diagnostics.push("event_hash_mismatch");
  }
  const observedReplay = observedEvent
    ? executionPlanBlueprintRecordReplayFromEvent(
        observedEvent,
        expectedRecordId,
      )
    : undefined;
  if (observedEvent && !observedReplay) {
    diagnostics.push("record_replay_mismatch");
  }
  const status: ExecutionPlanBlueprintRecordReplayEventVerification["status"] =
    diagnostics.length === 0 ? "valid" : "invalid";
  const verificationContent = {
    schemaVersion: 1 as const,
    status,
    diagnostics,
    expectedRecordId,
    threadId: request.threadId,
    eventId: request.eventId,
    seq: request.seq,
    declaredEventSha256: request.eventSha256,
    ...(observedEventSha256 ? { observedEventSha256 } : {}),
    ...(observedReplay ? { observedReplay } : {}),
  };
  return {
    ...verificationContent,
    contentSha256: sha256(canonicalJson(verificationContent)),
  };
}

function recomputedHash(
  record: Record<string, unknown> | undefined,
): string | undefined {
  return record ? sha256(canonicalJson(hashContent(record))) : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function sha256Value(value: unknown): string | undefined {
  return isSha256(value) ? value : undefined;
}

function pushDiagnostic(
  diagnostics: string[],
  condition: boolean,
  diagnostic: string,
): void {
  if (condition) diagnostics.push(diagnostic);
}

function definedProperties<T extends Record<string, unknown>>(
  values: T,
): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(
    Object.entries(values).filter((entry) => entry[1] !== undefined),
  ) as { [K in keyof T]?: Exclude<T[K], undefined> };
}

function hashContent(record: Record<string, unknown>): Record<string, unknown> {
  const {
    generatedAt: _generatedAt,
    contentSha256: _contentSha256,
    ...content
  } = record;
  return content;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}
