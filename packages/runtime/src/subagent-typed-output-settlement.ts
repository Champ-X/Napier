import type {
  JsonValue,
  RegisteredRunEventTypeForCategory,
  SubagentTask,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import type { LocalStore } from "./store.js";
import { completeSubagentTask } from "./subagent-completion.js";
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

type Emit = (
  type: RegisteredRunEventTypeForCategory<"subagent">,
  task: SubagentTask,
  payload: unknown,
) => Promise<void>;

export async function finishSubagentTypedOutput(input: {
  store: LocalStore;
  worktrees?: SubagentWorktreeMutationManager;
  task: SubagentTask;
  resultText: string;
  output: JsonValue;
  usage: SubagentTask["usage"];
  assertActive: () => void;
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
  input.assertActive();
  const outputSha256 = sha256(canonicalJson(input.output));
  const resultText = truncateSubagentText(
    input.resultText,
    MAX_SUBAGENT_RESULT_CHARS,
  );
  const completion = await completeSubagentTask({
    taskId: input.task.id,
    outcomeSha256: outputSha256,
    ...(input.worktree ? { worktree: input.worktree } : {}),
    ...(input.worktrees ? { worktrees: input.worktrees } : {}),
    ...(input.toolSignal ? { signal: input.toolSignal } : {}),
    assertActive: input.assertActive,
    isCommitted: () => input.store.listSubagentTasks(input.task.threadId, input.task.runId)
      .some((current) => current.id === input.task.id && current.status === "completed"),
    finish: async (_preview, assertActive) => {
      const task = await input.store.finishSubagentTask(input.task.id, {
        status: "completed",
        stopReason: "completed",
        result: resultText,
        output: input.output,
        usage: input.usage,
      }, assertActive);
      if (task.status !== "completed") throw new Error(`Subagent task is ${task.status}`);
      return task;
    },
  });
  const { value: task, preview } = completion;
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
        {
          type: "text",
          text: formatDelegationResult(task, resultText, preview),
        },
      ],
      details: subagentTaskDetails(task, preview),
    },
    ...(preview ? { preview } : {}),
  };
}
