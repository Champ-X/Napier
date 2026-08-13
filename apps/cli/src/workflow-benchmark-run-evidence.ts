import type {
  ExecutionPlanWorkflowResult,
  JsonValue,
  RunEvent,
} from "@napier/contracts";

import {
  createWorkflowBenchmarkPromptInjectionScan,
  promptInjectionLeakDetected,
  workflowBenchmarkSqliteEvidenceMatches,
} from "./workflow-benchmark-security-evidence.js";
import {
  workflowBenchmarkSqliteActionCounts,
  workflowBenchmarkSqliteProtocolValid,
} from "./workflow-benchmark-sqlite-evidence.js";
import type {
  WorkflowBenchmarkCase,
  WorkflowBenchmarkLedgerBundle,
} from "./workflow-benchmark-types.js";

export function benchmarkPromptInjectionLeakDetected(
  benchmarkCase: WorkflowBenchmarkCase,
  projection: unknown,
): boolean {
  return (
    (benchmarkCase.schemaVersion === 3 || benchmarkCase.schemaVersion === 5) &&
    promptInjectionLeakDetected(
      projection,
      benchmarkCase.forbiddenOutputStrings,
    )
  );
}

export function workflowBenchmarkPromptInjectionOutputProjection(
  workflowResult: ExecutionPlanWorkflowResult,
  events: RunEvent[],
): JsonValue {
  return {
    workflowOutput: workflowResult.output ?? null,
    nodeOutputs: workflowResult.nodeResults.map((result) => ({
      nodeId: result.nodeId,
      output: result.output ?? null,
    })),
    assistantText: events.flatMap((event) => {
      if (event.type !== "message.assistant" || !record(event.payload)) {
        return [];
      }
      return typeof event.payload["text"] === "string"
        ? [event.payload["text"]]
        : [];
    }),
  };
}

export function workflowBenchmarkSqliteEvaluationEvidence(input: {
  benchmarkCase: WorkflowBenchmarkCase;
  sqliteActionEvents: RunEvent[];
  mapRunIds: string[];
  databaseBeforeSha256: string | undefined;
  databaseAfterSha256: string | undefined;
  injectionLeakDetected: boolean;
}) {
  if (
    input.benchmarkCase.schemaVersion !== 2 &&
    input.benchmarkCase.schemaVersion !== 3
  ) {
    return {};
  }
  const counts = workflowBenchmarkSqliteActionCounts(input.sqliteActionEvents);
  return {
    sqliteSchemaCompletedCount: counts.schema,
    sqliteQueryCompletedCount: counts.query,
    sqliteChartCompletedCount: counts.chart,
    sqliteProtocolValid: workflowBenchmarkSqliteProtocolValid(
      input.sqliteActionEvents,
      new Set(input.mapRunIds),
    ),
    databaseUnchanged:
      input.databaseBeforeSha256 !== undefined &&
      input.databaseBeforeSha256 === input.databaseAfterSha256,
    ...(input.benchmarkCase.schemaVersion === 3
      ? {
          sqliteEvidenceMatch: workflowBenchmarkSqliteEvidenceMatches(
            input.sqliteActionEvents,
            input.benchmarkCase.requiredSqliteEvidence,
          ),
          promptInjectionLeakDetected: input.injectionLeakDetected,
        }
      : {}),
  };
}

export function workflowBenchmarkSqliteLedgerEvidence(input: {
  benchmarkCase: WorkflowBenchmarkCase;
  sqliteActionEvents: RunEvent[];
  databaseBeforeSha256: string | undefined;
  databaseAfterSha256: string | undefined;
  sourceReplaySha256: string;
  outputProjectionSha256: string;
  injectionLeakDetected: boolean;
}): Pick<
  WorkflowBenchmarkLedgerBundle["workflow"],
  | "sqliteActionEvents"
  | "databaseBeforeSha256"
  | "databaseAfterSha256"
  | "requiredSqliteEvidence"
  | "promptInjectionScan"
> {
  if (
    input.benchmarkCase.schemaVersion !== 2 &&
    input.benchmarkCase.schemaVersion !== 3
  ) {
    return {};
  }
  return {
    sqliteActionEvents: input.sqliteActionEvents,
    ...(input.databaseBeforeSha256
      ? { databaseBeforeSha256: input.databaseBeforeSha256 }
      : {}),
    ...(input.databaseAfterSha256
      ? { databaseAfterSha256: input.databaseAfterSha256 }
      : {}),
    ...(input.benchmarkCase.schemaVersion === 3
      ? {
          requiredSqliteEvidence: input.benchmarkCase.requiredSqliteEvidence,
          promptInjectionScan: createWorkflowBenchmarkPromptInjectionScan({
            forbiddenOutputStrings: input.benchmarkCase.forbiddenOutputStrings,
            sourceReplaySha256: input.sourceReplaySha256,
            outputProjectionSha256: input.outputProjectionSha256,
            leakDetected: input.injectionLeakDetected,
          }),
        }
      : {}),
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
