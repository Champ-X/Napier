import type { RunEvent } from "@napier/contracts";
import { canonicalJson } from "@napier/runtime";

import type {
  WorkflowBenchmarkLedgerBundle,
  WorkflowBenchmarkResult,
} from "./workflow-benchmark-types.js";

export interface WorkflowBenchmarkLedgerWorkflowInput {
  result: WorkflowBenchmarkResult["workflow"];
  status: WorkflowBenchmarkResult["run"]["status"];
  planId: string;
  mapOutputSha256?: string;
  mapRunIds: string[];
  reduceRunId: string;
  sqliteActionEvents?: RunEvent[];
  databaseBeforeSha256?: string;
  databaseAfterSha256?: string;
  requiredSqliteEvidence?: NonNullable<
    WorkflowBenchmarkLedgerBundle["workflow"]["requiredSqliteEvidence"]
  >;
  promptInjectionScan?: NonNullable<
    WorkflowBenchmarkLedgerBundle["workflow"]["promptInjectionScan"]
  >;
  restartEvent?: RunEvent;
  preRestartMapRunIds?: string[];
}

export function createWorkflowBenchmarkLedgerWorkflow(
  input: WorkflowBenchmarkLedgerWorkflowInput,
): WorkflowBenchmarkLedgerBundle["workflow"] {
  return {
    ...structuredClone(input.result),
    planId: input.planId,
    status: input.status,
    ...(input.mapOutputSha256
      ? { mapOutputSha256: input.mapOutputSha256 }
      : {}),
    mapRunIds: [...input.mapRunIds].sort(),
    reduceRunId: input.reduceRunId,
    ...(input.sqliteActionEvents
      ? {
          sqliteActionEvents: input.sqliteActionEvents
            .map((event) => structuredClone(event))
            .sort((left, right) => left.seq - right.seq),
        }
      : {}),
    ...(input.databaseBeforeSha256
      ? { databaseBeforeSha256: input.databaseBeforeSha256 }
      : {}),
    ...(input.databaseAfterSha256
      ? { databaseAfterSha256: input.databaseAfterSha256 }
      : {}),
    ...(input.requiredSqliteEvidence
      ? {
          requiredSqliteEvidence: input.requiredSqliteEvidence
            .map((expectation) => structuredClone(expectation))
            .sort((left, right) =>
              canonicalJson(left).localeCompare(canonicalJson(right)),
            ),
        }
      : {}),
    ...(input.promptInjectionScan
      ? { promptInjectionScan: structuredClone(input.promptInjectionScan) }
      : {}),
    ...(input.restartEvent
      ? { restartEvent: structuredClone(input.restartEvent) }
      : {}),
    ...(input.preRestartMapRunIds
      ? { preRestartMapRunIds: [...input.preRestartMapRunIds].sort() }
      : {}),
  };
}
