import { createHash } from "node:crypto";

import {
  NAPIER_API_VERSION,
  type CreateEvaluationSuiteRequest,
  type EvaluationSuite,
  type EvaluationSuiteCaseResult,
  type EvaluationSuiteExecution,
  type EvaluationSuiteGate,
  type EvaluationSuiteGateReceipt,
  type EvaluationSuiteExecutionStatus,
  type ModelRef,
  type RunEvaluationRecord,
  type UpdateEvaluationSuiteRequest,
} from "@napier/contracts";

import {
  DEFAULT_EVALUATION_RUBRIC,
  RunEvaluationService,
  normalizeRubric,
} from "./evaluation.js";
import { createId, nowIso } from "./ids.js";
import type { ModelRegistry } from "./models.js";
import type { EvaluationSuiteStorePort } from "./store-port.js";

export const DEFAULT_EVALUATION_SUITE_GATE: EvaluationSuiteGate = {
  minimumPassRate: 1,
  minimumCandidateScore: 3,
  allowInconclusive: false,
};

export class EvaluationSuiteService {
  private readonly evaluations: RunEvaluationService;

  constructor(
    private readonly store: EvaluationSuiteStorePort,
    models: ModelRegistry,
  ) {
    this.evaluations = new RunEvaluationService(store, models);
  }

  async execute(
    threadId: string,
    suiteId: string,
  ): Promise<EvaluationSuiteExecution> {
    const suite = this.store.getEvaluationSuite(suiteId);
    if (suite.threadId !== threadId) {
      throw new Error("Evaluation suite does not belong to the target thread");
    }
    const startedAt = nowIso();
    const results: EvaluationSuiteCaseResult[] = [];
    for (const candidateRunId of suite.candidateRunIds) {
      const evaluation = await this.evaluations.evaluate(threadId, {
        leftRunId: suite.baselineRunId,
        rightRunId: candidateRunId,
        rubric: suite.rubric,
        model: suite.evaluatorModel,
      });
      results.push(createCaseResult(evaluation, suite.gate));
    }
    const conclusive = results.filter(
      (result) => result.status !== "inconclusive",
    );
    const passedCount = results.filter(
      (result) => result.status === "passed",
    ).length;
    const failedCount = results.filter(
      (result) => result.status === "failed",
    ).length;
    const inconclusiveCount = results.length - conclusive.length;
    const passRate =
      conclusive.length > 0 ? passedCount / conclusive.length : 0;
    const candidateScores = results.flatMap((result) =>
      result.candidateAverageScore === undefined
        ? []
        : [result.candidateAverageScore],
    );
    const averageCandidateScore =
      candidateScores.length > 0 ? average(candidateScores) : undefined;
    const status = evaluationSuiteStatus(
      suite.gate,
      passRate,
      conclusive.length,
      inconclusiveCount,
    );
    const evidence = {
      suiteId: suite.id,
      suiteRevision: suite.revision,
      threadId,
      name: suite.name,
      baselineRunId: suite.baselineRunId,
      candidateRunIds: suite.candidateRunIds,
      rubric: suite.rubric,
      evaluatorModel: suite.evaluatorModel,
      gate: suite.gate,
      results,
      passedCount,
      failedCount,
      inconclusiveCount,
      passRate,
      ...(averageCandidateScore !== undefined ? { averageCandidateScore } : {}),
      status,
    };
    const execution: EvaluationSuiteExecution = {
      id: createId("evalsuite"),
      ...evidence,
      contentSha256: hashEvaluationSuiteExecution(evidence),
      startedAt,
      finishedAt: nowIso(),
    };
    const saved = await this.store.saveEvaluationSuiteExecution(execution);
    await this.store.appendEvent({
      threadId,
      runId: createId("evalrun"),
      type: "evaluation.suite.completed",
      category: "evaluation",
      visibility: "user",
      payload: {
        suiteId: saved.suiteId,
        executionId: saved.id,
        suiteRevision: saved.suiteRevision,
        status: saved.status,
        passedCount: saved.passedCount,
        failedCount: saved.failedCount,
        inconclusiveCount: saved.inconclusiveCount,
        passRate: saved.passRate,
        contentSha256: saved.contentSha256,
      },
    });
    return saved;
  }
}

export function createEvaluationSuiteRecord(
  threadId: string,
  request: CreateEvaluationSuiteRequest,
  defaultModel: ModelRef,
): EvaluationSuite {
  const timestamp = nowIso();
  const baselineRunId = normalizeRunId(request.baselineRunId, "baseline");
  return {
    id: createId("suite"),
    threadId,
    name: normalizeSuiteName(request.name),
    baselineRunId,
    candidateRunIds: normalizeCandidateRunIds(
      request.candidateRunIds,
      baselineRunId,
    ),
    rubric: normalizeRubric(request.rubric ?? DEFAULT_EVALUATION_RUBRIC),
    evaluatorModel: normalizeModel(request.model ?? defaultModel),
    gate: normalizeEvaluationSuiteGate(request.gate),
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function updateEvaluationSuiteRecord(
  current: EvaluationSuite,
  request: UpdateEvaluationSuiteRequest,
): EvaluationSuite {
  const baselineRunId = normalizeRunId(
    request.baselineRunId ?? current.baselineRunId,
    "baseline",
  );
  const updated: EvaluationSuite = {
    ...current,
    name:
      request.name === undefined
        ? current.name
        : normalizeSuiteName(request.name),
    baselineRunId,
    candidateRunIds:
      request.candidateRunIds === undefined
        ? current.candidateRunIds
        : normalizeCandidateRunIds(request.candidateRunIds, baselineRunId),
    rubric:
      request.rubric === undefined
        ? current.rubric
        : normalizeRubric(request.rubric),
    evaluatorModel:
      request.model === undefined
        ? current.evaluatorModel
        : normalizeModel(request.model),
    gate:
      request.gate === undefined
        ? current.gate
        : normalizeEvaluationSuiteGate(request.gate, current.gate),
    revision: current.revision + 1,
    updatedAt: nowIso(),
  };
  const semanticCurrent = {
    name: current.name,
    baselineRunId: current.baselineRunId,
    candidateRunIds: current.candidateRunIds,
    rubric: current.rubric,
    evaluatorModel: current.evaluatorModel,
    gate: current.gate,
  };
  const semanticUpdated = {
    name: updated.name,
    baselineRunId: updated.baselineRunId,
    candidateRunIds: updated.candidateRunIds,
    rubric: updated.rubric,
    evaluatorModel: updated.evaluatorModel,
    gate: updated.gate,
  };
  return JSON.stringify(semanticCurrent) === JSON.stringify(semanticUpdated)
    ? structuredClone(current)
    : updated;
}

export function normalizeEvaluationSuiteGate(
  input: Partial<EvaluationSuiteGate> | undefined,
  defaults: EvaluationSuiteGate = DEFAULT_EVALUATION_SUITE_GATE,
): EvaluationSuiteGate {
  const gate = { ...defaults, ...input };
  if (
    !Number.isFinite(gate.minimumPassRate) ||
    gate.minimumPassRate < 0 ||
    gate.minimumPassRate > 1
  ) {
    throw new Error("Evaluation suite minimum pass rate must be 0-1");
  }
  if (
    !Number.isFinite(gate.minimumCandidateScore) ||
    gate.minimumCandidateScore < 1 ||
    gate.minimumCandidateScore > 5
  ) {
    throw new Error("Evaluation suite minimum candidate score must be 1-5");
  }
  if (typeof gate.allowInconclusive !== "boolean") {
    throw new Error("Evaluation suite allowInconclusive must be boolean");
  }
  return gate;
}

export function hashRunEvaluation(record: RunEvaluationRecord): string {
  return sha256(
    canonicalJson({
      threadId: record.threadId,
      leftRunId: record.leftRunId,
      rightRunId: record.rightRunId,
      leftSnapshotSha256: record.leftSnapshotSha256,
      rightSnapshotSha256: record.rightSnapshotSha256,
      rubric: record.rubric,
      scores: record.scores,
      verdict: record.verdict,
      reason: record.reason,
      evidence: record.evidence,
      evaluatorModel: record.evaluatorModel,
      ...(record.comparisonGovernance
        ? { comparisonGovernance: record.comparisonGovernance }
        : {}),
    }),
  );
}

export function hashEvaluationSuiteExecution(
  execution: Omit<
    EvaluationSuiteExecution,
    "id" | "contentSha256" | "startedAt" | "finishedAt"
  >,
): string {
  return sha256(canonicalJson(execution));
}

export function createEvaluationSuiteGateReceipt(
  store: import("./store-port.js").SuiteGateReceiptStorePort,
  threadId: string,
  suiteId: string,
): EvaluationSuiteGateReceipt {
  const suite = store.getEvaluationSuite(suiteId);
  if (suite.threadId !== threadId) {
    throw new Error("Evaluation suite does not belong to the target thread");
  }
  const execution = store
    .listEvaluationSuiteExecutions(threadId, suiteId)
    .filter((candidate) => candidate.suiteRevision === suite.revision)
    .at(-1);
  const evaluationsById = new Map(
    store
      .listRunEvaluations(threadId)
      .map((evaluation) => [evaluation.id, evaluation]),
  );
  const evaluations =
    execution?.results.map((result) => {
      const evaluation = evaluationsById.get(result.evaluationId);
      if (!evaluation) {
        throw new Error(
          `Evaluation suite receipt evidence is missing: ${result.evaluationId}`,
        );
      }
      return evaluation;
    }) ?? [];
  const content: Omit<
    EvaluationSuiteGateReceipt,
    "generatedAt" | "contentSha256"
  > = {
    kind: "napier.evaluation-gate-receipt",
    schemaVersion: 1,
    apiVersion: NAPIER_API_VERSION,
    suite,
    state: execution?.status ?? "not_run",
    evaluations,
    ...(execution ? { execution } : {}),
  };
  return {
    ...content,
    generatedAt: nowIso(),
    contentSha256: hashEvaluationSuiteGateReceipt(content),
  };
}

export function hashEvaluationSuiteGateReceipt(
  receipt: Omit<EvaluationSuiteGateReceipt, "generatedAt" | "contentSha256">,
): string {
  return sha256(canonicalJson(receipt));
}

export function validateEvaluationSuiteGateReceipt(
  value: unknown,
): EvaluationSuiteGateReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Evaluation gate receipt must be an object");
  }
  const receipt = value as EvaluationSuiteGateReceipt;
  const allowedKeys = new Set([
    "kind",
    "schemaVersion",
    "apiVersion",
    "generatedAt",
    "suite",
    "state",
    "evaluations",
    "execution",
    "contentSha256",
  ]);
  if (
    Object.keys(value).some((key) => !allowedKeys.has(key)) ||
    receipt.kind !== "napier.evaluation-gate-receipt" ||
    receipt.schemaVersion !== 1 ||
    receipt.apiVersion !== NAPIER_API_VERSION
  ) {
    throw new Error("Evaluation gate receipt envelope is invalid");
  }
  if (
    !Number.isFinite(Date.parse(receipt.generatedAt)) ||
    !/^[a-f0-9]{64}$/.test(receipt.contentSha256)
  ) {
    throw new Error("Evaluation gate receipt evidence is invalid");
  }
  assertEvaluationSuiteSnapshot(receipt.suite);
  if (!Array.isArray(receipt.evaluations)) {
    throw new Error("Evaluation gate receipt evaluations are invalid");
  }
  const states = new Set(["not_run", "passed", "failed", "inconclusive"]);
  if (!states.has(receipt.state)) {
    throw new Error("Evaluation gate receipt state is invalid");
  }
  if (receipt.state === "not_run") {
    if (receipt.execution !== undefined || receipt.evaluations.length !== 0) {
      throw new Error("Not-run evaluation gate receipt contains execution");
    }
  } else {
    if (!receipt.execution || receipt.execution.status !== receipt.state) {
      throw new Error("Evaluation gate receipt execution state is invalid");
    }
    assertReceiptExecution(
      receipt.suite,
      receipt.execution,
      receipt.evaluations,
    );
  }
  const {
    generatedAt: _generatedAt,
    contentSha256: _contentSha256,
    ...content
  } = receipt;
  if (hashEvaluationSuiteGateReceipt(content) !== receipt.contentSha256) {
    throw new Error("Evaluation gate receipt content hash mismatch");
  }
  return structuredClone(receipt);
}

function createCaseResult(
  evaluation: RunEvaluationRecord,
  gate: EvaluationSuiteGate,
): EvaluationSuiteCaseResult {
  const baselineScores = evaluation.scores.map((score) => score.leftScore);
  const candidateScores = evaluation.scores.map((score) => score.rightScore);
  const baselineAverageScore =
    baselineScores.length > 0 ? average(baselineScores) : undefined;
  const candidateAverageScore =
    candidateScores.length > 0 ? average(candidateScores) : undefined;
  const status =
    evaluation.verdict === "inconclusive" || candidateAverageScore === undefined
      ? "inconclusive"
      : (evaluation.verdict === "right_better" ||
            evaluation.verdict === "tie") &&
          candidateAverageScore >= gate.minimumCandidateScore
        ? "passed"
        : "failed";
  return {
    candidateRunId: evaluation.rightRunId,
    evaluationId: evaluation.id,
    evaluationSha256: hashRunEvaluation(evaluation),
    verdict: evaluation.verdict,
    baselineSnapshotSha256: evaluation.leftSnapshotSha256,
    candidateSnapshotSha256: evaluation.rightSnapshotSha256,
    ...(baselineAverageScore !== undefined ? { baselineAverageScore } : {}),
    ...(candidateAverageScore !== undefined ? { candidateAverageScore } : {}),
    status,
  };
}

function evaluationSuiteStatus(
  gate: EvaluationSuiteGate,
  passRate: number,
  conclusiveCount: number,
  inconclusiveCount: number,
): EvaluationSuiteExecutionStatus {
  if (
    conclusiveCount === 0 ||
    (!gate.allowInconclusive && inconclusiveCount > 0)
  ) {
    return "inconclusive";
  }
  return passRate >= gate.minimumPassRate ? "passed" : "failed";
}

function assertEvaluationSuiteSnapshot(suite: EvaluationSuite): void {
  if (
    !suite ||
    typeof suite !== "object" ||
    !/^suite_[a-z0-9]{8,80}$/.test(suite.id) ||
    !/^thread_[a-z0-9]{8,80}$/.test(suite.threadId) ||
    normalizeSuiteName(suite.name) !== suite.name ||
    normalizeRunId(suite.baselineRunId, "baseline") !== suite.baselineRunId ||
    JSON.stringify(
      normalizeCandidateRunIds(suite.candidateRunIds, suite.baselineRunId),
    ) !== JSON.stringify(suite.candidateRunIds) ||
    JSON.stringify(normalizeRubric(suite.rubric)) !==
      JSON.stringify(suite.rubric) ||
    JSON.stringify(normalizeModel(suite.evaluatorModel)) !==
      JSON.stringify(suite.evaluatorModel) ||
    JSON.stringify(normalizeEvaluationSuiteGate(suite.gate)) !==
      JSON.stringify(suite.gate) ||
    !Number.isInteger(suite.revision) ||
    suite.revision < 1 ||
    !Number.isFinite(Date.parse(suite.createdAt)) ||
    !Number.isFinite(Date.parse(suite.updatedAt)) ||
    Date.parse(suite.updatedAt) < Date.parse(suite.createdAt)
  ) {
    throw new Error("Evaluation gate receipt suite snapshot is invalid");
  }
}

function assertReceiptExecution(
  suite: EvaluationSuite,
  execution: EvaluationSuiteExecution,
  evaluations: RunEvaluationRecord[],
): void {
  if (
    !/^evalsuite_[a-z0-9]{8,80}$/.test(execution.id) ||
    execution.suiteId !== suite.id ||
    execution.suiteRevision !== suite.revision ||
    execution.threadId !== suite.threadId ||
    execution.name !== suite.name ||
    execution.baselineRunId !== suite.baselineRunId ||
    JSON.stringify(execution.candidateRunIds) !==
      JSON.stringify(suite.candidateRunIds) ||
    JSON.stringify(execution.rubric) !== JSON.stringify(suite.rubric) ||
    JSON.stringify(execution.evaluatorModel) !==
      JSON.stringify(suite.evaluatorModel) ||
    JSON.stringify(execution.gate) !== JSON.stringify(suite.gate) ||
    !Number.isFinite(Date.parse(execution.startedAt)) ||
    !Number.isFinite(Date.parse(execution.finishedAt)) ||
    Date.parse(execution.finishedAt) < Date.parse(execution.startedAt) ||
    !Array.isArray(execution.results) ||
    execution.results.length !== execution.candidateRunIds.length ||
    evaluations.length !== execution.results.length
  ) {
    throw new Error("Evaluation gate receipt execution snapshot is invalid");
  }
  const {
    id: _id,
    contentSha256: _contentSha256,
    startedAt: _startedAt,
    finishedAt: _finishedAt,
    ...executionContent
  } = execution;
  if (
    !/^[a-f0-9]{64}$/.test(execution.contentSha256) ||
    hashEvaluationSuiteExecution(executionContent) !== execution.contentSha256
  ) {
    throw new Error("Evaluation gate receipt execution hash mismatch");
  }

  const evaluationIds = new Set<string>();
  for (const [index, result] of execution.results.entries()) {
    const evaluation = evaluations[index];
    if (
      !evaluation ||
      evaluationIds.has(evaluation.id) ||
      evaluation.id !== result.evaluationId ||
      evaluation.threadId !== execution.threadId ||
      evaluation.leftRunId !== execution.baselineRunId ||
      evaluation.rightRunId !== execution.candidateRunIds[index] ||
      JSON.stringify(evaluation.rubric) !== JSON.stringify(execution.rubric) ||
      JSON.stringify(evaluation.evaluatorModel) !==
        JSON.stringify(execution.evaluatorModel) ||
      result.evaluationSha256 !== hashRunEvaluation(evaluation) ||
      JSON.stringify(createCaseResult(evaluation, execution.gate)) !==
        JSON.stringify(result)
    ) {
      throw new Error("Evaluation gate receipt case evidence is invalid");
    }
    evaluationIds.add(evaluation.id);
  }

  const passedCount = execution.results.filter(
    (result) => result.status === "passed",
  ).length;
  const failedCount = execution.results.filter(
    (result) => result.status === "failed",
  ).length;
  const inconclusiveCount =
    execution.results.length - passedCount - failedCount;
  const conclusiveCount = passedCount + failedCount;
  const passRate = conclusiveCount > 0 ? passedCount / conclusiveCount : 0;
  const candidateScores = execution.results.flatMap((result) =>
    result.candidateAverageScore === undefined
      ? []
      : [result.candidateAverageScore],
  );
  const averageCandidateScore =
    candidateScores.length > 0 ? average(candidateScores) : undefined;
  if (
    execution.passedCount !== passedCount ||
    execution.failedCount !== failedCount ||
    execution.inconclusiveCount !== inconclusiveCount ||
    execution.passRate !== passRate ||
    execution.averageCandidateScore !== averageCandidateScore ||
    execution.status !==
      evaluationSuiteStatus(
        execution.gate,
        passRate,
        conclusiveCount,
        inconclusiveCount,
      )
  ) {
    throw new Error("Evaluation gate receipt aggregate evidence is invalid");
  }
}

function normalizeSuiteName(value: string): string {
  const name = value.replace(/\s+/g, " ").trim().slice(0, 100);
  if (!name) throw new Error("Evaluation suite name is required");
  return name;
}

function normalizeCandidateRunIds(
  values: readonly string[],
  baselineRunId: string,
): string[] {
  if (!Array.isArray(values)) {
    throw new Error("Evaluation suite candidate runs are required");
  }
  const normalized = values.map((value) => normalizeRunId(value, "candidate"));
  if (
    normalized.length < 1 ||
    normalized.length > 8 ||
    new Set(normalized).size !== normalized.length ||
    normalized.includes(baselineRunId)
  ) {
    throw new Error(
      "Evaluation suite requires 1-8 unique candidates distinct from baseline",
    );
  }
  return normalized;
}

function normalizeRunId(value: string, label: string): string {
  const runId = value.trim();
  if (!/^run_[a-z0-9]{8,80}$/.test(runId)) {
    throw new Error(`Evaluation suite ${label} run ID is invalid`);
  }
  return runId;
}

function normalizeModel(value: ModelRef): ModelRef {
  const provider = value.provider.trim();
  const id = value.id.trim();
  if (!provider || !id || provider.length > 100 || id.length > 200) {
    throw new Error("Evaluation suite model is invalid");
  }
  return { provider, id };
}

function average(values: number[]): number {
  return Number(
    (values.reduce((total, value) => total + value, 0) / values.length).toFixed(
      4,
    ),
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
