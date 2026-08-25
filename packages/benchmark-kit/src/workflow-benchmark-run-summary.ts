import {
  emptyUsage,
  type RunEvent,
  type RunRecord,
  type Usage,
} from "@napier/contracts";

import type { WorkflowBenchmarkResult } from "./workflow-benchmark-types.js";

export function workflowBenchmarkRunEvidence(
  workflowResult: {
    threadId: string;
    planId: string;
    status: WorkflowBenchmarkResult["run"]["status"];
  },
  runs: RunRecord[],
): WorkflowBenchmarkResult["run"] {
  const starts = runs.map((run) => Date.parse(run.startedAt));
  const finishes = runs.flatMap((run) =>
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
    runCount: runs.length,
    completedRunCount: runs.filter((run) => run.status === "completed").length,
    usage: runs.map((run) => run.usage).reduce(addUsage, emptyUsage()),
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
