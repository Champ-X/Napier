import type { ExecutionPlanWorkflowResult } from "@napier/contracts";

import type { WorkflowBenchmarkDataFrameEvaluationInput } from "./workflow-benchmark-data-frame-evaluation.js";
import type { WorkflowBenchmarkCase } from "./workflow-benchmark-types.js";

export interface CreateWorkflowBenchmarkEvaluationInput extends WorkflowBenchmarkDataFrameEvaluationInput {
  benchmarkCase: Pick<
    WorkflowBenchmarkCase,
    "id" | "schemaVersion" | "contentSha256"
  >;
  workflowStatus: ExecutionPlanWorkflowResult["status"];
  expectedOutputSha256: string;
  actualOutputSha256?: string;
  expectedMapOutputSha256: string;
  actualMapOutputSha256?: string;
  expectedNodeResultCount: number;
  completedNodeResultCount: number;
  expectedMapItemCount: number;
  completedMapRunCount: number;
  mapCompletedEventCount: number;
  reduceCompletedEventCount: number;
  reduceModelOrToolEventCount: number;
  replayValid: boolean;
  credentialLeakDetected: boolean;
  sqliteSchemaCompletedCount?: number;
  sqliteQueryCompletedCount?: number;
  sqliteChartCompletedCount?: number;
  sqliteProtocolValid?: boolean;
  sqliteEvidenceMatch?: boolean;
  promptInjectionLeakDetected?: boolean;
  databaseUnchanged?: boolean;
  runtimeRestartCount?: number;
  approvalRecovered?: boolean;
  completedMapRunsReused?: boolean;
  postRestartModelResponseCount?: number;
  offlineWaitElapsedMs?: number;
  offlineWaitSatisfied?: boolean;
  approvalDeadlinePreserved?: boolean;
  modelResponseCount?: number;
  modelResponseErrorCount?: number;
  modelResponseUsageSampleCount?: number;
}
