import {
  emptyUsage,
  type RunEvent,
  type RunRecord,
  type Usage,
} from "@napier/contracts";
import { isSubagentChildRun } from "@napier/contracts/task-narrative";

import type { WorkflowBenchmarkResult } from "./workflow-benchmark-types.js";

export function workflowBenchmarkRunEvidence(
  workflowResult: {
    threadId: string;
    planId: string;
    status: WorkflowBenchmarkResult["run"]["status"];
  },
  runs: RunRecord[],
): WorkflowBenchmarkResult["run"] {
  if (runs.some((run) => run.usageStatus === "incomplete"))
    throw new Error("Workflow benchmark usage is incomplete");
  const primaryRuns = runs.filter((run) => !isSubagentChildRun(run));
  const starts = primaryRuns.map((run) => Date.parse(run.startedAt));
  const finishes = primaryRuns.flatMap((run) =>
    run.finishedAt ? [Date.parse(run.finishedAt)] : [],
  );
  return {
    threadId: workflowResult.threadId,
    planId: workflowResult.planId,
    status: workflowResult.status,
    durationMs:
      starts.length > 0 && finishes.length > 0
        ? Math.max(0, Math.max(...finishes) - Math.min(...starts))
        : 0,
    runCount: primaryRuns.length,
    completedRunCount: primaryRuns.filter((run) => run.status === "completed").length,
    usage: primaryRuns.map((run) => run.usage).reduce(addUsage, emptyUsage()),
  };
}

export function countWorkflowBenchmarkEvents(
  events: RunEvent[],
  type: string,
): number {
  return events.filter((event) => event.type === type).length;
}

function addUsage(left: Usage, right: Usage): Usage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
    costUsd: left.costUsd + right.costUsd,
  };
}
