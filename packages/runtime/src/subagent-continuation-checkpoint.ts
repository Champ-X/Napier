import type { RunRecord } from "@napier/contracts";
import { readSubagentWorkingSetBinding } from "./subagent-working-set-capsule.js";
import type { SubagentWorkingSetBinding } from "./subagent-working-set-types.js";

export async function readInheritedSubagentCheckpoint(dataRoot: string, run: RunRecord): Promise<SubagentWorkingSetBinding | undefined> {
  const receipt = run.subagent?.continuation;
  if (!receipt) return undefined;
  const binding = await readSubagentWorkingSetBinding(dataRoot, receipt.sourceCapsuleSha256);
  if (binding.frontier.runId !== receipt.sourceRunId || binding.frontier.taskId !== receipt.sourceTaskId ||
      binding.frontier.executionId !== receipt.sourceExecutionId || binding.frontier.parentRunId !== receipt.sourceParentRunId ||
      binding.frontier.checkpointRevision + 1 !== receipt.sourceCheckpointRevision ||
      binding.receipt.messageSetSha256 !== receipt.sourceMessageSetSha256 || binding.receipt.messageCount !== receipt.sourceMessageCount)
    throw new Error("Child continuation inherited checkpoint provenance is invalid");
  return binding;
}
