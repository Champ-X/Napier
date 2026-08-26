import type { Api, Model, MutableModels } from "@earendil-works/pi-ai";
import type {
  JsonValue,
  RegisteredRunEventTypeForCategory,
  RunEvent,
  RunRecord,
  SubagentLimits,
  SubagentTask,
} from "@napier/contracts";
import type {
  SubagentCollectedOutcome,
  SubagentHandle,
  SubagentMessage,
  SubagentRequest,
  SubagentSnapshot,
  SubagentSupervisorStatus,
} from "@napier/contracts/subagent-supervisor";

import { canonicalJson, sha256 } from "./ed25519.js";
import { createId } from "./ids.js";
import type { ModelRouteSession, ModelRouter } from "./model-route.js";
import type { LocalStore } from "./store.js";
import { SubagentExecutionControl } from "./subagent-execution-control.js";
import {
  normalizeSubagentOutputSchema,
  subagentOutputSchemaSha256,
} from "./subagent-output-schema.js";
import type { SubagentContext, SubagentProvider } from "./subagent-provider.js";
import { SubagentTaskRunner } from "./subagent-task-runner.js";
import { subagentJsonValue } from "./subagent-task-evidence.js";
import type { SubagentWorktreeMutationManager } from "./subagent-worktree-mutation.js";

type EventSink = (event: RunEvent) => Promise<void> | void;
type RunnerResult = Awaited<ReturnType<SubagentTaskRunner["execute"]>>;

interface ActiveExecution {
  handle: SubagentHandle;
  control: SubagentExecutionControl;
  abort: AbortController;
  settled: Promise<{ result?: RunnerResult; error?: unknown }>;
}

export class InProcessSubagentProvider implements SubagentProvider {
  readonly id = "in_process";
  private readonly active = new Map<string, ActiveExecution>();

  constructor(
    private readonly options: {
      store: LocalStore;
      models: MutableModels;
      modelRouter?: ModelRouter;
      defaultModel: Model<Api>;
      run: RunRecord;
      limits: SubagentLimits;
      parentSignal: AbortSignal;
      worktrees?: SubagentWorktreeMutationManager;
      schedule?<T>(operation: () => Promise<T>): Promise<T>;
      onEvent?: EventSink;
    },
  ) {}

  async start(
    request: SubagentRequest,
    context: SubagentContext,
  ): Promise<SubagentHandle> {
    this.assertRequest(request);
    const executionId = createId("subexec");
    const { model, route } = await this.resolveRoute(request);
    const outputSchema = request.outputSchema
      ? normalizeSubagentOutputSchema(request.outputSchema)
      : undefined;
    let task = await this.options.store.createSubagentTask({
      threadId: request.threadId,
      runId: request.runId,
      role: request.role,
      description: request.description.trim(),
      prompt: request.prompt.trim(),
      model: { provider: model.provider, id: model.id },
      providerId: this.id,
      executionId,
      ...(outputSchema
        ? {
            outputSchema,
            outputSchemaSha256: subagentOutputSchemaSha256(outputSchema),
          }
        : {}),
      ...(route ? { routePlanId: route.plan.id } : {}),
      ...(request.revivedFromTaskId
        ? { revivedFromTaskId: request.revivedFromTaskId }
        : {}),
      ...(context.failureContextSha256
        ? { failureContextSha256: context.failureContextSha256 }
        : {}),
    });
    const handle: SubagentHandle = {
      kind: "napier.subagent-handle",
      schemaVersion: 1,
      providerId: this.id,
      taskId: task.id,
      executionId,
    };
    await this.emit("subagent.queued", task, {
      taskId: task.id,
      role: task.role,
      description: task.description,
      status: task.status,
      supervisorStatus: task.supervisorStatus ?? "queued",
      providerId: this.id,
      executionId,
      ...(task.routePlanId ? { routePlanId: task.routePlanId } : {}),
    });
    task = await this.options.store.setSubagentSupervisorStatus(
      task.id,
      "starting",
    );
    const abort = new AbortController();
    const unlink = linkAbortSignals(
      [this.options.parentSignal, context.signal],
      abort,
    );
    const control = new SubagentExecutionControl((message) =>
      this.recordDelivered(task, message),
    );
    const runner = new SubagentTaskRunner({
      store: this.options.store,
      models: this.options.models,
      model,
      ...(route ? { modelRoute: route } : {}),
      run: this.options.run,
      limits: this.options.limits,
      parentSignal: this.options.parentSignal,
      ...(this.options.worktrees ? { worktrees: this.options.worktrees } : {}),
      control,
      ...(this.options.onEvent ? { onEvent: this.options.onEvent } : {}),
    });
    const execute = () =>
      runner.execute(task, task.prompt, abort.signal, request.writePaths);
    const settled = Promise.resolve()
      .then(() =>
        this.options.schedule ? this.options.schedule(execute) : execute(),
      )
      .then(
        (result) => ({ result }),
        (error: unknown) => ({ error }),
      )
      .finally(unlink);
    this.active.set(executionId, { handle, control, abort, settled });
    return handle;
  }

  async send(handle: SubagentHandle, message: SubagentMessage): Promise<void> {
    const execution = this.requireActive(handle);
    const task = this.requireTask(handle);
    assertMessage(message, handle.taskId);
    if (
      isTerminal(task) ||
      task.supervisorStatus === "reviewing" ||
      task.supervisorStatus === "orphaned"
    ) {
      throw new Error("Subagent task is not accepting messages");
    }
    const duplicate = (await this.options.store.listEvents(task.threadId)).some(
      (event) =>
        event.type === "subagent.message.accepted" &&
        event.payload &&
        !Array.isArray(event.payload) &&
        typeof event.payload === "object" &&
        event.payload["id"] === message.id,
    );
    if (duplicate) throw new Error("Subagent message was already accepted");
    await this.emit("subagent.message.accepted", task, message);
    await execution.control.send(message);
  }

  async inspect(handle: SubagentHandle): Promise<SubagentSnapshot> {
    const task = this.requireTask(handle);
    const events = (await this.options.store.listEvents(task.threadId)).filter(
      (event) => messageTaskId(event.payload) === task.id,
    );
    const accepted = events.filter(
      (event) => event.type === "subagent.message.accepted",
    );
    const delivered = events.filter(
      (event) => event.type === "subagent.message.delivered",
    );
    return {
      kind: "napier.subagent-snapshot",
      schemaVersion: 1,
      handle: structuredClone(handle),
      status: task.supervisorStatus ?? supervisorStatus(task),
      taskStatus: task.status,
      role: task.role,
      model: structuredClone(task.model),
      ...(task.routePlanId ? { routePlanId: task.routePlanId } : {}),
      stepCount: task.stepCount,
      turnCount: task.turnCount,
      mailbox: {
        acceptedCount: accepted.length,
        deliveredCount: delivered.length,
        pendingCount: Math.max(0, accepted.length - delivered.length),
        ...(accepted.at(-1)
          ? { lastAcceptedAt: accepted.at(-1)!.createdAt }
          : {}),
        ...(delivered.at(-1)
          ? { lastDeliveredAt: delivered.at(-1)!.createdAt }
          : {}),
      },
      taskRevision: task.revision,
      createdAt: task.createdAt,
      ...(task.startedAt ? { startedAt: task.startedAt } : {}),
      ...(task.finishedAt ? { finishedAt: task.finishedAt } : {}),
      ...(task.stopReason ? { stopReason: task.stopReason } : {}),
      ...(task.outcome ? { outcomeSha256: task.outcome.contentSha256 } : {}),
      ...(task.error ? { errorSha256: sha256(task.error) } : {}),
    };
  }

  async cancel(handle: SubagentHandle, reason: string): Promise<void> {
    const task = this.requireTask(handle);
    if (isTerminal(task)) return;
    const execution = this.requireActive(handle);
    await this.emit("subagent.cancel.requested", task, {
      taskId: task.id,
      executionId: handle.executionId,
      reason,
      reasonSha256: sha256(reason),
    });
    execution.control.cancel();
    execution.abort.abort(reason);
    await execution.settled;
  }

  async collect(handle: SubagentHandle): Promise<SubagentCollectedOutcome> {
    const execution = this.active.get(handle.executionId);
    const settlement = execution ? await execution.settled : undefined;
    const task = this.requireTask(handle);
    const status = task.supervisorStatus ?? supervisorStatus(task);
    if (!isSupervisorTerminal(status)) {
      throw new Error("Subagent task has no in-process execution to collect");
    }
    return {
      kind: "napier.subagent-collected-outcome",
      schemaVersion: 1,
      handle: structuredClone(handle),
      status,
      task,
      ...(task.outcome ? { outcome: task.outcome } : {}),
      ...(task.output !== undefined ? { output: task.output } : {}),
      ...(task.outputSchemaSha256
        ? { outputSchemaSha256: task.outputSchemaSha256 }
        : {}),
      ...(settlement?.result
        ? { providerResult: subagentJsonValue(settlement.result) }
        : {}),
    };
  }

  private async resolveRoute(request: SubagentRequest): Promise<{
    model: Model<Api>;
    route?: ModelRouteSession;
  }> {
    const binding = request.modelRoute?.subagentRoles?.[request.role];
    if (!this.options.modelRouter) {
      if (binding) {
        throw new Error("Subagent role routing requires a model router");
      }
      return { model: this.options.defaultModel };
    }
    const model = binding
      ? await this.options.modelRouter.resolveConfigured(binding.model)
      : this.options.defaultModel;
    if (!model) throw new Error("Subagent route primary model is unavailable");
    const route = await this.options.modelRouter.createSession({
      run: this.options.run,
      primary: model,
      request: {
        role: "subagent",
        ...(binding?.fallbackModels
          ? { fallbackModels: binding.fallbackModels }
          : {}),
      },
      ...(this.options.onEvent ? { onEvent: this.options.onEvent } : {}),
    });
    return { model, route };
  }

  private assertRequest(request: SubagentRequest): void {
    if (
      request.kind !== "napier.subagent-request" ||
      request.schemaVersion !== 1 ||
      request.threadId !== this.options.run.threadId ||
      request.runId !== this.options.run.id ||
      !request.description.trim() ||
      !request.prompt.trim()
    ) {
      throw new Error("Subagent request is invalid for this provider");
    }
    if (
      (request.role === "coder" && !request.writePaths) ||
      (request.role !== "coder" && request.writePaths !== undefined)
    ) {
      throw new Error("Only coder Subagents require explicit writePaths");
    }
    if (request.revivedFromTaskId) {
      const source = this.options.store
        .listSubagentTasks(request.threadId)
        .find((task) => task.id === request.revivedFromTaskId);
      if (!source || !isTerminal(source) || source.role !== request.role) {
        throw new Error("Subagent revival source is invalid");
      }
    }
  }

  private requireTask(handle: SubagentHandle): SubagentTask {
    assertHandle(handle, this.id);
    const task = this.options.store
      .listSubagentTasks(this.options.run.threadId)
      .find((candidate) => candidate.id === handle.taskId);
    if (
      !task ||
      task.providerId !== handle.providerId ||
      task.executionId !== handle.executionId
    ) {
      throw new Error("Subagent handle binding is invalid");
    }
    return task;
  }

  private requireActive(handle: SubagentHandle): ActiveExecution {
    this.requireTask(handle);
    const execution = this.active.get(handle.executionId);
    if (!execution || execution.handle.taskId !== handle.taskId) {
      throw new Error("Subagent in-process execution is unavailable");
    }
    return execution;
  }

  private recordDelivered(
    task: SubagentTask,
    message: SubagentMessage,
  ): Promise<void> {
    return this.emit("subagent.message.delivered", task, {
      taskId: task.id,
      messageId: message.id,
      messageKind: message.messageKind,
      contentSha256: message.contentSha256,
    });
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
    try {
      await this.options.onEvent?.(event);
    } catch {
      // Durable state remains authoritative when the live stream disconnects.
    }
  }
}

function assertHandle(handle: SubagentHandle, providerId: string): void {
  if (
    handle.kind !== "napier.subagent-handle" ||
    handle.schemaVersion !== 1 ||
    handle.providerId !== providerId ||
    !handle.taskId ||
    !handle.executionId
  ) {
    throw new Error("Subagent handle is invalid");
  }
}

function assertMessage(message: SubagentMessage, taskId: string): void {
  const { contentSha256, ...content } = message;
  if (
    message.kind !== "napier.subagent-message" ||
    message.schemaVersion !== 1 ||
    message.taskId !== taskId ||
    sha256(canonicalJson(content)) !== contentSha256
  ) {
    throw new Error("Subagent message binding is invalid");
  }
}

function messageTaskId(payload: JsonValue): string | undefined {
  return payload && !Array.isArray(payload) && typeof payload === "object"
    ? typeof payload["taskId"] === "string"
      ? payload["taskId"]
      : undefined
    : undefined;
}

function isTerminal(task: SubagentTask): boolean {
  return task.status !== "pending" && task.status !== "running";
}

function supervisorStatus(task: SubagentTask): SubagentSupervisorStatus {
  if (task.status === "pending") return "queued";
  return task.status;
}

function isSupervisorTerminal(
  status: SubagentSupervisorStatus,
): status is SubagentCollectedOutcome["status"] {
  return ["completed", "failed", "cancelled", "timed_out", "orphaned"].includes(
    status,
  );
}

function linkAbortSignals(
  signals: Array<AbortSignal | undefined>,
  target: AbortController,
): () => void {
  const active = signals.filter((signal): signal is AbortSignal =>
    Boolean(signal),
  );
  const abort = (): void => target.abort();
  for (const signal of active) {
    if (signal.aborted) target.abort();
    else signal.addEventListener("abort", abort, { once: true });
  }
  return () => {
    for (const signal of active) signal.removeEventListener("abort", abort);
  };
}
