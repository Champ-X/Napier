import { workflowBenchmarkBudgetEvaluationFromBundle } from "./workflow-benchmark-budget-evidence.js";
import { workflowBenchmarkDataFrameEvaluationFromBundle } from "./workflow-benchmark-data-frame-evaluation.js";
import { workflowBenchmarkModelEvaluationFromBundle } from "./workflow-benchmark-model-evidence.js";
import { workflowBenchmarkRestartEvaluationFromBundle } from "./workflow-benchmark-restart-evidence.js";
import { workflowBenchmarkSqliteEvidenceMatches } from "./workflow-benchmark-security-evidence.js";
import {
  workflowBenchmarkSqliteActionCounts,
  workflowBenchmarkSqliteProtocolValid,
} from "./workflow-benchmark-sqlite-evidence.js";
import type {
  WorkflowBenchmarkLedgerBundle,
  WorkflowBenchmarkResult,
} from "./workflow-benchmark-types.js";

export function workflowBenchmarkEvaluationEvidenceFromBundle(
  result: WorkflowBenchmarkResult,
  bundle: WorkflowBenchmarkLedgerBundle,
) {
  const version = result.evaluation.schemaVersion;
  return {
    ...sqliteEvidence(version, bundle),
    ...([4, 6, 7].includes(version)
      ? workflowBenchmarkRestartEvaluationFromBundle(bundle)
      : {}),
    ...([6, 7, 8].includes(version)
      ? workflowBenchmarkModelEvaluationFromBundle(bundle)
      : {}),
    ...(version === 8
      ? workflowBenchmarkBudgetEvaluationFromBundle(
          bundle,
          result.evaluation.expectedBudgetReason ?? "tokens",
          result.evaluation.expectedBudgetTokenLimit ?? 0,
        )
      : {}),
    ...(version === 5
      ? workflowBenchmarkDataFrameEvaluationFromBundle(bundle)
      : {}),
  };
}

function sqliteEvidence(
  version: number,
  bundle: WorkflowBenchmarkLedgerBundle,
) {
  if (version !== 2 && version !== 3) return {};
  const events = bundle.workflow.sqliteActionEvents ?? [];
  const counts = workflowBenchmarkSqliteActionCounts(events);
  return {
    sqliteSchemaCompletedCount: counts.schema,
    sqliteQueryCompletedCount: counts.query,
    sqliteChartCompletedCount: counts.chart,
    sqliteProtocolValid: workflowBenchmarkSqliteProtocolValid(
      events,
      new Set(bundle.workflow.mapRunIds),
    ),
    databaseUnchanged:
      bundle.workflow.databaseBeforeSha256 !== undefined &&
      bundle.workflow.databaseBeforeSha256 ===
        bundle.workflow.databaseAfterSha256,
    ...(version === 3
      ? {
          sqliteEvidenceMatch: workflowBenchmarkSqliteEvidenceMatches(
            events,
            bundle.workflow.requiredSqliteEvidence ?? [],
          ),
          promptInjectionLeakDetected:
            bundle.workflow.promptInjectionScan?.leakDetected ?? true,
        }
      : {}),
  };
}
