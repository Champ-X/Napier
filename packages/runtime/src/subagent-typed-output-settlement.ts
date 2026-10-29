import type {
  JsonValue,
  RegisteredRunEventTypeForCategory,
  SubagentTask,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import type { LocalStore } from "./store.js";
import { completeSubagentTask } from "./subagent-completion.js";
import type { SubagentTaskFinisher } from "./subagent-child-execution.js";
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
  finishTask?: SubagentTaskFinisher;
  publishCommitted?: () => Promise<void>;
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
  const finishTask: SubagentTaskFinisher = input.finishTask ?? ((value, active) => input.store.finishSubagentTask(input.task.id, value, active));
  const finishInput = { status: "completed" as const, stopReason: "completed" as const, result: resultText, output: input.output, usage: input.usage };
  const prepared = await finishTask.prepareCompletion?.(finishInput, input.assertActive);
  const completion = await completeSubagentTask({
    taskId: input.task.id,
    ...(prepared ? { prepared } : {}),
    outcomeSha256: outputSha256,
    ...(input.worktree ? { worktree: input.worktree } : {}),
    ...(input.worktrees ? { worktrees: input.worktrees } : {}),
    ...(input.toolSignal ? { signal: input.toolSignal } : {}),
    assertActive: input.assertActive,
    isCommitted: (preview) => input.store.listSubagentTasks(input.task.threadId, input.task.runId)
      .some((current) => current.id === input.task.id && current.status === "completed" &&
        (!prepared || current.completion?.reservation.candidate?.id === preview.id) &&
        current.result === finishInput.result && current.output !== undefined && sha256(canonicalJson(current.output)) === outputSha256),
    finish: async (preview, assertActive) => {
      const task = await finishTask({ ...finishInput,
        ...(prepared ? { preparedCompletion: prepared } : {}),
        ...(prepared && preview ? { candidateId: preview.id } : {}),
      }, assertActive);
      if (task.status !== "completed") throw new Error(`Subagent task is ${task.status}`);
      return task;
    },
  });
  const { value: task, preview } = completion;
  await input.publishCommitted?.();
  if (!task.completion) {
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
  }
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
