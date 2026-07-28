import type { RunEvent } from "@napier/contracts";

export interface RunEventTraceView {
  action: string;
  status?: string;
  source?: string;
  mode?: string;
  recoveryMode?: string;
  model?: string;
  role?: string;
  agentId?: string;
  triggerId?: string;
  parentRunId?: string;
  operatorDecisionId?: string;
  attemptId?: string;
  recoveryAttemptId?: string;
  recoveryRunId?: string;
  sourceRunId?: string;
  rootRunId?: string;
  agentRevision?: number;
  attempt?: number;
  maxAttempts?: number;
  priorAttempts?: number;
  limit?: number;
  observedTurns?: number;
  observedTotalTokens?: number;
  observedCostUsd?: number;
  observedElapsedMs?: number;
  maxTurns?: number;
  maxTotalTokens?: number;
  maxCostUsd?: number;
  timeoutMs?: number;
  blockReasonCount?: number;
  toolCallCount?: number;
  budgetReason?: string;
  interruptedAt?: string;
  configurationSha256?: string;
  assessmentSha256?: string;
  recoveryAssessmentSha256?: string;
  eventStreamSha256?: string;
}

const RUN_EVENT =
  /^run\.(started|completed|failed|cancelled|interrupted|waiting_for_operator|budget\.exhausted|settlement\.recorded|recovery\.(started|completed|failed|prompt|auto\.(skipped|claimed|started|completed|interrupted|abandoned|failed)))$/u;
const SAFE_TOKEN = /^[A-Za-z0-9_.:/@-]{1,180}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T/u;
const RUN_RECEIPT_SUMMARY = "run receipt";

export function runEventTraceView(
  event: RunEvent,
): RunEventTraceView | undefined {
  if (!RUN_EVENT.test(event.type)) return undefined;
  if (
    !event.payload ||
    typeof event.payload !== "object" ||
    Array.isArray(event.payload)
  ) {
    return undefined;
  }
  const limits = record(event.payload["limits"]) ? event.payload["limits"] : {};
  const observed = record(event.payload["observed"])
    ? event.payload["observed"]
    : {};
  const blockReasons = Array.isArray(event.payload["blockReasons"])
    ? event.payload["blockReasons"]
    : undefined;
  const toolCalls = Array.isArray(event.payload["toolCalls"])
    ? event.payload["toolCalls"]
    : undefined;
  const interruptedAt = safeIso(event.payload["interruptedAt"]);
  const budgetReason =
    event.type === "run.budget.exhausted"
      ? safeToken(event.payload["reason"])
      : undefined;
  return {
    action: event.type.slice("run.".length),
    ...safeTokenField(event.payload, "status"),
    ...safeTokenField(event.payload, "source"),
    ...safeTokenField(event.payload, "mode"),
    ...safeTokenField(event.payload, "recoveryMode"),
    ...safeTokenField(event.payload, "model"),
    ...safeTokenField(event.payload, "role"),
    ...safeIdField(event.payload, "agentId"),
    ...safeIdField(event.payload, "triggerId"),
    ...safeIdField(event.payload, "parentRunId"),
    ...safeIdField(event.payload, "operatorDecisionId"),
    ...safeIdField(event.payload, "attemptId"),
    ...safeIdField(event.payload, "recoveryAttemptId"),
    ...safeIdField(event.payload, "recoveryRunId"),
    ...safeIdField(event.payload, "sourceRunId"),
    ...safeIdField(event.payload, "rootRunId"),
    ...integerField(event.payload, "agentRevision"),
    ...integerField(event.payload, "attempt"),
    ...integerField(event.payload, "maxAttempts"),
    ...integerField(event.payload, "priorAttempts"),
    ...numberField(event.payload, "limit"),
    ...numberAliasField(observed, "turns", "observedTurns"),
    ...numberAliasField(observed, "totalTokens", "observedTotalTokens"),
    ...numberAliasField(observed, "costUsd", "observedCostUsd"),
    ...numberAliasField(observed, "elapsedMs", "observedElapsedMs"),
    ...numberAliasField(limits, "maxTurns", "maxTurns"),
    ...numberAliasField(limits, "maxTotalTokens", "maxTotalTokens"),
    ...numberAliasField(limits, "maxCostUsd", "maxCostUsd"),
    ...numberAliasField(limits, "timeoutMs", "timeoutMs"),
    ...(blockReasons ? { blockReasonCount: blockReasons.length } : {}),
    ...(toolCalls ? { toolCallCount: toolCalls.length } : {}),
    ...(budgetReason ? { budgetReason } : {}),
    ...(interruptedAt ? { interruptedAt } : {}),
    ...shaField(event.payload, "configurationSha256"),
    ...shaField(event.payload, "assessmentSha256"),
    ...shaField(event.payload, "recoveryAssessmentSha256"),
    ...shaField(event.payload, "eventStreamSha256"),
  };
}

export function runEventTraceSummary(event: RunEvent): string | undefined {
  if (!event.type.startsWith("run.")) return undefined;
  if (!RUN_EVENT.test(event.type)) return event.category;
  const view = runEventTraceView(event);
  if (!view) return RUN_RECEIPT_SUMMARY;
  return [
    `run / ${view.action}`,
    ...(view.status ? [`status ${view.status}`] : []),
    ...(view.source ? [`source ${view.source}`] : []),
    ...(view.mode ? [`mode ${view.mode}`] : []),
    ...(view.recoveryMode ? [`recovery-mode ${view.recoveryMode}`] : []),
    ...(view.model ? [`model ${view.model}`] : []),
    ...(view.role ? [`role ${view.role}`] : []),
    ...idSummaries(view),
    ...(view.agentRevision !== undefined
      ? [`agent-revision ${view.agentRevision}`]
      : []),
    ...(view.attempt !== undefined
      ? [
          `attempt ${view.attempt}${
            view.maxAttempts !== undefined ? `/${view.maxAttempts}` : ""
          }`,
        ]
      : view.maxAttempts !== undefined
        ? [`max-attempts ${view.maxAttempts}`]
        : []),
    ...(view.priorAttempts !== undefined
      ? [`prior-attempts ${view.priorAttempts}`]
      : []),
    ...(view.budgetReason ? [`reason ${view.budgetReason}`] : []),
    ...(view.limit !== undefined ? [`limit ${formatNumber(view.limit)}`] : []),
    ...observedSummaries(view),
    ...limitSummaries(view),
    ...(view.blockReasonCount !== undefined
      ? [`block-reasons ${view.blockReasonCount}`]
      : []),
    ...(view.toolCallCount !== undefined
      ? [`tool-calls ${view.toolCallCount}`]
      : []),
    ...(view.interruptedAt ? [`interrupted-at ${view.interruptedAt}`] : []),
    ...hashSummaries(view),
  ].join(" / ");
}

function idSummaries(view: RunEventTraceView): string[] {
  return [
    ...idSummary("agent", view.agentId),
    ...idSummary("trigger", view.triggerId),
    ...idSummary("parent-run", view.parentRunId),
    ...idSummary("decision", view.operatorDecisionId),
    ...idSummary("attempt-id", view.attemptId),
    ...idSummary("recovery-attempt", view.recoveryAttemptId),
    ...idSummary("recovery-run", view.recoveryRunId),
    ...idSummary("source-run", view.sourceRunId),
    ...idSummary("root-run", view.rootRunId),
  ];
}

function observedSummaries(view: RunEventTraceView): string[] {
  return [
    ...(view.observedTurns !== undefined
      ? [`observed-turns ${formatNumber(view.observedTurns)}`]
      : []),
    ...(view.observedTotalTokens !== undefined
      ? [`observed-tokens ${formatNumber(view.observedTotalTokens)}`]
      : []),
    ...(view.observedCostUsd !== undefined
      ? [`observed-cost ${formatNumber(view.observedCostUsd)}`]
      : []),
    ...(view.observedElapsedMs !== undefined
      ? [`observed-ms ${formatNumber(view.observedElapsedMs)}`]
      : []),
  ];
}

function limitSummaries(view: RunEventTraceView): string[] {
  return [
    ...(view.maxTurns !== undefined
      ? [`max-turns ${formatNumber(view.maxTurns)}`]
      : []),
    ...(view.maxTotalTokens !== undefined
      ? [`max-tokens ${formatNumber(view.maxTotalTokens)}`]
      : []),
    ...(view.maxCostUsd !== undefined
      ? [`max-cost ${formatNumber(view.maxCostUsd)}`]
      : []),
    ...(view.timeoutMs !== undefined
      ? [`timeout-ms ${formatNumber(view.timeoutMs)}`]
      : []),
  ];
}

function hashSummaries(view: RunEventTraceView): string[] {
  return [
    ...hashSummary("config", view.configurationSha256),
    ...hashSummary("assessment", view.assessmentSha256),
    ...hashSummary("recovery-assessment", view.recoveryAssessmentSha256),
    ...hashSummary("event-stream", view.eventStreamSha256),
  ];
}

function idSummary(label: string, value: string | undefined): string[] {
  return value ? [`${label} ${value.slice(-10)}`] : [];
}

function hashSummary(label: string, value: string | undefined): string[] {
  return value ? [`${label} ${value.slice(0, 12)}`] : [];
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(6);
}

function safeIdField(
  payload: Record<string, unknown>,
  key: keyof RunEventTraceView,
): Partial<RunEventTraceView> {
  const value = safeToken(payload[key]);
  return value ? { [key]: value } : {};
}

function safeTokenField(
  payload: Record<string, unknown>,
  key: keyof RunEventTraceView,
): Partial<RunEventTraceView> {
  const value = safeToken(payload[key]);
  return value ? { [key]: value } : {};
}

function integerField(
  payload: Record<string, unknown>,
  key: keyof RunEventTraceView,
): Partial<RunEventTraceView> {
  const value = payload[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? { [key]: value }
    : {};
}

function numberField(
  payload: Record<string, unknown>,
  key: keyof RunEventTraceView,
): Partial<RunEventTraceView> {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? { [key]: value }
    : {};
}

function numberAliasField(
  payload: Record<string, unknown>,
  sourceKey: string,
  targetKey: keyof RunEventTraceView,
): Partial<RunEventTraceView> {
  const value = payload[sourceKey];
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? { [targetKey]: value }
    : {};
}

function shaField(
  payload: Record<string, unknown>,
  key: keyof RunEventTraceView,
): Partial<RunEventTraceView> {
  const value = sha256(payload[key]);
  return value ? { [key]: value } : {};
}

function safeToken(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_TOKEN.test(value) ? value : undefined;
}

function safeIso(value: unknown): string | undefined {
  return typeof value === "string" && ISO_TIME.test(value) ? value : undefined;
}

function sha256(value: unknown): string | undefined {
  return typeof value === "string" && SHA256.test(value) ? value : undefined;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
