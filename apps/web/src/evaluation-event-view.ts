import type { RunEvent } from "@napier/contracts";

export interface EvaluationEventTraceView {
  action: string;
  evaluationId?: string;
  casebookId?: string;
  suiteId?: string;
  executionId?: string;
  adjudicationId?: string;
  ballotId?: string;
  resolutionId?: string;
  caseId?: string;
  sourceEvaluationId?: string;
  leftRunId?: string;
  rightRunId?: string;
  baselineRunId?: string;
  revision?: number;
  casebookRevision?: number;
  suiteRevision?: number;
  adjudicationRevision?: number;
  verdict?: string;
  modelVerdict?: string;
  expectedVerdict?: string;
  consensusVerdict?: string;
  status?: string;
  source?: string;
  contextCoverageStatus?: string;
  evaluatorModel?: string;
  agreement?: boolean;
  allowInconclusive?: boolean;
  reviewerCount?: number;
  sampleCount?: number;
  agreementCount?: number;
  inconclusiveCount?: number;
  unverifiedCount?: number;
  passedCount?: number;
  failedCount?: number;
  caseCount?: number;
  candidateRunCount?: number;
  minimumPassRate?: number;
  minimumCandidateScore?: number;
  passRate?: number;
  agreementRate?: number;
  averageCandidateScore?: number;
  leftSnapshotSha256?: string;
  rightSnapshotSha256?: string;
  evaluationSha256?: string;
  adjudicationSha256?: string;
  ballotSha256?: string;
  reportSha256?: string;
  resolutionSha256?: string;
  contentSha256?: string;
  comparisonGovernanceSha256?: string;
  contextCoverageDiagnosticsSha256?: string;
}

const EVALUATION_EVENT =
  /^evaluation\.(completed|adjudication\.reviewed|reviewer_ballot\.recorded|consensus\.resolved|casebook\.(created|updated|case\.(curated|refreshed|removed)|qualification\.completed)|suite\.(created|updated|completed))$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_TOKEN = /^[A-Za-z0-9_.:/@-]{1,160}$/u;
const EVALUATION_RECEIPT_SUMMARY = "evaluation receipt";

export function evaluationEventTraceView(
  event: RunEvent,
): EvaluationEventTraceView | undefined {
  if (!EVALUATION_EVENT.test(event.type)) return undefined;
  if (
    !event.payload ||
    typeof event.payload !== "object" ||
    Array.isArray(event.payload)
  ) {
    return undefined;
  }
  const evaluatorModel = modelLabel(event.payload["evaluatorModel"]);
  const candidateRunIds = Array.isArray(event.payload["candidateRunIds"])
    ? event.payload["candidateRunIds"]
    : undefined;
  return {
    action: event.type.slice("evaluation.".length),
    ...safeIdField(event.payload, "evaluationId"),
    ...safeIdField(event.payload, "casebookId"),
    ...safeIdField(event.payload, "suiteId"),
    ...safeIdField(event.payload, "executionId"),
    ...safeIdField(event.payload, "adjudicationId"),
    ...safeIdField(event.payload, "ballotId"),
    ...safeIdField(event.payload, "resolutionId"),
    ...safeIdField(event.payload, "caseId"),
    ...safeIdField(event.payload, "sourceEvaluationId"),
    ...safeIdField(event.payload, "leftRunId"),
    ...safeIdField(event.payload, "rightRunId"),
    ...safeIdField(event.payload, "baselineRunId"),
    ...integerField(event.payload, "revision"),
    ...integerField(event.payload, "casebookRevision"),
    ...integerField(event.payload, "suiteRevision"),
    ...integerField(event.payload, "adjudicationRevision"),
    ...safeTokenField(event.payload, "verdict"),
    ...safeTokenField(event.payload, "modelVerdict"),
    ...safeTokenField(event.payload, "expectedVerdict"),
    ...safeTokenField(event.payload, "consensusVerdict"),
    ...safeTokenField(event.payload, "status"),
    ...safeTokenField(event.payload, "source"),
    ...safeTokenField(event.payload, "contextCoverageStatus"),
    ...(evaluatorModel ? { evaluatorModel } : {}),
    ...booleanField(event.payload, "agreement"),
    ...gateBooleanField(event.payload, "allowInconclusive"),
    ...integerField(event.payload, "reviewerCount"),
    ...integerField(event.payload, "sampleCount"),
    ...integerField(event.payload, "agreementCount"),
    ...integerField(event.payload, "inconclusiveCount"),
    ...integerField(event.payload, "unverifiedCount"),
    ...integerField(event.payload, "passedCount"),
    ...integerField(event.payload, "failedCount"),
    ...integerField(event.payload, "caseCount"),
    ...(candidateRunIds ? { candidateRunCount: candidateRunIds.length } : {}),
    ...gateNumberField(event.payload, "minimumPassRate"),
    ...gateNumberField(event.payload, "minimumCandidateScore"),
    ...numberField(event.payload, "passRate"),
    ...numberField(event.payload, "agreementRate"),
    ...numberField(event.payload, "averageCandidateScore"),
    ...shaField(event.payload, "leftSnapshotSha256"),
    ...shaField(event.payload, "rightSnapshotSha256"),
    ...shaField(event.payload, "evaluationSha256"),
    ...shaField(event.payload, "adjudicationSha256"),
    ...shaField(event.payload, "ballotSha256"),
    ...shaField(event.payload, "reportSha256"),
    ...shaField(event.payload, "resolutionSha256"),
    ...shaField(event.payload, "contentSha256"),
    ...shaField(event.payload, "comparisonGovernanceSha256"),
    ...shaField(event.payload, "contextCoverageDiagnosticsSha256"),
  };
}

export function evaluationEventTraceSummary(
  event: RunEvent,
): string | undefined {
  if (!event.type.startsWith("evaluation.")) return undefined;
  if (!EVALUATION_EVENT.test(event.type)) return event.category;
  const view = evaluationEventTraceView(event);
  if (!view) return EVALUATION_RECEIPT_SUMMARY;
  return [
    `evaluation / ${view.action}`,
    ...idSummaries(view),
    ...(view.revision !== undefined ? [`revision ${view.revision}`] : []),
    ...(view.casebookRevision !== undefined
      ? [`casebook-revision ${view.casebookRevision}`]
      : []),
    ...(view.suiteRevision !== undefined
      ? [`suite-revision ${view.suiteRevision}`]
      : []),
    ...(view.adjudicationRevision !== undefined
      ? [`adjudication-revision ${view.adjudicationRevision}`]
      : []),
    ...(view.verdict ? [`verdict ${view.verdict}`] : []),
    ...(view.modelVerdict ? [`model ${view.modelVerdict}`] : []),
    ...(view.expectedVerdict ? [`expected ${view.expectedVerdict}`] : []),
    ...(view.consensusVerdict ? [`consensus ${view.consensusVerdict}`] : []),
    ...(view.status ? [`status ${view.status}`] : []),
    ...(view.source ? [`source ${view.source}`] : []),
    ...(view.contextCoverageStatus
      ? [`context ${view.contextCoverageStatus}`]
      : []),
    ...(view.evaluatorModel ? [`evaluator ${view.evaluatorModel}`] : []),
    ...(view.agreement !== undefined ? [`agreement ${view.agreement}`] : []),
    ...(view.allowInconclusive !== undefined
      ? [`allow-inconclusive ${view.allowInconclusive}`]
      : []),
    ...countSummaries(view),
    ...numberSummaries(view),
    ...hashSummaries(view),
  ].join(" / ");
}

function idSummaries(view: EvaluationEventTraceView): string[] {
  return [
    ...idSummary("evaluation", view.evaluationId),
    ...idSummary("casebook", view.casebookId),
    ...idSummary("suite", view.suiteId),
    ...idSummary("execution", view.executionId),
    ...idSummary("adjudication", view.adjudicationId),
    ...idSummary("ballot", view.ballotId),
    ...idSummary("resolution", view.resolutionId),
    ...idSummary("case", view.caseId),
    ...idSummary("source-evaluation", view.sourceEvaluationId),
    ...idSummary("left-run", view.leftRunId),
    ...idSummary("right-run", view.rightRunId),
    ...idSummary("baseline-run", view.baselineRunId),
  ];
}

function countSummaries(view: EvaluationEventTraceView): string[] {
  return [
    ...(view.reviewerCount !== undefined
      ? [`reviewers ${view.reviewerCount}`]
      : []),
    ...(view.sampleCount !== undefined ? [`samples ${view.sampleCount}`] : []),
    ...(view.agreementCount !== undefined
      ? [`agreements ${view.agreementCount}`]
      : []),
    ...(view.inconclusiveCount !== undefined
      ? [`inconclusive ${view.inconclusiveCount}`]
      : []),
    ...(view.unverifiedCount !== undefined
      ? [`unverified ${view.unverifiedCount}`]
      : []),
    ...(view.passedCount !== undefined ? [`passed ${view.passedCount}`] : []),
    ...(view.failedCount !== undefined ? [`failed ${view.failedCount}`] : []),
    ...(view.caseCount !== undefined ? [`cases ${view.caseCount}`] : []),
    ...(view.candidateRunCount !== undefined
      ? [`candidates ${view.candidateRunCount}`]
      : []),
  ];
}

function numberSummaries(view: EvaluationEventTraceView): string[] {
  return [
    ...(view.minimumPassRate !== undefined
      ? [`min-pass-rate ${formatNumber(view.minimumPassRate)}`]
      : []),
    ...(view.minimumCandidateScore !== undefined
      ? [`min-candidate-score ${formatNumber(view.minimumCandidateScore)}`]
      : []),
    ...(view.passRate !== undefined
      ? [`pass-rate ${formatNumber(view.passRate)}`]
      : []),
    ...(view.agreementRate !== undefined
      ? [`agreement-rate ${formatNumber(view.agreementRate)}`]
      : []),
    ...(view.averageCandidateScore !== undefined
      ? [`avg-candidate ${formatNumber(view.averageCandidateScore)}`]
      : []),
  ];
}

function hashSummaries(view: EvaluationEventTraceView): string[] {
  return [
    ...hashSummary("left-snapshot", view.leftSnapshotSha256),
    ...hashSummary("right-snapshot", view.rightSnapshotSha256),
    ...hashSummary("evaluation", view.evaluationSha256),
    ...hashSummary("adjudication", view.adjudicationSha256),
    ...hashSummary("ballot", view.ballotSha256),
    ...hashSummary("report", view.reportSha256),
    ...hashSummary("resolution", view.resolutionSha256),
    ...hashSummary("content", view.contentSha256),
    ...hashSummary("governance", view.comparisonGovernanceSha256),
    ...hashSummary("context-diagnostics", view.contextCoverageDiagnosticsSha256),
  ];
}

function idSummary(label: string, value: string | undefined): string[] {
  return value ? [`${label} ${value.slice(-10)}`] : [];
}

function hashSummary(label: string, value: string | undefined): string[] {
  return value ? [`${label} ${value.slice(0, 12)}`] : [];
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

function safeIdField(
  payload: Record<string, unknown>,
  key: keyof EvaluationEventTraceView,
): Partial<EvaluationEventTraceView> {
  const value = safeToken(payload[key]);
  return value ? { [key]: value } : {};
}

function safeTokenField(
  payload: Record<string, unknown>,
  key: keyof EvaluationEventTraceView,
): Partial<EvaluationEventTraceView> {
  const value = safeToken(payload[key]);
  return value ? { [key]: value } : {};
}

function booleanField(
  payload: Record<string, unknown>,
  key: keyof EvaluationEventTraceView,
): Partial<EvaluationEventTraceView> {
  const value = payload[key];
  return typeof value === "boolean" ? { [key]: value } : {};
}

function gateBooleanField(
  payload: Record<string, unknown>,
  key: keyof EvaluationEventTraceView,
): Partial<EvaluationEventTraceView> {
  const gate = record(payload["gate"]) ? payload["gate"] : undefined;
  const value = gate?.[key] ?? payload[key];
  return typeof value === "boolean" ? { [key]: value } : {};
}

function integerField(
  payload: Record<string, unknown>,
  key: keyof EvaluationEventTraceView,
): Partial<EvaluationEventTraceView> {
  const value = payload[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? { [key]: value }
    : {};
}

function numberField(
  payload: Record<string, unknown>,
  key: keyof EvaluationEventTraceView,
): Partial<EvaluationEventTraceView> {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? { [key]: value }
    : {};
}

function gateNumberField(
  payload: Record<string, unknown>,
  key: keyof EvaluationEventTraceView,
): Partial<EvaluationEventTraceView> {
  const gate = record(payload["gate"]) ? payload["gate"] : undefined;
  const value = gate?.[key] ?? payload[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? { [key]: value }
    : {};
}

function shaField(
  payload: Record<string, unknown>,
  key: keyof EvaluationEventTraceView,
): Partial<EvaluationEventTraceView> {
  const value = sha256(payload[key]);
  return value ? { [key]: value } : {};
}

function modelLabel(value: unknown): string | undefined {
  if (!record(value)) return undefined;
  const provider = safeToken(value["provider"]);
  const id = safeToken(value["id"]);
  return provider && id ? `${provider}/${id}` : undefined;
}

function safeToken(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_TOKEN.test(value) ? value : undefined;
}

function sha256(value: unknown): string | undefined {
  return typeof value === "string" && SHA256.test(value) ? value : undefined;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
