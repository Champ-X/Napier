import type { SubagentTask } from "@napier/contracts";
import { assertSubagentCompletionReceipt } from "./subagent-completion-receipt.js";
import { readSubagentCompletionCandidate } from "./subagent-completion-candidate.js";
import { formatDelegationResult, subagentTaskDetails } from "./subagent-task-evidence.js";

interface CommittedSubagentResultStore {
  dataRoot: string;
  workspaceRoot: string;
  listSubagentTasks(threadId: string, runId?: string): SubagentTask[];
}

export async function readCommittedSubagentResult(store: CommittedSubagentResultStore, task: SubagentTask) {
  const current = store.listSubagentTasks(task.threadId, task.runId).find((entry) => entry.id === task.id);
  if (!current || !task.completion || current.completion?.contentSha256 !== task.completion.contentSha256)
    throw new Error("Subagent committed result no longer matches durable Task");
  assertSubagentCompletionReceipt(current);
  const preview = await readSubagentCompletionCandidate(store, current);
  return { content: [{ type: "text" as const, text: formatDelegationResult(current, current.result ?? "", preview) }],
    details: subagentTaskDetails(current, preview) };
}

