import type { JsonValue, SubagentTask } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import type { LocalStore } from "./store.js";
import {
  formatDelegationResult,
  MAX_SUBAGENT_RESULT_CHARS,
  subagentTaskDetails,
  subagentTaskPayload,
  truncateSubagentText,
  type DelegationDetails,
} from "./subagent-task-evidence.js";
import type {
  SubagentWorktreeMutationManager,
  SubagentWorktreePreview,
} from "./subagent-worktree-mutation.js";
import type { SubagentWorktreeSession } from "./subagent-worktree-files.js";

type Emit = (type: string, task: SubagentTask, payload: unknown) => Promise<void>;

export async function finishSubagentTypedOutput(input: {
  store: LocalStore;
  worktrees?: SubagentWorktreeMutationManager;
  task: SubagentTask;
  resultText: string;
  output: JsonValue;
  usage: SubagentTask["usage"];
  worktree?: SubagentWorktreeSession;
  toolSignal?: AbortSignal;
  emit: Emit;
}): Promise<{
  result: {
    content: Array<{ type: "text"; text: string }>;
    details: DelegationDetails;
  };
  preview?: SubagentWorktreePreview;
}> {
  const outputSha256 = sha256(canonicalJson(input.output));
  const preview = input.worktree
    ? await input.worktrees!.storePreview(
        input.worktree,
        outputSha256,
        input.toolSignal,
      )
    : undefined;
  const resultText = truncateSubagentText(
    input.resultText,
    MAX_SUBAGENT_RESULT_CHARS,
  );
  const task = await input.store.finishSubagentTask(input.task.id, {
    status: "completed",
    stopReason: "completed",
    result: resultText,
    output: input.output,
    usage: input.usage,
  });
  await input.emit("subagent.output.accepted", task, {
    taskId: task.id,
    status: "accepted",
    outputSchemaSha256: task.outputSchemaSha256 ?? "",
    outputSha256,
  });
  await input.emit(
    "subagent.completed",
    task,
    subagentTaskPayload(task, preview),
  );
  return {
    result: {
      content: [
        { type: "text", text: formatDelegationResult(task, resultText, preview) },
      ],
      details: subagentTaskDetails(task, preview),
    },
    ...(preview ? { preview } : {}),
  };
}
