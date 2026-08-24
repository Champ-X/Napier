import type {
  EvaluationSuite,
  EvaluationSuiteExecution,
  RunEvaluationRecord,
  RunRecord,
} from "@napier/contracts";
import {
  hashEvaluationSuiteExecution,
  hashRunEvaluation,
  normalizeEvaluationSuiteGate,
} from "./evaluation-suites.js";
import { normalizeRubric } from "./evaluation.js";

interface PersistedRunRecord extends RunRecord {
  leaseTokenSha256?: string;
}

export function normalizePersistedEvaluationSuite(
  suite: EvaluationSuite,
): void {
  if (!/^suite_[a-z0-9]{8,80}$/.test(suite.id)) {
    throw new Error(`Persisted evaluation suite ID is invalid: ${suite.id}`);
  }
  suite.name = suite.name.replace(/\s+/g, " ").trim().slice(0, 100);
  if (!suite.name) {
    throw new Error(`Persisted evaluation suite name is invalid: ${suite.id}`);
  }
  if (
    !/^run_[a-z0-9]{8,80}$/.test(suite.baselineRunId) ||
    !Array.isArray(suite.candidateRunIds) ||
    suite.candidateRunIds.length < 1 ||
    suite.candidateRunIds.length > 8 ||
    new Set(suite.candidateRunIds).size !== suite.candidateRunIds.length ||
    suite.candidateRunIds.includes(suite.baselineRunId) ||
    suite.candidateRunIds.some((runId) => !/^run_[a-z0-9]{8,80}$/.test(runId))
  ) {
    throw new Error(`Persisted evaluation suite runs are invalid: ${suite.id}`);
  }
  suite.rubric = normalizeRubric(suite.rubric);
  suite.gate = normalizeEvaluationSuiteGate(suite.gate);
  suite.evaluatorModel = {
    provider: suite.evaluatorModel.provider.trim(),
    id: suite.evaluatorModel.id.trim(),
  };
  if (!suite.evaluatorModel.provider || !suite.evaluatorModel.id) {
    throw new Error(`Persisted evaluation suite model is invalid: ${suite.id}`);
  }
  if (!Number.isInteger(suite.revision) || suite.revision < 1) {
    throw new Error(
      `Persisted evaluation suite revision is invalid: ${suite.id}`,
    );
  }
  if (
    !Number.isFinite(Date.parse(suite.createdAt)) ||
    !Number.isFinite(Date.parse(suite.updatedAt))
  ) {
    throw new Error(
      `Persisted evaluation suite timestamp is invalid: ${suite.id}`,
    );
  }
}

export function assertEvaluationSuiteRuns(
  runs: PersistedRunRecord[],
  suite: Pick<
    EvaluationSuite,
    "id" | "threadId" | "baselineRunId" | "candidateRunIds"
  >,
): void {
  for (const runId of [suite.baselineRunId, ...suite.candidateRunIds]) {
    const run = runs.find((candidate) => candidate.id === runId);
    if (!run || run.threadId !== suite.threadId) {
      throw new Error(
        `Evaluation suite run must belong to the target thread: ${runId}`,
      );
    }
    if (run.status === "queued" || run.status === "running") {
      throw new Error(`Evaluation suite run must be terminal: ${runId}`);
    }
  }
}

function assertExecutionReference(
  execution: EvaluationSuiteExecution,
  suites: EvaluationSuite[],
): void {
  if (!/^evalsuite_[a-z0-9]{8,80}$/.test(execution.id)) {
    throw new Error("Evaluation suite execution ID is invalid");
  }
  const suite = suites.find((candidate) => candidate.id === execution.suiteId);
  if (
    !suite ||
    suite.threadId !== execution.threadId ||
    !Number.isInteger(execution.suiteRevision) ||
    execution.suiteRevision < 1 ||
    execution.suiteRevision > suite.revision
  ) {
    throw new Error("Evaluation suite execution references an invalid suite");
  }
}

function assertExecutionSnapshot(execution: EvaluationSuiteExecution): void {
  if (
    !execution.name.trim() ||
    execution.name.length > 100 ||
    !Array.isArray(execution.candidateRunIds) ||
    execution.candidateRunIds.length < 1 ||
    execution.candidateRunIds.length > 8 ||
    new Set(execution.candidateRunIds).size !==
      execution.candidateRunIds.length ||
    execution.candidateRunIds.includes(execution.baselineRunId)
  ) {
    throw new Error("Evaluation suite execution snapshot is invalid");
  }
}

function assertExecutionInputs(execution: EvaluationSuiteExecution): void {
  const normalizedRubric = normalizeRubric(execution.rubric);
  const normalizedGate = normalizeEvaluationSuiteGate(execution.gate);
  if (
    JSON.stringify(normalizedRubric) !== JSON.stringify(execution.rubric) ||
    JSON.stringify(normalizedGate) !== JSON.stringify(execution.gate) ||
    !execution.evaluatorModel.provider.trim() ||
    !execution.evaluatorModel.id.trim()
  ) {
    throw new Error("Evaluation suite execution inputs are invalid");
  }
}

function assertExecutionEnvelope(execution: EvaluationSuiteExecution): void {
  if (
    !Number.isFinite(Date.parse(execution.startedAt)) ||
    !Number.isFinite(Date.parse(execution.finishedAt)) ||
    Date.parse(execution.finishedAt) < Date.parse(execution.startedAt) ||
    !/^[a-f0-9]{64}$/.test(execution.contentSha256)
  ) {
    throw new Error("Evaluation suite execution evidence is invalid");
  }
  if (
    !Array.isArray(execution.results) ||
    execution.results.length !== execution.candidateRunIds.length
  ) {
    throw new Error("Evaluation suite execution results are incomplete");
  }
}

function expectedEvaluationResultStatus(
  evaluation: RunEvaluationRecord,
  candidateAverageScore: number | undefined,
  minimumCandidateScore: number,
): "passed" | "failed" | "inconclusive" {
  if (
    evaluation.verdict === "inconclusive" ||
    candidateAverageScore === undefined
  ) {
    return "inconclusive";
  }
  return (evaluation.verdict === "right_better" ||
    evaluation.verdict === "tie") &&
    candidateAverageScore >= minimumCandidateScore
    ? "passed"
    : "failed";
}

function assertExecutionResultReference(
  execution: EvaluationSuiteExecution,
  result: EvaluationSuiteExecution["results"][number],
  candidateRunId: string | undefined,
  evaluation: RunEvaluationRecord | undefined,
  evaluationIds: Set<string>,
): asserts evaluation is RunEvaluationRecord {
  const invalid =
    !candidateRunId ||
    result.candidateRunId !== candidateRunId ||
    evaluationIds.has(result.evaluationId) ||
    !evaluation ||
    evaluation.threadId !== execution.threadId ||
    evaluation.leftRunId !== execution.baselineRunId ||
    evaluation.rightRunId !== candidateRunId ||
    result.evaluationSha256 !== hashRunEvaluation(evaluation) ||
    result.verdict !== evaluation.verdict ||
    result.baselineSnapshotSha256 !== evaluation.leftSnapshotSha256 ||
    result.candidateSnapshotSha256 !== evaluation.rightSnapshotSha256;
  if (invalid) throw new Error("Evaluation suite case evidence is invalid");
}

function assertExecutionResults(
  execution: EvaluationSuiteExecution,
  evaluations: RunEvaluationRecord[],
): void {
  const evaluationIds = new Set<string>();
  for (const [index, result] of execution.results.entries()) {
    const candidateRunId = execution.candidateRunIds[index];
    const evaluation = evaluations.find(
      (candidate) => candidate.id === result.evaluationId,
    );
    assertExecutionResultReference(
      execution,
      result,
      candidateRunId,
      evaluation,
      evaluationIds,
    );
    evaluationIds.add(result.evaluationId);
    const baselineAverageScore = scoreAverage(
      evaluation.scores.map((score) => score.leftScore),
    );
    const candidateAverageScore = scoreAverage(
      evaluation.scores.map((score) => score.rightScore),
    );
    const expectedStatus = expectedEvaluationResultStatus(
      evaluation,
      candidateAverageScore,
      execution.gate.minimumCandidateScore,
    );
    if (
      result.status !== expectedStatus ||
      result.baselineAverageScore !== baselineAverageScore ||
      result.candidateAverageScore !== candidateAverageScore
    ) {
      throw new Error("Evaluation suite case aggregation is invalid");
    }
  }
}

function assertExecutionAggregate(execution: EvaluationSuiteExecution): void {
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
  const averageCandidateScore = scoreAverage(
    execution.results.flatMap((result) =>
      result.candidateAverageScore === undefined
        ? []
        : [result.candidateAverageScore],
    ),
  );
  const status =
    conclusiveCount === 0 ||
    (!execution.gate.allowInconclusive && inconclusiveCount > 0)
      ? "inconclusive"
      : passRate >= execution.gate.minimumPassRate
        ? "passed"
        : "failed";
  if (
    execution.passedCount !== passedCount ||
    execution.failedCount !== failedCount ||
    execution.inconclusiveCount !== inconclusiveCount ||
    execution.passRate !== passRate ||
    execution.averageCandidateScore !== averageCandidateScore ||
    execution.status !== status
  ) {
    throw new Error("Evaluation suite aggregate evidence is invalid");
  }
}

function assertExecutionContentHash(execution: EvaluationSuiteExecution): void {
  const {
    id: _id,
    contentSha256: _contentSha256,
    startedAt: _startedAt,
    finishedAt: _finishedAt,
    ...hashInput
  } = execution;
  if (execution.contentSha256 !== hashEvaluationSuiteExecution(hashInput)) {
    throw new Error("Evaluation suite execution content hash mismatch");
  }
}

export function validateEvaluationSuiteExecution(
  execution: EvaluationSuiteExecution,
  suites: EvaluationSuite[],
  evaluations: RunEvaluationRecord[],
  runs: PersistedRunRecord[],
): void {
  assertExecutionReference(execution, suites);
  assertExecutionSnapshot(execution);
  assertEvaluationSuiteRuns(runs, execution);
  assertExecutionInputs(execution);
  assertExecutionEnvelope(execution);
  assertExecutionResults(execution, evaluations);
  assertExecutionAggregate(execution);
  assertExecutionContentHash(execution);
}

function scoreAverage(values: number[]): number | undefined {
  return values.length > 0
    ? Number(
        (
          values.reduce((total, value) => total + value, 0) / values.length
        ).toFixed(4),
      )
    : undefined;
}
