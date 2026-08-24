import type {
  ExecutionPlan,
  ExecutionPlanWorkflowExperimentArtifactSummary,
  ExecutionPlanWorkflowExperimentEvaluationSummary,
  RunEvaluationRecord,
} from "@napier/contracts";
import { canonicalJson, sha256 } from "./ed25519.js";

export function evaluationSummary(
  evaluations: RunEvaluationRecord[],
  runIds: string[],
): ExecutionPlanWorkflowExperimentEvaluationSummary {
  const selected = evaluations.filter(
    (evaluation) =>
      runIds.includes(evaluation.leftRunId) ||
      runIds.includes(evaluation.rightRunId),
  );
  return {
    total: selected.length,
    leftBetter: selected.filter(
      (evaluation) => evaluation.verdict === "left_better",
    ).length,
    rightBetter: selected.filter(
      (evaluation) => evaluation.verdict === "right_better",
    ).length,
    tie: selected.filter((evaluation) => evaluation.verdict === "tie").length,
    inconclusive: selected.filter(
      (evaluation) => evaluation.verdict === "inconclusive",
    ).length,
  };
}

export function artifactSummary(
  plan: ExecutionPlan,
): ExecutionPlanWorkflowExperimentArtifactSummary {
  const projection = plan.artifacts
    .map((artifact) => ({
      id: artifact.id,
      status: artifact.status,
      sha256: artifact.sha256 ?? "",
      sizeBytes: artifact.sizeBytes ?? 0,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return {
    total: projection.length,
    produced: projection.filter((artifact) => artifact.status === "produced")
      .length,
    verified: projection.filter((artifact) => artifact.status === "verified")
      .length,
    missing: projection.filter((artifact) => artifact.status === "missing")
      .length,
    setSha256: sha256(canonicalJson(projection)),
  };
}
