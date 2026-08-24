import type {
  RunEvaluationRecord,
  RunEvent,
  RunRecord,
  SubagentTask,
  ThreadImportProvenance,
  ThreadRecord,
} from "@napier/contracts";
import { assertRunEvaluationGovernanceSourceBinding } from "./evaluation-governance.js";
import {
  storeCanonicalJson as canonicalJson,
  storeSha256 as sha256,
} from "./store-hashing.js";

interface PersistedRunRecord extends RunRecord {
  leaseTokenSha256?: string;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function assertEvaluationReferences(
  evaluation: RunEvaluationRecord,
  threads: ThreadRecord[],
  runs: PersistedRunRecord[],
): ThreadRecord {
  const thread = threads.find(
    (candidate) => candidate.id === evaluation.threadId,
  );
  const leftRun = runs.find(
    (candidate) => candidate.id === evaluation.leftRunId,
  );
  const rightRun = runs.find(
    (candidate) => candidate.id === evaluation.rightRunId,
  );
  const invalid =
    !/^evaluation_[a-z0-9_]{8,80}$/.test(evaluation.id) ||
    !thread ||
    !leftRun ||
    !rightRun ||
    leftRun.id === rightRun.id ||
    leftRun.threadId !== evaluation.threadId ||
    rightRun.threadId !== evaluation.threadId;
  if (invalid) {
    throw new Error(
      `Persisted Run evaluation reference is invalid: ${evaluation.id}`,
    );
  }
  return thread;
}

function assertEvaluationMetadata(evaluation: RunEvaluationRecord): void {
  const invalid =
    !isSha256(evaluation.leftSnapshotSha256) ||
    !isSha256(evaluation.rightSnapshotSha256) ||
    !Number.isFinite(Date.parse(evaluation.createdAt)) ||
    !evaluation.evaluatorModel.provider.trim() ||
    !evaluation.evaluatorModel.id.trim() ||
    !["left_better", "right_better", "tie", "inconclusive"].includes(
      evaluation.verdict,
    ) ||
    typeof evaluation.reason !== "string" ||
    !evaluation.reason.trim() ||
    evaluation.reason.length > 20_000 ||
    typeof evaluation.evidence !== "string" ||
    evaluation.evidence.length > 20_000;
  if (invalid) {
    throw new Error(`Persisted Run evaluation is invalid: ${evaluation.id}`);
  }
}

function hasValidTraceBoundary(
  governance: NonNullable<RunEvaluationRecord["comparisonGovernance"]>,
): boolean {
  const fields = [
    governance.traceSummaryBoundaryStatus,
    governance.traceSummaryBoundaryGenericDelta,
    governance.traceSummaryBoundaryDiagnosticsSha256,
    governance.traceSummaryBoundaryDeltaSha256,
  ];
  const presentCount = fields.filter((value) => value !== undefined).length;
  if (presentCount !== 0 && presentCount !== fields.length) return false;
  if (
    governance.traceSummaryBoundaryStatus !== undefined &&
    !["clean", "generic_present", "regressed"].includes(
      governance.traceSummaryBoundaryStatus,
    )
  ) {
    return false;
  }
  return (
    (governance.traceSummaryBoundaryGenericDelta === undefined ||
      Number.isSafeInteger(governance.traceSummaryBoundaryGenericDelta)) &&
    (governance.traceSummaryBoundaryDiagnosticsSha256 === undefined ||
      isSha256(governance.traceSummaryBoundaryDiagnosticsSha256)) &&
    (governance.traceSummaryBoundaryDeltaSha256 === undefined ||
      isSha256(governance.traceSummaryBoundaryDeltaSha256))
  );
}

function assertEvaluationGovernance(
  evaluation: RunEvaluationRecord,
  thread: ThreadRecord,
  subagents: SubagentTask[],
  sourceBindingEvents?: readonly RunEvent[],
): void {
  const governance = evaluation.comparisonGovernance;
  if (!governance) return;
  const { contentSha256, ...governanceContent } = governance;
  const invalid =
    governance.kind !== "napier.run-evaluation-governance" ||
    governance.schemaVersion !== 1 ||
    !["clean", "partial", "missing", "regressed"].includes(
      governance.contextCoverageStatus,
    ) ||
    !Number.isFinite(governance.contextCoverageRateDelta) ||
    !isSha256(governance.contextCoverageDiagnosticsSha256) ||
    !isSha256(governance.contextCoverageDeltaSha256) ||
    !hasValidTraceBoundary(governance) ||
    !isSha256(contentSha256) ||
    sha256(canonicalJson(governanceContent)) !== contentSha256;
  if (invalid) {
    throw new Error(
      `Persisted Run evaluation governance is invalid: ${evaluation.id}`,
    );
  }
  if (!sourceBindingEvents) return;
  assertRunEvaluationGovernanceSourceBinding({
    evaluation,
    events: sourceBindingEvents,
    subagents,
    label: `Persisted Run evaluation ${evaluation.id}`,
    skipSnapshotSourceBinding: isImportedHistoricalEvaluation(
      evaluation,
      thread.importProvenance,
    ),
  });
}

function assertEvaluationRubric(evaluation: RunEvaluationRecord): Set<string> {
  if (
    !evaluation.rubric.name.trim() ||
    evaluation.rubric.name.length > 500 ||
    !Array.isArray(evaluation.rubric.criteria) ||
    evaluation.rubric.criteria.length < 1 ||
    evaluation.rubric.criteria.length > 100 ||
    !Array.isArray(evaluation.scores) ||
    evaluation.scores.length > 100
  ) {
    throw new Error(
      `Persisted Run evaluation rubric is invalid: ${evaluation.id}`,
    );
  }
  const criterionIds = new Set<string>();
  for (const criterion of evaluation.rubric.criteria) {
    const invalid =
      !criterion.id ||
      criterion.id.length > 100 ||
      !criterion.name.trim() ||
      criterion.name.length > 500 ||
      !criterion.description.trim() ||
      criterion.description.length > 5_000 ||
      criterionIds.has(criterion.id);
    if (invalid) {
      throw new Error(
        `Persisted Run evaluation criterion is invalid: ${evaluation.id}`,
      );
    }
    criterionIds.add(criterion.id);
  }
  return criterionIds;
}

function assertEvaluationScores(
  evaluation: RunEvaluationRecord,
  criterionIds: Set<string>,
): void {
  const scoreCriterionIds = new Set<string>();
  for (const score of evaluation.scores) {
    const invalid =
      !criterionIds.has(score.criterionId) ||
      scoreCriterionIds.has(score.criterionId) ||
      !Number.isFinite(score.leftScore) ||
      score.leftScore < 1 ||
      score.leftScore > 5 ||
      !Number.isFinite(score.rightScore) ||
      score.rightScore < 1 ||
      score.rightScore > 5 ||
      !score.reason.trim() ||
      score.reason.length > 10_000;
    if (invalid) {
      throw new Error(
        `Persisted Run evaluation score is invalid: ${evaluation.id}`,
      );
    }
    scoreCriterionIds.add(score.criterionId);
  }
}

export function validatePersistedRunEvaluation(
  evaluation: RunEvaluationRecord,
  threads: ThreadRecord[],
  runs: PersistedRunRecord[],
  subagents: SubagentTask[],
  sourceBindingEvents?: readonly RunEvent[],
): void {
  const thread = assertEvaluationReferences(evaluation, threads, runs);
  assertEvaluationMetadata(evaluation);
  assertEvaluationGovernance(
    evaluation,
    thread,
    subagents,
    sourceBindingEvents,
  );
  assertEvaluationScores(evaluation, assertEvaluationRubric(evaluation));
}

function isImportedHistoricalEvaluation(
  evaluation: RunEvaluationRecord,
  importProvenance: ThreadImportProvenance | undefined,
): boolean {
  return Boolean(
    importProvenance &&
    Date.parse(evaluation.createdAt) <= Date.parse(importProvenance.importedAt),
  );
}
