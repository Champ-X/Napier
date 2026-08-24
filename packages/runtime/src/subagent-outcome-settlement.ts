import type { Api, Model, MutableModels } from "@earendil-works/pi-ai";
import type {
  SubagentLimits,
  SubagentOutcome,
  SubagentTask,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import { createSubagentOutcomeRepairOutcome } from "./subagent-outcome-repair.js";
import { runSubagentOutcomeRepair } from "./subagent-outcome-repair-runtime.js";
import {
  createGroundedSubagentOutcome,
  formatSubagentOutcome,
  isRepairableSubagentOutcomeResult,
} from "./subagent-outcomes.js";
import type { LocalStore } from "./store.js";
import {
  formatDelegationResult,
  MAX_SUBAGENT_RESULT_CHARS,
  subagentTaskDetails,
  subagentTaskPayload,
  truncateSubagentText,
  type DelegationDetails,
} from "./subagent-task-evidence.js";
import type { SubagentWorktreeSession } from "./subagent-worktree-files.js";
import type {
  SubagentWorktreeMutationManager,
  SubagentWorktreePreview,
} from "./subagent-worktree-mutation.js";

type Emit = (type: string, task: SubagentTask, payload: unknown) => Promise<void>;

export async function settleSubagentOutcome(input: {
  store: LocalStore;
  models: MutableModels;
  model: Model<Api>;
  runId: string;
  limits: SubagentLimits;
  task: SubagentTask;
  resultText: string;
  usage: SubagentTask["usage"];
  timedOut: boolean;
  aborted: () => boolean;
  activateAgent: (next: () => void) => void;
  markOutcomeRejected: () => void;
  emit: Emit;
  worktrees?: SubagentWorktreeMutationManager;
  worktree?: SubagentWorktreeSession;
  toolSignal?: AbortSignal;
}): Promise<{
  result: {
    content: Array<{ type: "text"; text: string }>;
    details: DelegationDetails;
  };
  preview?: SubagentWorktreePreview;
}> {
  let task = input.task;
  let usage = input.usage;
  let finalText = input.resultText;
  let outcome: SubagentOutcome;
  try {
    outcome = await groundOutcome(input.store, task, finalText, input.worktree);
  } catch (initialError) {
    const diagnostic = errorMessage(initialError, "Unknown outcome error");
    const canRepair =
      isRepairableSubagentOutcomeResult(finalText) &&
      task.turnCount < input.limits.maxTurns &&
      !input.timedOut &&
      !input.aborted();
    input.markOutcomeRejected();
    if (!canRepair) {
      await recordOutcomeRejection(input.emit, task, finalText, diagnostic);
      throw initialError;
    }
    const repair = await runSubagentOutcomeRepair({
      store: input.store,
      models: input.models,
      model: input.model,
      runId: input.runId,
      limits: input.limits,
      task,
      predecessorResult: finalText,
      diagnostic,
      usage,
      activateAgent: input.activateAgent,
      emit: input.emit,
    });
    task = repair.task;
    usage = repair.usage;
    const interrupted = input.timedOut
      ? "Subagent outcome repair timed out"
      : input.aborted()
        ? "Subagent outcome repair cancelled"
        : undefined;
    if (interrupted || repair.error) {
      const message = interrupted ?? repair.error ?? "Subagent outcome repair failed";
      await input.emit(
        "subagent.outcome.repair.outcome",
        task,
        createSubagentOutcomeRepairOutcome({
          request: repair.request.payload,
          status: "error",
          ...(repair.resultText ? { resultText: repair.resultText } : {}),
          diagnostic: message,
        }),
      );
      await recordOutcomeRejection(input.emit, task, repair.resultText, message);
      throw new Error(message);
    }
    finalText = repair.resultText;
    try {
      outcome = await groundOutcome(input.store, task, finalText, input.worktree);
    } catch (repairError) {
      const message = errorMessage(repairError, "Unknown repaired outcome error");
      await input.emit(
        "subagent.outcome.repair.outcome",
        task,
        createSubagentOutcomeRepairOutcome({
          request: repair.request.payload,
          status: "rejected",
          resultText: finalText,
          diagnostic: message,
        }),
      );
      await recordOutcomeRejection(input.emit, task, finalText, message);
      throw repairError;
    }
    await input.emit(
      "subagent.outcome.repair.outcome",
      task,
      createSubagentOutcomeRepairOutcome({
        request: repair.request.payload,
        status: "accepted",
        resultText: finalText,
        outcomeSha256: outcome.contentSha256,
      }),
    );
  }
  const preview = input.worktree
    ? await input.worktrees!.storePreview(
        input.worktree,
        outcome.contentSha256,
        input.toolSignal,
      )
    : undefined;
  const result = truncateSubagentText(
    formatSubagentOutcome(outcome),
    MAX_SUBAGENT_RESULT_CHARS,
  );
  task = await input.store.finishSubagentTask(task.id, {
    status: "completed",
    stopReason: "completed",
    result,
    outcome,
    usage,
  });
  await input.emit("subagent.outcome.accepted", task, {
    taskId: task.id,
    role: task.role,
    status: "accepted",
    outcomeSha256: outcome.contentSha256,
    resultSha256: outcome.resultSha256,
    itemSetSha256: outcome.itemSetSha256,
    itemCount: outcome.itemCount,
    unknownCount: outcome.unknownCount,
    evidenceSetSha256: outcome.evidenceSetSha256,
    evidenceCount: outcome.evidenceCount,
  });
  await input.emit("subagent.completed", task, subagentTaskPayload(task, preview));
  return {
    result: {
      content: [{ type: "text", text: formatDelegationResult(task, result, preview) }],
      details: subagentTaskDetails(task, preview),
    },
    ...(preview ? { preview } : {}),
  };
}

function groundOutcome(
  store: LocalStore,
  task: SubagentTask,
  resultText: string,
  worktree?: SubagentWorktreeSession,
): Promise<SubagentOutcome> {
  return createGroundedSubagentOutcome({
    taskId: task.id,
    role: task.role,
    model: task.model,
    prompt: task.prompt,
    resultText,
    workspaceRoot: worktree?.root ?? store.workspaceRoot,
  });
}

async function recordOutcomeRejection(
  emit: Emit,
  task: SubagentTask,
  resultText: string,
  message: string,
): Promise<void> {
  await emit("subagent.outcome.rejected", task, {
    taskId: task.id,
    role: task.role,
    status: "rejected",
    resultSha256: sha256(resultText),
    diagnosticSha256: sha256(canonicalJson({ message })),
  });
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

