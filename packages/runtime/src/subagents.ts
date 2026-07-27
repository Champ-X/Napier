import {
  Agent,
  type AgentEvent,
  type AgentTool,
} from "@earendil-works/pi-agent-core";
import {
  type Api,
  contentText,
  type Model,
  type MutableModels,
  type Usage as PiUsage,
} from "@earendil-works/pi-ai";
import {
  emptyUsage,
  type AgentProfile,
  type RunEvent,
  type RunRecord,
  type SubagentLimits,
  type SubagentOutcome,
  type SubagentRole,
  type SubagentTask,
  type Usage,
} from "@napier/contracts";
import { Type } from "typebox";

import { DEFAULT_SUBAGENT_LIMITS, normalizeSubagentLimits } from "./agents.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import type { LocalStore } from "./store.js";
import {
  createSubagentOutcomeRepairOutcome,
  createSubagentOutcomeRepairRequest,
  MAX_SUBAGENT_OUTCOME_REPAIR_ATTEMPTS,
  type SubagentOutcomeRepairRequest,
} from "./subagent-outcome-repair.js";
import {
  createGroundedSubagentOutcome,
  formatSubagentOutcome,
  isRepairableSubagentOutcomeResult,
  subagentRoleInstructions,
} from "./subagent-outcomes.js";
import { createWorkspaceTools } from "./tools.js";

const delegateTaskSchema = Type.Object({
  role: Type.Union([
    Type.Literal("researcher"),
    Type.Literal("reviewer"),
    Type.Literal("general"),
  ]),
  description: Type.String({
    minLength: 1,
    maxLength: 180,
    description: "Short task label shown in the delegation ledger.",
  }),
  task: Type.String({
    minLength: 1,
    maxLength: 8_000,
    description:
      "Self-contained task with relevant paths, constraints, and expected evidence.",
  }),
});

const DEFAULT_ROLES: SubagentRole[] = ["researcher", "reviewer", "general"];
const MAX_STEP_CHARS = 8_192;
const MAX_RESULT_CHARS = 12_000;

type EventSink = (event: RunEvent) => Promise<void> | void;

export interface SubagentCoordinatorOptions {
  store: LocalStore;
  models: MutableModels;
  model: Model<Api>;
  run: RunRecord;
  profile: AgentProfile;
  parentSignal: AbortSignal;
  onEvent?: EventSink;
}

interface DelegationDetails {
  taskId: string;
  role: SubagentRole;
  status: SubagentTask["status"];
  turnCount: number;
  stepCount: number;
  stopReason?: SubagentTask["stopReason"];
  outcomeSha256?: string;
  itemCount?: number;
  evidenceCount?: number;
}

interface OutcomeRepairInvocation {
  task: SubagentTask;
  usage: Usage;
  request: SubagentOutcomeRepairRequest;
  resultText: string;
  error?: string;
}

class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active += 1;
    try {
      return await operation();
    } finally {
      this.active -= 1;
      this.queue.shift()?.();
    }
  }
}

export class SubagentCoordinator {
  private readonly limits: SubagentLimits;
  private readonly enabledRoles: Set<SubagentRole>;
  private readonly semaphore: Semaphore;
  private totalDelegations = 0;

  constructor(private readonly options: SubagentCoordinatorOptions) {
    this.limits = normalizeSubagentLimits(
      options.profile.subagentLimits ??
        structuredClone(DEFAULT_SUBAGENT_LIMITS),
    );
    this.enabledRoles = new Set(
      options.profile.enabledSubagents ?? DEFAULT_ROLES,
    );
    this.semaphore = new Semaphore(this.limits.maxConcurrent);
  }

  hasEnabledRoles(): boolean {
    return this.enabledRoles.size > 0;
  }

  createTool(): AgentTool<typeof delegateTaskSchema, DelegationDetails> {
    return {
      name: "delegate_task",
      label: "Delegate task",
      description: [
        "Delegate a substantial independent investigation or review to an isolated subagent.",
        `Available roles: ${[...this.enabledRoles].join(", ")}.`,
        `Run budget: at most ${this.limits.maxTotal} total and ${this.limits.maxConcurrent} concurrent delegations.`,
        "Do not delegate trivial work or tasks that require the parent conversation.",
      ].join(" "),
      parameters: delegateTaskSchema,
      execute: async (_toolCallId, input, signal) => {
        if (!this.enabledRoles.has(input.role)) {
          throw new Error(`Subagent role is disabled: ${input.role}`);
        }
        if (this.totalDelegations >= this.limits.maxTotal) {
          throw new Error(
            `Subagent total budget exhausted (${this.limits.maxTotal})`,
          );
        }
        this.totalDelegations += 1;
        const task = await this.options.store.createSubagentTask({
          threadId: this.options.run.threadId,
          runId: this.options.run.id,
          role: input.role,
          description: input.description.trim(),
          prompt: input.task.trim(),
          model: {
            provider: this.options.model.provider,
            id: this.options.model.id,
          },
        });
        await this.emit("subagent.queued", task, {
          taskId: task.id,
          role: task.role,
          description: task.description,
          status: task.status,
        });
        return this.semaphore.run(() =>
          this.executeTask(task, task.prompt, signal),
        );
      },
    };
  }

  private async executeTask(
    initialTask: SubagentTask,
    prompt: string,
    toolSignal?: AbortSignal,
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

    let task = await this.options.store.startSubagentTask(initialTask.id);
    await this.emit("subagent.started", task, {
      taskId: task.id,
      role: task.role,
      description: task.description,
      status: task.status,
      limits: this.limits,
    });

    let turnCapped = false;
    const agent = new Agent({
      initialState: {
        systemPrompt: subagentRoleInstructions(task.role),
        model: this.options.model,
        thinkingLevel: this.options.model.reasoning ? "medium" : "off",
        tools: createWorkspaceTools(this.options.store.workspaceRoot),
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
          task.turnCount >= this.limits.maxTurns &&
          event.message.role === "assistant" &&
          event.message.stopReason === "toolUse"
        ) {
          turnCapped = true;
        }
        const text = contentText(event.message.content);
        if (text) finalText = text;
        if (event.message.errorMessage) lastError = event.message.errorMessage;
        usage = addUsage(usage, event.message.usage);
        stepIndex += 1;
        task = await this.options.store.recordSubagentProgress(task.id, {
          stepDelta: 1,
          usage,
        });
        const candidateOutput = event.message.stopReason !== "toolUse";
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
            : { text: truncate(text, MAX_STEP_CHARS) }),
          toolCalls: event.message.content
            .filter((block) => block.type === "toolCall")
            .map((block) => ({ name: block.name, arguments: block.arguments })),
        });
      }
      if (event.type === "tool_execution_end") {
        stepIndex += 1;
        task = await this.options.store.recordSubagentProgress(task.id, {
          stepDelta: 1,
        });
        await this.emit("subagent.step", task, {
          taskId: task.id,
          messageIndex: stepIndex,
          kind: "tool",
          toolName: event.toolName,
          isError: event.isError,
          text: truncate(toolResultText(event), MAX_STEP_CHARS),
        });
      }
    });

    let abortActiveAgent = (): void => agent.abort();
    const signals = [this.options.parentSignal, toolSignal].filter(
      (signal): signal is AbortSignal => Boolean(signal),
    );
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
    }, this.limits.timeoutMs);

    try {
      await agent.prompt(prompt);
      if (timedOut) throw new Error("Subagent task timed out");
      if (signals.some((signal) => signal.aborted)) {
        throw new Error("Subagent task cancelled");
      }
      if (turnCapped) {
        throw new Error(
          `Subagent turn budget exhausted (${this.limits.maxTurns})`,
        );
      }
      if (lastError) throw new Error(lastError);
      let outcome: SubagentOutcome;
      try {
        outcome = await createGroundedSubagentOutcome({
          taskId: task.id,
          role: task.role,
          model: task.model,
          prompt: task.prompt,
          resultText: finalText,
          workspaceRoot: this.options.store.workspaceRoot,
        });
      } catch (initialError) {
        const initialMessage =
          initialError instanceof Error
            ? initialError.message
            : "Unknown outcome error";
        const canRepair =
          isRepairableSubagentOutcomeResult(finalText) &&
          task.turnCount < this.limits.maxTurns &&
          !timedOut &&
          !signals.some((signal) => signal.aborted);
        if (!canRepair) {
          outcomeRejected = true;
          await this.recordOutcomeRejection(task, finalText, initialMessage);
          throw initialError;
        }

        outcomeRejected = true;
        const repair = await this.invokeOutcomeRepair(
          task,
          finalText,
          initialMessage,
          usage,
          activateAgent,
        );
        task = repair.task;
        usage = repair.usage;
        const interruptedMessage = timedOut
          ? "Subagent outcome repair timed out"
          : signals.some((signal) => signal.aborted)
            ? "Subagent outcome repair cancelled"
            : undefined;
        if (interruptedMessage || repair.error) {
          outcomeRejected = true;
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
          outcome = await createGroundedSubagentOutcome({
            taskId: task.id,
            role: task.role,
            model: task.model,
            prompt: task.prompt,
            resultText: finalText,
            workspaceRoot: this.options.store.workspaceRoot,
          });
        } catch (repairError) {
          outcomeRejected = true;
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
      const result = truncate(formatSubagentOutcome(outcome), MAX_RESULT_CHARS);
      task = await this.options.store.finishSubagentTask(task.id, {
        status: "completed",
        stopReason: turnCapped ? "turn_capped" : "completed",
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
      await this.emit("subagent.completed", task, taskPayload(task));
      return {
        content: [
          {
            type: "text",
            text: `Delegation ${task.id} (${task.role}) completed.\n\n${result}`,
          },
        ],
        details: taskDetails(task),
      };
    } catch (error) {
      const message = turnCapped
        ? `Subagent turn budget exhausted (${this.limits.maxTurns})`
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
          ? { result: truncate(finalText, MAX_RESULT_CHARS) }
          : {}),
        error: message,
        usage,
      });
      await this.emit(`subagent.${status}`, task, taskPayload(task));
      throw new Error(`Delegation ${task.id} ${status}: ${message}`);
    } finally {
      clearTimeout(timeout);
      signals.forEach((signal) => signal.removeEventListener("abort", abort));
    }
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

  private async invokeOutcomeRepair(
    task: SubagentTask,
    predecessorResult: string,
    diagnostic: string,
    usage: Usage,
    activateAgent: (abort: () => void) => void,
  ): Promise<OutcomeRepairInvocation> {
    const request = createSubagentOutcomeRepairRequest({
      taskId: task.id,
      role: task.role,
      model: task.model,
      taskPrompt: task.prompt,
      predecessorResult,
      diagnostic,
      attempt: 1,
      maxAttempts: MAX_SUBAGENT_OUTCOME_REPAIR_ATTEMPTS,
    });
    await this.emit("subagent.outcome.repair.requested", task, request.payload);

    let currentTask = task;
    let currentUsage = usage;
    let resultText = "";
    let messageError = "";
    let toolCallCount = 0;
    const repairAgent = new Agent({
      initialState: {
        systemPrompt: request.instructions,
        model: this.options.model,
        thinkingLevel: "off",
        tools: [],
        messages: [],
      },
      streamFn: this.options.models.streamSimple.bind(this.options.models),
      sessionId: `${this.options.run.id}:${task.id}:outcome-repair:1`,
      toolExecution: "parallel",
      afterToolCall: async () => ({ terminate: true }),
    });
    repairAgent.subscribe(async (event) => {
      if (event.type !== "message_end" || event.message.role !== "assistant") {
        return;
      }
      resultText = contentText(event.message.content);
      messageError = event.message.errorMessage ?? "";
      toolCallCount = event.message.content.filter(
        (block) => block.type === "toolCall",
      ).length;
      currentUsage = addUsage(currentUsage, event.message.usage);
      currentTask = await this.options.store.recordSubagentProgress(task.id, {
        turnDelta: 1,
        stepDelta: 1,
        usage: currentUsage,
      });
      await this.emit("subagent.step", currentTask, {
        taskId: task.id,
        messageIndex: currentTask.stepCount,
        kind: "outcome_repair",
        attempt: request.payload.attempt,
        textSha256: sha256(resultText),
        textBytes: Buffer.byteLength(resultText, "utf8"),
        contentRedacted: true,
        toolCallCount,
      });
    });
    activateAgent(() => repairAgent.abort());

    let invocationError = "";
    try {
      await repairAgent.prompt(request.prompt);
    } catch (error) {
      invocationError = error instanceof Error ? error.message : String(error);
    }
    const error =
      invocationError ||
      messageError ||
      (toolCallCount > 0
        ? "Subagent outcome repair returned a tool call"
        : currentTask.turnCount > this.limits.maxTurns
          ? `Subagent turn budget exhausted (${this.limits.maxTurns})`
          : "");
    return {
      task: currentTask,
      usage: currentUsage,
      request,
      resultText,
      ...(error ? { error } : {}),
    };
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
    await this.emit(`subagent.${status}`, finished, taskPayload(finished));
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
      payload: toJsonValue(payload),
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

function taskPayload(task: SubagentTask): Record<string, unknown> {
  return {
    taskId: task.id,
    role: task.role,
    description: task.description,
    status: task.status,
    result: task.result ?? "",
    error: task.error ?? "",
    stopReason: task.stopReason ?? "",
    stepCount: task.stepCount,
    turnCount: task.turnCount,
    usage: task.usage,
    ...(task.outcome ? { outcome: task.outcome } : {}),
  };
}

function taskDetails(task: SubagentTask): DelegationDetails {
  return {
    taskId: task.id,
    role: task.role,
    status: task.status,
    turnCount: task.turnCount,
    stepCount: task.stepCount,
    ...(task.stopReason ? { stopReason: task.stopReason } : {}),
    ...(task.outcome
      ? {
          outcomeSha256: task.outcome.contentSha256,
          itemCount: task.outcome.itemCount,
          evidenceCount: task.outcome.evidenceCount,
        }
      : {}),
  };
}

function addUsage(current: Usage, update: PiUsage): Usage {
  return {
    inputTokens: current.inputTokens + update.input,
    outputTokens: current.outputTokens + update.output,
    cacheReadTokens: current.cacheReadTokens + update.cacheRead,
    cacheWriteTokens: current.cacheWriteTokens + update.cacheWrite,
    costUsd: current.costUsd + update.cost.total,
  };
}

function truncate(value: string, maxCharacters: number): string {
  return value.length <= maxCharacters
    ? value
    : `${value.slice(0, Math.max(0, maxCharacters - 14))}\n[truncated]`;
}

function toolResultText(
  event: Extract<AgentEvent, { type: "tool_execution_end" }>,
): string {
  const result = event.result as { content?: unknown };
  if (!Array.isArray(result?.content)) return String(event.result ?? "");
  return result.content
    .flatMap((item): string[] => {
      if (
        item &&
        typeof item === "object" &&
        "type" in item &&
        item.type === "text" &&
        "text" in item &&
        typeof item.text === "string"
      ) {
        return [item.text];
      }
      return [];
    })
    .join("\n");
}

function toJsonValue(value: unknown): import("@napier/contracts").JsonValue {
  try {
    return JSON.parse(
      JSON.stringify(value),
    ) as import("@napier/contracts").JsonValue;
  } catch {
    return String(value);
  }
}
