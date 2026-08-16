import type {
  AutomaticRecoveryAssessment,
  AutomaticRecoveryAttempt,
  RunEvent,
  ThreadDetail,
} from "@napier/contracts";

export type ConversationRecovery = NonNullable<
  ThreadDetail["recoveries"]
>[number];

interface RecoveryEventRef {
  id: string;
  seq: number;
  createdAt: string;
}

export interface ConversationRecoveryEventState {
  assessments: Map<string, RecoveryEventRef[]>;
  attempts: Map<string, RecoveryEventRef[]>;
  interruptedRuns: Map<string, RecoveryEventRef>;
  recoveryRuns: Map<string, RecoveryEventRef[]>;
  settlements: Map<
    string,
    ConversationRecovery["settlement"] & { seq: number }
  >;
}

const AUTOMATIC_RECOVERY_EVENT =
  /^run\.recovery\.auto\.(skipped|claimed|started|completed|failed|interrupted|abandoned)$/u;
const RECOVERY_RUN_EVENT = /^run\.recovery\.(started|completed|failed)$/u;
const RECOVERY_RUN_LIFECYCLE_EVENT =
  /^run\.(completed|failed|cancelled|interrupted|budget\.exhausted)$/u;
const MAX_EVENT_REFS = 256;
const MAX_CARDS = 8;

export function createConversationRecoveryEventState(): ConversationRecoveryEventState {
  return {
    assessments: new Map(),
    attempts: new Map(),
    interruptedRuns: new Map(),
    recoveryRuns: new Map(),
    settlements: new Map(),
  };
}

export function applyConversationRecoveryEvent(
  source: ConversationRecoveryEventState,
  event: RunEvent,
): ConversationRecoveryEventState {
  if (event.visibility !== "user" || !record(event.payload)) return source;
  const state = cloneState(source);
  const ref = eventRef(event);
  if (event.type === "run.interrupted") {
    state.interruptedRuns.set(event.runId, ref);
  }
  if (AUTOMATIC_RECOVERY_EVENT.test(event.type)) {
    const assessmentSha256 = digest(event.payload["assessmentSha256"]);
    const attemptId = text(event.payload["attemptId"]);
    if (event.type === "run.recovery.auto.skipped" && assessmentSha256) {
      appendRef(state.assessments, assessmentSha256, ref);
    } else if (attemptId) {
      appendRef(state.attempts, attemptId, ref);
    }
  }
  if (RECOVERY_RUN_EVENT.test(event.type)) {
    const attemptId = text(event.payload["attemptId"]);
    if (attemptId) appendRef(state.attempts, attemptId, ref);
    appendRef(state.recoveryRuns, event.runId, ref);
  }
  if (
    RECOVERY_RUN_LIFECYCLE_EVENT.test(event.type) &&
    state.recoveryRuns.has(event.runId)
  ) {
    appendRef(state.recoveryRuns, event.runId, ref);
  }
  const settlement = budgetSettlement(event);
  if (settlement && state.recoveryRuns.has(event.runId)) {
    state.settlements.set(event.runId, settlement);
  }
  return trimState(state);
}

export function projectConversationRecoveries(
  assessments: AutomaticRecoveryAssessment[],
  attempts: AutomaticRecoveryAttempt[],
  state: ConversationRecoveryEventState,
): ConversationRecovery[] {
  const attemptByAssessment = new Map(
    attempts.map((attempt) => [attempt.assessmentSha256, attempt]),
  );
  return assessments
    .flatMap((assessment): ConversationRecovery[] => {
      const attempt = attemptByAssessment.get(assessment.contentSha256);
      const refs = boundRefs(state, assessment, attempt);
      const latest = refs.at(-1);
      if (!latest) return [];
      const settlement = attempt?.recoveryRunId
        ? state.settlements.get(attempt.recoveryRunId)
        : undefined;
      return [
        {
          id: assessment.runId,
          seq: latest.seq,
          createdAt: latest.createdAt,
          status: attempt?.status ?? "skipped",
          assessment: assessmentView(assessment),
          ...(attempt ? { attempt: attemptView(attempt) } : {}),
          ...(settlement ? { settlement: withoutSeq(settlement) } : {}),
          eventIds: refs.map((ref) => ref.id),
        },
      ];
    })
    .sort((left, right) => left.seq - right.seq)
    .slice(-MAX_CARDS);
}

function boundRefs(
  state: ConversationRecoveryEventState,
  assessment: AutomaticRecoveryAssessment,
  attempt: AutomaticRecoveryAttempt | undefined,
): RecoveryEventRef[] {
  return [
    ...(state.interruptedRuns.get(assessment.runId)
      ? [state.interruptedRuns.get(assessment.runId)!]
      : []),
    ...(state.assessments.get(assessment.contentSha256) ?? []),
    ...(attempt ? (state.attempts.get(attempt.id) ?? []) : []),
    ...(attempt?.recoveryRunId
      ? (state.recoveryRuns.get(attempt.recoveryRunId) ?? [])
      : []),
  ]
    .filter(
      (ref, index, refs) =>
        refs.findIndex((item) => item.id === ref.id) === index,
    )
    .sort((left, right) => left.seq - right.seq);
}

function assessmentView(
  assessment: AutomaticRecoveryAssessment,
): ConversationRecovery["assessment"] {
  return {
    contentSha256: assessment.contentSha256,
    interruptedRunId: assessment.runId,
    rootRunId: assessment.rootRunId,
    eligible: assessment.eligible,
    blockReasons: [...assessment.blockReasons],
    policy: { ...assessment.policy },
    toolCalls: { ...assessment.toolCalls },
    eventRange: { ...assessment.eventRange },
    priorAttempts: assessment.priorAttempts,
    assessedAt: assessment.assessedAt,
  };
}

function attemptView(
  attempt: AutomaticRecoveryAttempt,
): NonNullable<ConversationRecovery["attempt"]> {
  return {
    id: attempt.id,
    status: attempt.status,
    attempt: attempt.attempt,
    maxAttempts: attempt.maxAttempts,
    ...(attempt.recoveryRunId ? { recoveryRunId: attempt.recoveryRunId } : {}),
    revision: attempt.revision,
  };
}

function budgetSettlement(
  event: RunEvent,
): (ConversationRecovery["settlement"] & { seq: number }) | undefined {
  if (event.type !== "run.budget.exhausted" || !record(event.payload)) {
    return undefined;
  }
  const budgetReason = event.payload["reason"];
  if (
    budgetReason !== "turns" &&
    budgetReason !== "tokens" &&
    budgetReason !== "cost" &&
    budgetReason !== "timeout"
  ) {
    return undefined;
  }
  const observed = record(event.payload["observed"])
    ? event.payload["observed"]
    : {};
  return {
    budgetReason,
    seq: event.seq,
    ...numberField(event.payload, "limit"),
    ...numberField(observed, "turns", "observedTurns"),
    ...numberField(observed, "totalTokens", "observedTotalTokens"),
    ...numberField(observed, "costUsd", "observedCostUsd"),
    ...numberField(observed, "elapsedMs", "observedElapsedMs"),
  };
}

function numberField(
  value: Record<string, unknown>,
  key: string,
  outputKey = key,
): Record<string, number> {
  const entry = value[key];
  return typeof entry === "number" && Number.isFinite(entry) && entry >= 0
    ? { [outputKey]: entry }
    : {};
}

function cloneState(
  source: ConversationRecoveryEventState,
): ConversationRecoveryEventState {
  return {
    assessments: cloneRefMap(source.assessments),
    attempts: cloneRefMap(source.attempts),
    interruptedRuns: new Map(source.interruptedRuns),
    recoveryRuns: cloneRefMap(source.recoveryRuns),
    settlements: new Map(source.settlements),
  };
}

function cloneRefMap(
  source: ReadonlyMap<string, RecoveryEventRef[]>,
): Map<string, RecoveryEventRef[]> {
  return new Map([...source].map(([key, refs]) => [key, [...refs]]));
}

function appendRef(
  target: Map<string, RecoveryEventRef[]>,
  key: string,
  ref: RecoveryEventRef,
): void {
  target.set(key, [...(target.get(key) ?? []), ref]);
}

function trimState(
  state: ConversationRecoveryEventState,
): ConversationRecoveryEventState {
  const refs = [
    ...state.assessments.values(),
    ...state.attempts.values(),
    ...state.recoveryRuns.values(),
    ...[...state.interruptedRuns.values()].map((ref) => [ref]),
  ]
    .flat()
    .sort((left, right) => left.seq - right.seq);
  const minimumSeq = refs.at(-MAX_EVENT_REFS)?.seq ?? 0;
  trimRefMap(state.assessments, minimumSeq);
  trimRefMap(state.attempts, minimumSeq);
  trimRefMap(state.recoveryRuns, minimumSeq);
  for (const [key, ref] of state.interruptedRuns) {
    if (ref.seq < minimumSeq) state.interruptedRuns.delete(key);
  }
  for (const [key, settlement] of state.settlements) {
    if (settlement.seq < minimumSeq) state.settlements.delete(key);
  }
  return state;
}

function trimRefMap(
  target: Map<string, RecoveryEventRef[]>,
  minimumSeq: number,
): void {
  for (const [key, refs] of target) {
    const retained = refs.filter((ref) => ref.seq >= minimumSeq);
    if (retained.length > 0) target.set(key, retained);
    else target.delete(key);
  }
}

function eventRef(event: RunEvent): RecoveryEventRef {
  return { id: event.id, seq: event.seq, createdAt: event.createdAt };
}

function withoutSeq(
  settlement: NonNullable<ConversationRecovery["settlement"]> & {
    seq: number;
  },
): NonNullable<ConversationRecovery["settlement"]> {
  const { seq: _seq, ...view } = settlement;
  return view;
}

function digest(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)
    ? value
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
