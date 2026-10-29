import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import type { Api, Model, MutableModels } from "@earendil-works/pi-ai";
import {
  emptyUsage,
  type AgentProfile,
  type RunEvent,
  type RunRecord,
  type RegisteredRunEventTypeForCategory,
  type SubagentLimits,
  type SubagentTask,
} from "@napier/contracts";

import type { ModelRouteSession } from "./model-route.js";
import { ENVIRONMENT_DEGRADED_READ_TOOL_NAMES } from "./read-only-tool-names.js";
import type { LocalStore } from "./store.js";
import type { ToolConcurrencyGate } from "./tool-concurrency-gate.js";
import type { SubagentExecutionControl } from "./subagent-execution-control.js";
import { createSubagentStream } from "./subagent-model-stream.js";
import { createSubagentModelSession } from "./subagent-model-session.js";
import { SubagentExecutionLifetime } from "./subagent-execution-lifetime.js";
import { settleSubagentOutcome } from "./subagent-outcome-settlement.js";
import {
  subagentRoleInstructions,
  subagentRoleInstructionsForSchema,
} from "./subagent-role-instructions.js";
import {
  MAX_SUBAGENT_RESULT_CHARS,
  subagentTaskPayload,
  subagentJsonValue,
  truncateSubagentText,
  type DelegationDetails,
} from "./subagent-task-evidence.js";
import { SubagentTaskObserver } from "./subagent-task-observer.js";
import { governSubagentTools } from "./subagent-tool-execution.js";
import { settleSubagentTypedOutput } from "./subagent-typed-output-runtime.js";
import { finishSubagentTypedOutput } from "./subagent-typed-output-settlement.js";
import type { SubagentWorktreeMutationManager } from "./subagent-worktree-mutation.js";
import type { SubagentWorktreeSession } from "./subagent-worktree-files.js";
import { createWorkspaceTools } from "./tools.js";

type EventSink = (event: RunEvent) => Promise<void> | void;

export class SubagentTaskRunner {
  constructor(
    private readonly options: {
      store: LocalStore;
      models: MutableModels;
      model: Model<Api>;
      modelRoute?: ModelRouteSession;
      run: RunRecord;
      limits: SubagentLimits;
      parentCapabilities: Pick<AgentProfile, "enabledTools" | "toolPolicy">;
      parentSignal: AbortSignal;
      concurrencyGate: ToolConcurrencyGate;
      worktrees?: SubagentWorktreeMutationManager;
      createInheritedTools?: () => AgentTool[];
      control?: SubagentExecutionControl;
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
    let task = await this.options.store.startSubagentTask(initialTask.id);
    const lifetime = new SubagentExecutionLifetime(signals, this.options.limits.timeoutMs);
    lifetime.start();
    let worktree: SubagentWorktreeSession | undefined;
    let agent: Agent | undefined;
    let observer: SubagentTaskObserver | undefined;
    let turnCapped = false;
    let usage = emptyUsage();
    let outcomeRejected = false;
    let abortActiveAgent = (): void => agent?.abort();
    const abort = (): void => abortActiveAgent();
    const activateAgent = (next: () => void): void => {
      abortActiveAgent = next;
      if (lifetime.signal.aborted) abortActiveAgent();
    };
    lifetime.signal.addEventListener("abort", abort, { once: true });
    try {
      lifetime.assertActive();
      if (task.role === "coder") {
        if (!this.options.worktrees || !writePaths) {
          throw new Error("Coder Subagent worktree is unavailable");
        }
        worktree = await this.options.worktrees.createWorktree(
          task.id,
          writePaths,
          lifetime.signal,
        );
      }
      lifetime.assertActive();
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

      const modelSession = createSubagentModelSession({
        store: this.options.store,
        models: this.options.models,
        task,
        limits: this.options.limits,
        lifetime,
        assertTurnAvailable: () => observer?.assertTurnAvailable(),
        ...(this.options.modelRoute ? { modelRoute: this.options.modelRoute } : {}),
        ...(this.options.onEvent ? { onEvent: this.options.onEvent } : {}),
      });
      const tools = governSubagentTools({
        tools: createSubagentRoleTools(
          this.options.store,
          this.options.worktrees,
          this.options.createInheritedTools,
          worktree,
          this.options.parentCapabilities,
        ),
        store: this.options.store,
        run: this.options.run,
        taskId: task.id,
        executionId: task.executionId,
        concurrencyGate: this.options.concurrencyGate,
        onEvent: this.options.onEvent,
      });
      agent = new Agent({
        initialState: {
          systemPrompt: task.outputSchema
            ? subagentRoleInstructionsForSchema(task.role, task.outputSchema)
            : subagentRoleInstructions(task.role),
          model: this.options.model,
          thinkingLevel: this.options.model.reasoning ? "medium" : "off",
          tools,
          messages: [],
        },
        streamFn: createSubagentStream(modelSession),
        sessionId: `${this.options.run.id}:${task.id}`,
        toolExecution: "parallel",
        afterToolCall: async () =>
          observer?.turnCapped ? { terminate: true } : undefined,
      });

      observer = new SubagentTaskObserver(
        this.options.store,
        task,
        usage,
        this.options.limits,
        (type, currentTask, payload) => this.emit(type, currentTask, payload),
      );
      agent.subscribe((event) => observer!.observe(event));

      lifetime.assertActive();
      await this.options.control?.activate(agent);
      lifetime.assertActive();
      await agent.prompt(prompt);
      this.options.control?.deactivate(agent);
      task = observer.task;
      usage = observer.usage;
      turnCapped = observer.turnCapped;
      let finalText = observer.finalText;
      const lastError = observer.lastError;
      lifetime.assertActive();
      if (turnCapped) {
        throw new Error(
          `Subagent turn budget exhausted (${this.options.limits.maxTurns})`,
        );
      }
      if (lastError) throw new Error(lastError);
      task = await this.options.store.setSubagentSupervisorStatus(
        task.id,
        "reviewing",
      );
      lifetime.assertActive();
      if (task.outputSchema) {
        const settled = await settleSubagentTypedOutput({
          store: this.options.store,
          models: this.options.models,
          model: this.options.model,
          runId: this.options.run.id,
          limits: this.options.limits,
          task,
          resultText: finalText,
          outputSchema: task.outputSchema,
          usage,
          modelSession,
          activateAgent,
          emit: (type, currentTask, payload) =>
            this.emit(type, currentTask, payload),
        });
        task = settled.task;
        usage = settled.usage;
        finalText = settled.resultText;
        lifetime.assertActive();
        const terminal = await finishSubagentTypedOutput({
          store: this.options.store,
          ...(this.options.worktrees
            ? { worktrees: this.options.worktrees }
            : {}),
          task,
          resultText: finalText,
          output: settled.output,
          usage,
          assertActive: () => lifetime.assertActive(),
          ...(worktree ? { worktree } : {}),
          toolSignal: lifetime.signal,
          emit: (type, currentTask, payload) =>
            this.emit(type, currentTask, payload),
        });
        if (terminal.preview) worktree = undefined;
        return terminal.result;
      }
      const terminal = await settleSubagentOutcome({
        store: this.options.store,
        models: this.options.models,
        model: this.options.model,
        runId: this.options.run.id,
        limits: this.options.limits,
        task,
        resultText: finalText,
        usage,
        modelSession,
        assertActive: () => lifetime.assertActive(),
        activateAgent,
        markOutcomeRejected: () => {
          outcomeRejected = true;
        },
        emit: (type, currentTask, payload) =>
          this.emit(type, currentTask, payload),
        ...(this.options.worktrees
          ? { worktrees: this.options.worktrees }
          : {}),
        ...(worktree ? { worktree } : {}),
        toolSignal: lifetime.signal,
      });
      if (terminal.preview) worktree = undefined;
      return terminal.result;
    } catch (error) {
      const finalText = observer?.finalText ?? "";
      const durableTask = this.options.store
        .listSubagentTasks(task.threadId, task.runId)
        .find((candidate) => candidate.id === task.id);
      if (durableTask) {
        task = durableTask;
        usage = durableTask.usage;
      }
      // Completion already committed; a later delivery failure cannot rewrite
      // that fact or publish a contradictory failed/cancelled terminal event.
      if (task.status === "completed") throw error;
      turnCapped ||= observer?.turnCapped ?? false;
      const message = turnCapped
        ? `Subagent turn budget exhausted (${this.options.limits.maxTurns})`
        : error instanceof Error
          ? error.message
          : String(error);
      const status = lifetime.timedOut
        ? "timed_out"
        : signals.some((signal) => signal.aborted)
          ? "cancelled"
          : "failed";
      const stopReason = lifetime.timedOut
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
      if (agent) this.options.control?.deactivate(agent);
      lifetime.dispose();
      lifetime.signal.removeEventListener("abort", abort);
      if (worktree) {
        await this.options.worktrees?.cleanup(worktree).catch(() => undefined);
      }
    }
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
    type: RegisteredRunEventTypeForCategory<"subagent">,
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

const INHERITED_SUBAGENT_TOOL_NAMES = new Set<string>([
  ...ENVIRONMENT_DEGRADED_READ_TOOL_NAMES,
  "git_inspect",
  "workspace_file_preview",
  "lsp_diagnostics",
  "lsp_symbols",
  "lsp_definition",
  "lsp_references",
  "lsp_rename",
  "lsp_code_actions",
]);

/**
 * Subagents inherit the parent's enabled research and inspection surface.
 * Mutation remains role-owned: coders write only through their isolated
 * worktree tools, while delegation and root-workspace mutation never recurse.
 */
export function mergeSubagentTools(
  roleTools: readonly AgentTool[],
  inheritedTools: readonly AgentTool[],
): AgentTool[] {
  const merged = new Map(roleTools.map((tool) => [tool.name, tool]));
  for (const tool of inheritedTools) {
    if (
      INHERITED_SUBAGENT_TOOL_NAMES.has(tool.name) &&
      !merged.has(tool.name)
    ) {
      merged.set(tool.name, tool);
    }
  }
  return [...merged.values()];
}

function createSubagentRoleTools(
  store: LocalStore,
  worktrees: SubagentWorktreeMutationManager | undefined,
  createInheritedTools: (() => AgentTool[]) | undefined,
  worktree: SubagentWorktreeSession | undefined,
  parentCapabilities: Pick<AgentProfile, "enabledTools" | "toolPolicy">,
): AgentTool[] {
  const enabled = new Set(parentCapabilities.enabledTools);
  const roleTools = worktree
    ? worktrees!.createCoderTools(worktree)
    : createWorkspaceTools(store.workspaceRoot);
  return mergeSubagentTools(
    roleTools.filter((tool) => {
      if (tool.name !== "candidate_file") return enabled.has(tool.name);
      // This existing coder-only grant has no Profile tool name. It remains
      // confined to the candidate factory and the coder prerequisites.
      return Boolean(worktree) && parentCapabilities.toolPolicy !== "observe"
        && enabled.has("apply_patch") && enabled.has("lsp_diagnostics");
    }),
    (createInheritedTools?.() ?? []).filter((tool) =>
      // Keep only an actually constructed resource loader; skill_load alone
      // cannot manufacture the safe snapshot/access state it requires.
      enabled.has(tool.name === "skill_resource" ? "skill_load" : tool.name)),
  );
}
