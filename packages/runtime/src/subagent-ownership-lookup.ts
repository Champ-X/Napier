import type { RunRecord, SubagentTask } from "@napier/contracts";
import { findReusableDelegation } from "./delegation-ledger.js";

/**
 * Pi Durable pattern: before creating a child for a replayable delegate tool,
 * look up an existing owned child by stable identity so recovery waits instead
 * of spawning a second conversation.
 *
 * Napier already persists delegation intent and continuation predecessors;
 * this module is the shared ownership index for those lookups.
 */
export function findOwnedSubagentByTaskId(
  tasks: readonly SubagentTask[],
  taskId: string,
): SubagentTask | undefined {
  return tasks.find((task) => task.id === taskId);
}

export function findOwnedChildRunByPredecessor(
  runs: readonly RunRecord[],
  predecessorRunId: string,
): RunRecord | undefined {
  return runs.find(
    (run) => run.subagent?.continuation?.predecessorRunId === predecessorRunId,
  );
}

export function findOwnedSubagentByDelegationIntent(
  tasks: SubagentTask[],
  role: SubagentTask["role"],
  prompt: string,
  options: { failureContextSha256?: string } = {},
): SubagentTask | undefined {
  return findReusableDelegation(tasks, role, prompt, options);
}
