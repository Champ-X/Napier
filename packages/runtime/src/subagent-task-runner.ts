import type { SubagentModelCallServices } from "./subagent-model-call-services.js";
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
import type { LocalStore } from "./store.js";
import type { ToolConcurrencyGate } from "./tool-concurrency-gate.js";
import type { SubagentExecutionControl } from "./subagent-execution-control.js";
import { createSubagentStream } from "./subagent-model-stream.js";
import { createSubagentModelSession } from "./subagent-model-session.js";
import { SubagentExecutionLifetime } from "./subagent-execution-lifetime.js";
import { settleSubagentOutcome } from "./subagent-outcome-settlement.js";
import {
  subagentTaskPayload,
  subagentJsonValue,
  type DelegationDetails,
} from "./subagent-task-evidence.js";
import { SubagentTaskObserver } from "./subagent-task-observer.js";
import { governSubagentTools } from "./subagent-tool-execution.js";
import { settleSubagentTypedOutput } from "./subagent-typed-output-runtime.js";
import { finishSubagentTypedOutput } from "./subagent-typed-output-settlement.js";
import type { SubagentWorktreeMutationManager } from "./subagent-worktree-mutation.js";
import type { SubagentWorktreeSession } from "./subagent-worktree-files.js";
import { createWorkspaceTools } from "./tools.js";
import { authorizeSubagentChildRun } from "./subagent-child-authorization.js";
import { SubagentChildExecution } from "./subagent-child-execution.js";
import { INHERITED_SUBAGENT_TOOL_NAMES } from "./subagent-child-profile.js";
import type { SubagentExecutionCleanup, SubagentInheritedToolsFactory } from "./subagent-execution-context.js";
import { createProcessLeaseOwnerId } from "./ids.js";
import { subagentTaskFailure } from "./subagent-task-failure.js";
import { SubagentWorkingSet } from "./subagent-working-set.js";
import { SubagentRunnerRestore, type StartedSubagentChildContinuation } from "./subagent-task-restore.js";

type EventSink = (event: RunEvent) => Promise<void> | void;

export class SubagentTaskRunner {
  constructor(
    private readonly options: {
      store: LocalStore;
      models: MutableModels;
      modelCallServices?: SubagentModelCallServices;
      model: Model<Api>;
      createModelRoute?: (childRun: RunRecord) => Promise<ModelRouteSession>;
      assertParentBudgetAvailable?: () => void;
      run: RunRecord;
      limits: SubagentLimits;
      parentProfile: AgentProfile;
      parentSignal: AbortSignal;
      concurrencyGate: ToolConcurrencyGate;
      worktrees?: SubagentWorktreeMutationManager;
      createInheritedTools?: SubagentInheritedToolsFactory;
      cleanupExecutionResources?: SubagentExecutionCleanup;
      control?: SubagentExecutionControl;
      onEvent?: EventSink;
    },
  ) {}

  async execute(
    initialTask: SubagentTask,
    prompt: string,
    toolSignal?: AbortSignal,
    writePaths?: string[],
  ) {
    return this.run(initialTask, prompt, toolSignal, writePaths);
  }

  async resume(continuation: StartedSubagentChildContinuation, toolSignal?: AbortSignal) {
    const child = new SubagentChildExecution(this.options.store, continuation.execution, this.options.onEvent);
    try {
      return await this.run(continuation.execution.task, continuation.execution.task.prompt, toolSignal, undefined, continuation, child);
    } catch (error) {
      const current = this.options.store.listSubagentTasks(continuation.execution.task.threadId)
        .find((task) => task.id === continuation.execution.task.id);
      // Restoration validation happens before the common execution lifetime exists.
      // A claimed lease still owns this failure and must not leave a running successor.
      if (current?.status === "running") {
        const task = await child.finish({ status: "failed", stopReason: "error",
          error: error instanceof Error ? error.message : String(error) });
        await child.publish();
        await this.emit("subagent.failed", task, subagentTaskPayload(task));
      }
      throw error;
    } finally { child.dispose(); }
  }

  private async run(
    initialTask: SubagentTask,
    prompt: string,
    toolSignal?: AbortSignal,
    writePaths?: string[],
    continuation?: StartedSubagentChildContinuation,
    child?: SubagentChildExecution,
  ): Promise<{
    content: Array<{ type: "text"; text: string }>;
    details: DelegationDetails;
  }> {
    const restore = new SubagentRunnerRestore(continuation, this.options.run);
    await this.assertInitialTaskActive(initialTask, continuation, toolSignal);
    const signals = [this.options.parentSignal, toolSignal].filter(
      (signal): signal is AbortSignal => Boolean(signal),
    );
    let task = initialTask;
    const leaseAbort = new AbortController();
    const lifetime = new SubagentExecutionLifetime([...signals, leaseAbort.signal], this.options.limits.timeoutMs,
      restore.deadlineMs);
    lifetime.start();
    const assertActive = () => { lifetime.assertActive(); child?.assertActive(); };
    let worktree: SubagentWorktreeSession | undefined;
    let agent: Agent | undefined;
    let observer: SubagentTaskObserver | undefined;
    let turnCapped = false;
    let usage = structuredClone(initialTask.usage ?? emptyUsage());
    let outcomeRejected = false;
    let abortActiveAgent = (): void => agent?.abort();
    const abort = (): void => abortActiveAgent();
    const activateAgent = (next: () => void): void => {
      abortActiveAgent = next;
      if (lifetime.signal.aborted) abortActiveAgent();
    };
    lifetime.signal.addEventListener("abort", abort, { once: true });
    try {
      assertActive();
      await restore.prepare(this.options.store.workspaceRoot, this.options.control);
      assertActive();
      if (!task.executionId) throw new Error("Subagent Task has no execution identity");
      const started = continuation?.execution ?? await this.options.store.startSubagentChildRun({
        taskId: task.id, executionId: task.executionId,
        authorization: authorizeSubagentChildRun({
          parentRun: this.options.run, parentProfile: this.options.parentProfile,
          taskId: task.id, executionId: task.executionId, limits: this.options.limits,
        }),
        lease: { ownerId: createProcessLeaseOwnerId("subworker"), ttlMs: 60_000 },
      });
      child ??= new SubagentChildExecution(this.options.store, started, this.options.onEvent);
      child.signal.addEventListener("abort", () => leaseAbort.abort(child!.signal.reason), { once: true });
      child.startHeartbeat();
      task = started.task;
      await child.publish();
      assertActive();
      const modelRoute = await this.options.createModelRoute?.(child.run);
      if (modelRoute) task = await child.bindRoute(modelRoute.plan.id);
      assertActive();
      if (task.role === "coder") {
        if (!this.options.worktrees || !writePaths) {
          throw new Error("Coder Subagent worktree is unavailable");
        }
        worktree = await this.options.worktrees.createWorktree(
          task.id,
          writePaths,
          lifetime.signal,
          { threadId: child.run.threadId, runId: child.run.id },
        );
      }
      assertActive();
      await this.emit("subagent.started", task, {
        taskId: task.id,
        role: task.role,
        description: task.description,
        status: task.status,
        childRunId: child.run.id,
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

      const tools = governSubagentTools({
        tools: await createSubagentRoleTools(
          this.options.store,
          this.options.worktrees,
          this.options.createInheritedTools ? () => this.options.createInheritedTools!({
            executionRun: child!.run, authorityOriginRun: this.options.run,
            parentProfile: this.options.parentProfile, childProfile: started.profile, role: task.role,
          }) : undefined,
          worktree,
          started.profile,
        ),
        store: this.options.store,
        run: child.run,
        taskId: task.id,
        executionId: task.executionId,
        concurrencyGate: this.options.concurrencyGate,
        onEvent: this.options.onEvent,
        assertActive,
        ...restore.toolBindings,
      });
      const systemPrompt = started.profile.systemPrompt;
      restore.assertTools(tools);
      const modelSession = createSubagentModelSession({
        store: this.options.store,
        models: this.options.models,
        task,
        limits: this.options.limits,
        lifetime: child.lifetime(lifetime),
        child,
        modelCalls: this.options.modelCallServices?.createScope({
          run: child.run, profile: started.profile, role: task.role, tools,
        }),
        assertTurnAvailable: () => observer?.assertTurnAvailable(),
        assertParentBudgetAvailable: this.options.assertParentBudgetAvailable,
        ...(modelRoute ? { modelRoute } : {}),
        ...(this.options.onEvent ? { onEvent: this.options.onEvent } : {}),
      });
      const workingSet = new SubagentWorkingSet({ store: this.options.store, child, systemPrompt, tools,
        requireDurableCheckpoint: restore.requiresDurableCheckpoint,
        ...(this.options.control ? { control: this.options.control } : {}),
        onEvent: this.options.onEvent });
      agent = new Agent({
        initialState: {
          systemPrompt,
          model: this.options.model,
          thinkingLevel: this.options.model.reasoning ? started.profile.thinkingLevel : "off",
          tools,
          messages: restore.messages,
        },
        streamFn: createSubagentStream(modelSession),
        sessionId: `${child.run.id}:${task.id}`,
        toolExecution: "parallel",
        transformContext: async (messages) => { await workingSet.persist(messages, "before_model"); return messages; },
        afterToolCall: async () =>
          observer?.turnCapped ? { terminate: true } : undefined,
      });

      observer = new SubagentTaskObserver(
        this.options.store,
        task,
        usage,
        this.options.limits,
        (type, currentTask, payload) => this.emit(type, currentTask, payload),
        (delta) => child!.progress(delta),
        restore.budget,
      );
      await restore.hydrate(agent, observer, workingSet, this.options.control);
      agent.subscribe(async (event) => {
        if (workingSet.healthy) await observer!.observe(event);
        await workingSet.observe(event, agent!.state.messages);
      });

      assertActive();
      await this.options.control?.activate(agent);
      assertActive();
      await restore.invoke(agent, prompt);
      workingSet.assertHealthy();
      this.options.control?.deactivate(agent);
      task = observer.task;
      usage = observer.usage;
      turnCapped = observer.turnCapped;
      let finalText = observer.finalText;
      const lastError = observer.lastError;
      assertActive();
      if (turnCapped) {
        throw new Error(
          `Subagent turn budget exhausted (${this.options.limits.maxTurns})`,
        );
      }
      if (lastError) throw observer.lastFailure ?? new Error(lastError);
      task = await this.options.store.setSubagentSupervisorStatus(
        task.id,
        "reviewing",
      );
      assertActive();
      if (task.outputSchema) {
        const settled = await settleSubagentTypedOutput({
          store: this.options.store,
          models: this.options.models,
          model: this.options.model,
          runId: child.run.id,
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
        assertActive();
        const terminal = await finishSubagentTypedOutput({
          store: this.options.store,
          ...(this.options.worktrees
            ? { worktrees: this.options.worktrees }
            : {}),
          task,
          resultText: finalText,
          output: settled.output,
          usage,
          assertActive,
          finishTask: child.finish,
          publishCommitted: () => child!.publish(),
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
        runId: child.run.id,
        limits: this.options.limits,
        task,
        resultText: finalText,
        usage,
        modelSession,
        assertActive,
        finishTask: child.finish,
        publishCommitted: () => child!.publish(),
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
      const failure = subagentTaskFailure(error, {
        turnCapped, maxTurns: this.options.limits.maxTurns, timedOut: lifetime.timedOut,
        cancelled: signals.some((signal) => signal.aborted), finalText, outcomeRejected, usage,
      });
      const finish = child?.finish ?? ((input) => this.options.store.finishSubagentTask(task.id, input));
      task = await finish(failure);
      await child?.publish();
      await this.emit(`subagent.${failure.status}`, task, subagentTaskPayload(task));
      throw new Error(`Delegation ${task.id} ${failure.status}: ${failure.error}`);
    } finally {
      child?.dispose();
      if (agent) this.options.control?.deactivate(agent);
      lifetime.dispose();
      lifetime.signal.removeEventListener("abort", abort);
      if (worktree) {
        await this.options.worktrees?.cleanup(worktree).catch(() => undefined);
      }
      if (child) await this.options.cleanupExecutionResources?.(child.run);
    }
  }

  private async assertInitialTaskActive(task: SubagentTask, continuation: StartedSubagentChildContinuation | undefined,
    toolSignal: AbortSignal | undefined): Promise<void> {
    if (continuation || (!this.options.parentSignal.aborted && !toolSignal?.aborted)) return;
    await this.finishAborted(task, "cancelled", "Cancelled before start");
    throw new Error("Subagent task cancelled before start");
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
    const input = {
      threadId: task.threadId,
      runId: task.runId,
      category: "subagent" as const,
      payload: subagentJsonValue(payload),
    };
    const event = type === "subagent.continuation.unavailable" || type === "subagent.child.continuation_started"
      ? await this.options.store.appendEvent({ ...input, type, visibility: "debug" })
      : await this.options.store.appendEvent({ ...input, type });
    if (this.options.onEvent) {
      try {
        await this.options.onEvent(event);
      } catch {
        // Delegation persists even when the live stream disconnects.
      }
    }
  }
}

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

async function createSubagentRoleTools(
  store: LocalStore,
  worktrees: SubagentWorktreeMutationManager | undefined,
  createInheritedTools: (() => AgentTool[] | Promise<AgentTool[]>) | undefined,
  worktree: SubagentWorktreeSession | undefined,
  parentCapabilities: Pick<AgentProfile, "enabledTools" | "toolPolicy">,
): Promise<AgentTool[]> {
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
    (await createInheritedTools?.() ?? []).filter((tool) =>
      // Keep only an actually constructed resource loader; skill_load alone
      // cannot manufacture the safe snapshot/access state it requires.
      enabled.has(tool.name === "skill_resource" ? "skill_load" : tool.name)),
  );
}
