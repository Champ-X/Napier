import { Agent } from "@earendil-works/pi-agent-core";
import {
  type Api,
  contentText,
  type Model,
  type MutableModels,
} from "@earendil-works/pi-ai";
import {
  emptyUsage,
  type RunEvent,
  type RunRecord,
  type SubagentLimits,
  type SubagentOutcome,
  type SubagentTask,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import type { LocalStore } from "./store.js";
import { createSubagentOutcomeRepairOutcome } from "./subagent-outcome-repair.js";
import { runSubagentOutcomeRepair } from "./subagent-outcome-repair-runtime.js";
import {
  createGroundedSubagentOutcome,
  formatSubagentOutcome,
  isRepairableSubagentOutcomeResult,
} from "./subagent-outcomes.js";
import { subagentRoleInstructions } from "./subagent-role-instructions.js";
import {
  addSubagentUsage,
  formatDelegationResult,
  MAX_SUBAGENT_RESULT_CHARS,
  MAX_SUBAGENT_STEP_CHARS,
  subagentTaskDetails,
  subagentTaskPayload,
  subagentToolResultText,
  subagentJsonValue,
  truncateSubagentText,
  type DelegationDetails,
} from "./subagent-task-evidence.js";
import type {
  SubagentWorktreeMutationManager,
  SubagentWorktreePreview,
} from "./subagent-worktree-mutation.js";
import type { SubagentWorktreeSession } from "./subagent-worktree-files.js";
import { createWorkspaceTools } from "./tools.js";

type EventSink = (event: RunEvent) => Promise<void> | void;

export class SubagentTaskRunner {
  constructor(
    private readonly options: {
      store: LocalStore;
      models: MutableModels;
      model: Model<Api>;
      run: RunRecord;
      limits: SubagentLimits;
      parentSignal: AbortSignal;
      worktrees?: SubagentWorktreeMutationManager;
      onEvent?: EventSink;
    },
  ) {}

  async execute(
    initialTask: SubagentTask,
    prompt: string,
    toolSignal?: AbortSignal,
    writePaths?: string[],
  ): Promise<{
    content: Array<{ type: "text"; text: string }>;
    details: DelegationDetails;
  }> {
    if (this.options.parentSignal.aborted || toolSignal?.aborted) {
      await this.finishAborted(
        initialTask,
        "cancelled",
        "Cancelled before start",
      );
      throw new Error("Subagent task cancelled before start");
    }
    const signals = [this.options.parentSignal, toolSignal].filter(
      (signal): signal is AbortSignal => Boolean(signal),
    );
    const worktreeSignal =
      signals.length === 1 ? signals[0]! : AbortSignal.any(signals);

    let task = await this.options.store.startSubagentTask(initialTask.id);
    let worktree: SubagentWorktreeSession | undefined;
    try {
      if (task.role === "coder") {
        if (!this.options.worktrees || !writePaths) {
          throw new Error("Coder Subagent worktree is unavailable");
        }
        worktree = await this.options.worktrees.createWorktree(
          task.id,
          writePaths,
          worktreeSignal,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const cancelled = signals.some((signal) => signal.aborted);
      task = await this.options.store.finishSubagentTask(task.id, {
        status: cancelled ? "cancelled" : "failed",
        stopReason: cancelled ? "cancelled" : "error",
        error: message,
      });
      await this.emit(
        `subagent.${cancelled ? "cancelled" : "failed"}`,
        task,
        subagentTaskPayload(task),
      );
      throw new Error(
        `Delegation ${task.id} ${cancelled ? "cancelled" : "failed"}: ${message}`,
      );
    }
    await this.emit("subagent.started", task, {
      taskId: task.id,
      role: task.role,
      description: task.description,
      status: task.status,
      limits: this.options.limits,
      ...(worktree
        ? {
            workspaceMode: "isolated_write",
            sourceSnapshotSha256: worktree.sourceSnapshotSha256,
            sourceFileCount: worktree.sourceFileCount,
            sourceBytes: worktree.sourceBytes,
            writeScopeCount: worktree.writePaths.length,
            writeScopeSetSha256: worktree.writeScopeSetSha256,
          }
        : { workspaceMode: "read_only" }),
    });

    let turnCapped = false;
    const agent = new Agent({
      initialState: {
        systemPrompt: subagentRoleInstructions(task.role),
        model: this.options.model,
        thinkingLevel: this.options.model.reasoning ? "medium" : "off",
        tools: worktree
          ? this.options.worktrees!.createCoderTools(worktree)
          : createWorkspaceTools(this.options.store.workspaceRoot),
        messages: [],
      },
      streamFn: this.options.models.streamSimple.bind(this.options.models),
      sessionId: `${this.options.run.id}:${task.id}`,
      toolExecution: "parallel",
      afterToolCall: async () => (turnCapped ? { terminate: true } : undefined),
    });

    let finalText = "";
    let lastError = "";
    let timedOut = false;
    let usage = emptyUsage();
    let stepIndex = 0;
    let outcomeRejected = false;
    agent.subscribe(async (event) => {
      if (event.type === "message_end" && event.message.role === "assistant") {
        task = await this.options.store.recordSubagentProgress(task.id, {
          turnDelta: 1,
        });
        if (
          task.turnCount >= this.options.limits.maxTurns &&
          event.message.stopReason === "toolUse"
        ) {
          turnCapped = true;
        }
        const text = contentText(event.message.content);
        if (text) finalText = text;
        if (event.message.errorMessage) lastError = event.message.errorMessage;
        usage = addSubagentUsage(usage, event.message.usage);
        stepIndex += 1;
        task = await this.options.store.recordSubagentProgress(task.id, {
          stepDelta: 1,
          usage,
        });
        const candidateOutput =
          event.message.stopReason !== "toolUse" || task.role === "coder";
        await this.emit("subagent.step", task, {
          taskId: task.id,
          messageIndex: stepIndex,
          kind: "assistant",
          ...(candidateOutput
            ? {
                textSha256: sha256(text),
                textBytes: Buffer.byteLength(text, "utf8"),
                contentRedacted: true,
              }
            : {
                text: truncateSubagentText(text, MAX_SUBAGENT_STEP_CHARS),
              }),
          toolCalls: event.message.content
            .filter((block) => block.type === "toolCall")
            .map((block) => ({
              name: block.name,
              argumentsSha256: sha256(canonicalJson(block.arguments)),
              argumentsBytes: Buffer.byteLength(
                canonicalJson(block.arguments),
                "utf8",
              ),
              argumentsRedacted: true,
            })),
        });
      }
      if (event.type === "tool_execution_end") {
        stepIndex += 1;
        task = await this.options.store.recordSubagentProgress(task.id, {
          stepDelta: 1,
        });
        const text = subagentToolResultText(event);
        await this.emit("subagent.step", task, {
          taskId: task.id,
          messageIndex: stepIndex,
          kind: "tool",
          toolName: event.toolName,
          isError: event.isError,
          textSha256: sha256(text),
          textBytes: Buffer.byteLength(text, "utf8"),
          contentRedacted: true,
        });
      }
    });

    let abortActiveAgent = (): void => agent.abort();
    const abort = (): void => abortActiveAgent();
    const activateAgent = (next: () => void): void => {
      abortActiveAgent = next;
      if (signals.some((signal) => signal.aborted)) abortActiveAgent();
    };
    signals.forEach((signal) =>
      signal.addEventListener("abort", abort, { once: true }),
    );
    const timeout = setTimeout(() => {
      timedOut = true;
      abortActiveAgent();
    }, this.options.limits.timeoutMs);
    let preview: SubagentWorktreePreview | undefined;

    try {
      if (signals.some((signal) => signal.aborted)) {
        throw new Error("Subagent task cancelled");
      }
      await agent.prompt(prompt);
      if (timedOut) throw new Error("Subagent task timed out");
      if (signals.some((signal) => signal.aborted)) {
        throw new Error("Subagent task cancelled");
      }
      if (turnCapped) {
        throw new Error(
          `Subagent turn budget exhausted (${this.options.limits.maxTurns})`,
        );
      }
      if (lastError) throw new Error(lastError);
      let outcome: SubagentOutcome;
      try {
        outcome = await this.groundOutcome(task, finalText, worktree);
      } catch (initialError) {
        const initialMessage =
          initialError instanceof Error
            ? initialError.message
            : "Unknown outcome error";
        const canRepair =
          isRepairableSubagentOutcomeResult(finalText) &&
          task.turnCount < this.options.limits.maxTurns &&
          !timedOut &&
          !signals.some((signal) => signal.aborted);
        if (!canRepair) {
          outcomeRejected = true;
          await this.recordOutcomeRejection(task, finalText, initialMessage);
          throw initialError;
        }
        outcomeRejected = true;
        const repair = await runSubagentOutcomeRepair({
          store: this.options.store,
          models: this.options.models,
          model: this.options.model,
          runId: this.options.run.id,
          limits: this.options.limits,
          task,
          predecessorResult: finalText,
          diagnostic: initialMessage,
          usage,
          activateAgent,
          emit: (type, currentTask, payload) =>
            this.emit(type, currentTask, payload),
        });
        task = repair.task;
        usage = repair.usage;
        const interruptedMessage = timedOut
          ? "Subagent outcome repair timed out"
          : signals.some((signal) => signal.aborted)
            ? "Subagent outcome repair cancelled"
            : undefined;
        if (interruptedMessage || repair.error) {
          const message =
            interruptedMessage ??
            repair.error ??
            "Subagent outcome repair failed";
          await this.emit(
            "subagent.outcome.repair.outcome",
            task,
            createSubagentOutcomeRepairOutcome({
              request: repair.request.payload,
              status: "error",
              ...(repair.resultText ? { resultText: repair.resultText } : {}),
              diagnostic: message,
            }),
          );
          await this.recordOutcomeRejection(task, repair.resultText, message);
          throw new Error(message);
        }
        finalText = repair.resultText;
        try {
          outcome = await this.groundOutcome(task, finalText, worktree);
        } catch (repairError) {
          const message =
            repairError instanceof Error
              ? repairError.message
              : "Unknown repaired outcome error";
          await this.emit(
            "subagent.outcome.repair.outcome",
            task,
            createSubagentOutcomeRepairOutcome({
              request: repair.request.payload,
              status: "rejected",
              resultText: finalText,
              diagnostic: message,
            }),
          );
          await this.recordOutcomeRejection(task, finalText, message);
          throw repairError;
        }
        await this.emit(
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
      if (worktree) {
        preview = await this.options.worktrees!.storePreview(
          worktree,
          outcome.contentSha256,
          toolSignal,
        );
        worktree = undefined;
      }
      const result = truncateSubagentText(
        formatSubagentOutcome(outcome),
        MAX_SUBAGENT_RESULT_CHARS,
      );
      task = await this.options.store.finishSubagentTask(task.id, {
        status: "completed",
        stopReason: "completed",
        result,
        outcome,
        usage,
      });
      await this.emit("subagent.outcome.accepted", task, {
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
      await this.emit(
        "subagent.completed",
        task,
        subagentTaskPayload(task, preview),
      );
      return {
        content: [
          { type: "text", text: formatDelegationResult(task, result, preview) },
        ],
        details: subagentTaskDetails(task, preview),
      };
    } catch (error) {
      const message = turnCapped
        ? `Subagent turn budget exhausted (${this.options.limits.maxTurns})`
        : error instanceof Error
          ? error.message
          : String(error);
      const status = timedOut
        ? "timed_out"
        : signals.some((signal) => signal.aborted)
          ? "cancelled"
          : "failed";
      const stopReason = timedOut
        ? "timeout"
        : status === "cancelled"
          ? "cancelled"
          : turnCapped
            ? "turn_capped"
            : "error";
      task = await this.options.store.finishSubagentTask(task.id, {
        status,
        stopReason,
        ...(!outcomeRejected && finalText
          ? {
              result: truncateSubagentText(
                finalText,
                MAX_SUBAGENT_RESULT_CHARS,
              ),
            }
          : {}),
        error: message,
        usage,
      });
      await this.emit(`subagent.${status}`, task, subagentTaskPayload(task));
      throw new Error(`Delegation ${task.id} ${status}: ${message}`);
    } finally {
      clearTimeout(timeout);
      signals.forEach((signal) => signal.removeEventListener("abort", abort));
      if (worktree) {
        await this.options.worktrees?.cleanup(worktree).catch(() => undefined);
      }
    }
  }

  private groundOutcome(
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
      workspaceRoot: worktree?.root ?? this.options.store.workspaceRoot,
    });
  }

  private async recordOutcomeRejection(
    task: SubagentTask,
    resultText: string,
    message: string,
  ): Promise<void> {
    await this.emit("subagent.outcome.rejected", task, {
      taskId: task.id,
      role: task.role,
      status: "rejected",
      resultSha256: sha256(resultText),
      diagnosticSha256: sha256(canonicalJson({ message })),
    });
  }

  private async finishAborted(
    task: SubagentTask,
    status: "cancelled" | "timed_out",
    error: string,
  ): Promise<void> {
    const finished = await this.options.store.finishSubagentTask(task.id, {
      status,
      stopReason: status === "timed_out" ? "timeout" : "cancelled",
      error,
    });
    await this.emit(
      `subagent.${status}`,
      finished,
      subagentTaskPayload(finished),
    );
  }

  private async emit(
    type: string,
    task: SubagentTask,
    payload: unknown,
  ): Promise<void> {
    const event = await this.options.store.appendEvent({
      threadId: task.threadId,
      runId: task.runId,
      type,
      category: "subagent",
      visibility: "user",
      payload: subagentJsonValue(payload),
    });
    if (this.options.onEvent) {
      try {
        await this.options.onEvent(event);
      } catch {
        // Delegation persists even when the live stream disconnects.
      }
    }
  }
}
