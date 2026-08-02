import type { RunEvent } from "@napier/contracts";

import { createWorkflowBenchmarkPromptInjectionScan } from "./workflow-benchmark-security-evidence.js";
import {
  workflowBenchmarkDataFrameActionCounts,
  workflowBenchmarkDataFrameEvidenceMatches,
  workflowBenchmarkDataFrameProtocolValid,
} from "./workflow-benchmark-data-frame-evidence.js";
import type {
  WorkflowBenchmarkCase,
  WorkflowBenchmarkLedgerBundle,
} from "./workflow-benchmark-types.js";

export function workflowBenchmarkDataFrameEvaluationEvidence(input: {
  benchmarkCase: WorkflowBenchmarkCase;
  dataFrameActionEvents: RunEvent[];
  mapRunIds: string[];
  sourceBeforeSha256: string | undefined;
  sourceAfterSha256: string | undefined;
  injectionLeakDetected: boolean;
}) {
  if (input.benchmarkCase.schemaVersion !== 5) return {};
  const counts = workflowBenchmarkDataFrameActionCounts(
    input.dataFrameActionEvents,
  );
  return {
    inspectDataCompletedCount: counts.inspect,
    dataFrameCompletedCount: counts.transform,
    dataFrameProtocolValid:
      input.sourceBeforeSha256 !== undefined &&
      workflowBenchmarkDataFrameProtocolValid(
        input.dataFrameActionEvents,
        new Set(input.mapRunIds),
        input.sourceBeforeSha256,
      ),
    dataFrameEvidenceMatch: workflowBenchmarkDataFrameEvidenceMatches(
      input.dataFrameActionEvents,
      input.benchmarkCase.requiredDataFrameEvidence,
    ),
    dataSourceUnchanged:
      input.sourceBeforeSha256 !== undefined &&
      input.sourceBeforeSha256 === input.sourceAfterSha256,
    promptInjectionLeakDetected: input.injectionLeakDetected,
  };
}

export function workflowBenchmarkDataFrameLedgerEvidence(input: {
  benchmarkCase: WorkflowBenchmarkCase;
  dataFrameActionEvents: RunEvent[];
  sourceBeforeSha256: string | undefined;
  sourceAfterSha256: string | undefined;
  sourceReplaySha256: string;
  outputProjectionSha256: string;
  injectionLeakDetected: boolean;
}): Pick<
  WorkflowBenchmarkLedgerBundle["workflow"],
  | "dataFrameActionEvents"
  | "dataSourceBeforeSha256"
  | "dataSourceAfterSha256"
  | "requiredDataFrameEvidence"
  | "promptInjectionScan"
> {
  if (input.benchmarkCase.schemaVersion !== 5) return {};
  return {
    dataFrameActionEvents: input.dataFrameActionEvents,
    ...(input.sourceBeforeSha256
      ? { dataSourceBeforeSha256: input.sourceBeforeSha256 }
      : {}),
    ...(input.sourceAfterSha256
      ? { dataSourceAfterSha256: input.sourceAfterSha256 }
      : {}),
    requiredDataFrameEvidence: input.benchmarkCase.requiredDataFrameEvidence,
    promptInjectionScan: createWorkflowBenchmarkPromptInjectionScan({
      forbiddenOutputStrings: input.benchmarkCase.forbiddenOutputStrings,
      sourceReplaySha256: input.sourceReplaySha256,
      outputProjectionSha256: input.outputProjectionSha256,
      leakDetected: input.injectionLeakDetected,
    }),
  };
}
