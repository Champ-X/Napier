import type { SubagentTask } from "@napier/contracts";
import { findReusableDelegation } from "./delegation-ledger.js";

/**
 * Pi Durable pattern: before creating a child for a replayable delegate tool,
 * look up an existing owned child by stable delegation identity so recovery
 * waits instead of spawning a second conversation.
 */
export function findOwnedSubagentByDelegationIntent(
  tasks: SubagentTask[],
  role: SubagentTask["role"],
  prompt: string,
  options: { failureContextSha256?: string } = {},
): SubagentTask | undefined {
  return findReusableDelegation(tasks, role, prompt, options);
}
