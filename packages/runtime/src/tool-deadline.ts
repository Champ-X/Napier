import type {
  AgentTool,
  AgentToolResult,
  AgentToolUpdateCallback,
} from "@earendil-works/pi-agent-core";
import type { JsonObject, RunEvent, RunRecord } from "@napier/contracts";

import { preserveAgentToolIdentity } from "./agent-tool-metadata.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import type { EventSink } from "./event-sink.js";
import type { ModelRegistry } from "./models.js";
import type { RunBudgetTracker } from "./run-budget.js";
import type { LocalStore } from "./store.js";
import { createToolCallSha256 } from "./tool-loop-guard.js";
import type { ToolProtocolRegistry } from "./tool-protocol-registry.js";
import {
  DEFAULT_TOOL_DEADLINE_POLICY,
  TOOL_MINIMUM_DEADLINE_MS,
  ToolDeadlineError,
  type ToolDeadlineEvidence,
  type ToolDeadlinePolicy,
  type ToolDeadlineReason,
  type ToolEffectJournalEvidence,
  type ToolEffectState,
  type ToolMinimumDeadline,
  ToolNotStartedError,
} from "./tool-deadline-policy.js";
export {
  ToolDeadlineError,
  ToolNotStartedError,
} from "./tool-deadline-policy.js";

export class ToolDeadlineManager {
  private triggered: ToolDeadlineError | undefined;

  constructor(
    private readonly context: {
      budget: RunBudgetTracker;
      policy: ToolDeadlinePolicy;
      run: Pick<RunRecord, "id" | "threadId">;
      store: LocalStore;
      toolProtocol?: ToolProtocolRegistry;
      onEvent?: EventSink;
    },
  ) {}

  get error(): ToolDeadlineError | undefined {
    return this.triggered;
  }

  wrap(tools: AgentTool[]): void {
    for (let index = 0; index < tools.length; index += 1) {
      tools[index] = this.wrapTool(tools[index]!);
    }
  }

  throwIfTriggered(): void {
    if (this.triggered) throw this.triggered;
  }

  private wrapTool(tool: AgentTool): AgentTool {
    const execute = tool.execute.bind(tool);
    return preserveAgentToolIdentity(tool, {
      ...tool,
      execute: (callId, args, signal, onUpdate) =>
        this.execute(tool, execute, callId, args, signal, onUpdate),
    });
  }

  private async execute(
    tool: AgentTool,
    execute: AgentTool["execute"],
    callId: string,
    args: unknown,
    parentSignal: AbortSignal | undefined,
    onUpdate: AgentToolUpdateCallback | undefined,
  ): Promise<AgentToolResult<unknown>> {
    const requestedTimeout = requestedTimeoutMs(args);
    const minimumToolTimeout = minimumToolTimeoutMs(tool);
    const timeoutMs = Math.max(
      1,
      Math.min(
        this.context.budget.remainingTimeoutMs(),
        Math.max(this.context.policy.timeoutMs, minimumToolTimeout ?? 0),
        requestedTimeout ?? Number.MAX_SAFE_INTEGER,
      ),
    );
    const controller = new AbortController();
    const signal = parentSignal
      ? AbortSignal.any([parentSignal, controller.signal])
      : controller.signal;
    let acceptingUpdates = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let graceTimeout: ReturnType<typeof setTimeout> | undefined;
    let resolveDeadline: (reason: ToolDeadlineReason) => void = () => undefined;
    let resolveGrace: () => void = () => undefined;
    let deadlineTriggered = false;
    const deadline = new Promise<ToolDeadlineReason>((resolve) => {
      resolveDeadline = resolve;
    });
    const forcedFinalization = new Promise<{ type: "grace" }>((resolve) => {
      resolveGrace = () => resolve({ type: "grace" });
    });
    const triggerDeadline = (reason: ToolDeadlineReason): void => {
      if (deadlineTriggered) return;
      deadlineTriggered = true;
      resolveDeadline(reason);
      graceTimeout = setTimeout(
        resolveGrace,
        this.context.policy.settlementGraceMs,
      );
      graceTimeout.unref?.();
    };
    const onParentAbort = (): void => triggerDeadline("parent_cancelled");
    if (parentSignal?.aborted) onParentAbort();
    else parentSignal?.addEventListener("abort", onParentAbort, { once: true });
    timeout = setTimeout(() => {
      controller.abort(new Error("Tool deadline exceeded"));
      triggerDeadline("deadline_exceeded");
    }, timeoutMs);
    timeout.unref?.();
    const starting = this.startOperation(
      tool,
      execute,
      callId,
      args,
      signal,
      (update) => {
        if (acceptingUpdates) onUpdate?.(update);
      },
    ).then(
      (operation) => ({ type: "started" as const, operation }),
      (error) => ({ type: "error" as const, error }),
    );
    const start = await Promise.race([
      starting,
      deadline.then((reason) => ({ type: "deadline" as const, reason })),
    ]);
    if (start.type === "error") {
      this.clear(timeout, graceTimeout, parentSignal, onParentAbort);
      throw start.error;
    }
    if (start.type === "deadline") {
      controller.abort(new Error(`Tool ${start.reason}`));
      acceptingUpdates = false;
      this.clear(timeout, graceTimeout, parentSignal, onParentAbort);
      const evidence = await this.record(
        tool,
        callId,
        args,
        start.reason,
        timeoutMs,
        "not_started",
      );
      if (start.reason === "deadline_exceeded") {
        this.triggered ??= new ToolDeadlineError(evidence);
      }
      throw new ToolDeadlineError(evidence);
    }
    const { operation } = start;
    const first = await Promise.race([
      operation.settled,
      deadline.then((reason) => ({ type: "deadline" as const, reason })),
    ]);
    if (first.type !== "deadline") {
      this.clear(timeout, graceTimeout, parentSignal, onParentAbort);
      await operation.startedJournal;
      await this.journal(tool, callId, args, "completed", operation.attempt);
      return unwrap(first);
    }
    controller.abort(new Error(`Tool ${first.reason}`));
    acceptingUpdates = false;
    const grace = await Promise.race([operation.settled, forcedFinalization]);
    this.clear(timeout, graceTimeout, parentSignal, onParentAbort);
    await operation.startedJournal;
    const evidence = await this.record(
      tool,
      callId,
      args,
      first.reason,
      timeoutMs,
      grace.type === "grace" ? "started_unknown" : "completed",
    );
    if (first.reason === "deadline_exceeded") {
      this.triggered ??= new ToolDeadlineError(evidence);
    }
    if (grace.type !== "grace") {
      await this.journal(tool, callId, args, "completed", operation.attempt);
    }
    if (grace.type === "result") return grace.result;
    if (grace.type === "error") throw grace.error;
    throw new ToolDeadlineError(evidence);
  }

  private async startOperation(
    tool: AgentTool,
    execute: AgentTool["execute"],
    callId: string,
    args: unknown,
    signal: AbortSignal,
    onUpdate: AgentToolUpdateCallback,
  ): Promise<{
    attempt: number;
    settled: Promise<
      | { type: "result"; result: AgentToolResult<unknown> }
      | { type: "error"; error: unknown }
    >;
    startedJournal: Promise<ToolEffectJournalEvidence>;
  }> {
    const retry = this.context.toolProtocol?.get(tool.name)?.definition.retry;
    const maxAttempts = retry?.maxAttempts ?? 2;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      await this.journal(tool, callId, args, "not_started", attempt);
      signal.throwIfAborted();
      try {
        const promise = execute(callId, args as never, signal, onUpdate);
        const settled = promise.then(
          (result) => ({ type: "result" as const, result }),
          (error) => ({ type: "error" as const, error }),
        );
        const startedJournal = this.journal(
          tool,
          callId,
          args,
          "started_unknown",
          attempt,
        );
        return { attempt, settled, startedJournal };
      } catch (error) {
        if (
          !(error instanceof ToolNotStartedError) ||
          retry?.strategy === "never" ||
          attempt >= maxAttempts
        )
          throw error;
        await this.retry(tool, callId, args, attempt);
      }
    }
    throw new Error("Tool retry state is invalid");
  }

  private async journal(
    tool: AgentTool,
    callId: string,
    args: unknown,
    state: ToolEffectState,
    attempt: number,
  ): Promise<ToolEffectJournalEvidence> {
    const content = {
      kind: "napier.tool-effect-journal" as const,
      schemaVersion: 1 as const,
      callId,
      toolNameSha256: sha256(tool.name),
      effect: legacyEffect(
        this.context.toolProtocol?.get(tool.name)?.invocation(args).sideEffect,
      ),
      state,
      attempt,
      callSha256: createToolCallSha256(tool.name, args),
    };
    const evidence = {
      ...content,
      contentSha256: sha256(canonicalJson(content)),
    } as ToolEffectJournalEvidence;
    await this.append(
      "tool.effect.journaled",
      evidence as unknown as JsonObject,
    );
    return evidence;
  }

  private async retry(
    tool: AgentTool,
    callId: string,
    args: unknown,
    attempt: number,
  ): Promise<void> {
    const content = {
      kind: "napier.tool-retry" as const,
      schemaVersion: 1 as const,
      callId,
      toolNameSha256: sha256(tool.name),
      fromAttempt: attempt,
      toAttempt: attempt + 1,
      reason: "not_started",
      callSha256: createToolCallSha256(tool.name, args),
    };
    await this.append("tool.retry.started", {
      ...content,
      contentSha256: sha256(canonicalJson(content)),
    });
  }

  private async append(
    type: "tool.effect.journaled" | "tool.retry.started",
    payload: JsonObject,
  ): Promise<void> {
    const event = await this.context.store.appendEvent({
      threadId: this.context.run.threadId,
      runId: this.context.run.id,
      type,
      category: "tool",
      visibility: "debug",
      payload,
    });
    await emit(this.context.onEvent, event);
  }

  private async record(
    tool: AgentTool,
    callId: string,
    args: unknown,
    reason: ToolDeadlineReason,
    timeoutMs: number,
    state: ToolEffectState,
  ): Promise<ToolDeadlineEvidence> {
    const effect: ToolDeadlineEvidence["effect"] = legacyEffect(
      this.context.toolProtocol?.get(tool.name)?.invocation(args).sideEffect,
    );
    const content = {
      kind: "napier.tool-deadline" as const,
      schemaVersion: 1 as const,
      callId,
      toolName: tool.name,
      reason,
      effect,
      state,
      timeoutMs,
      graceMs: this.context.policy.settlementGraceMs,
      callSha256: createToolCallSha256(tool.name, args),
    };
    const evidence = {
      ...content,
      contentSha256: sha256(canonicalJson(content)),
    };
    const event = await this.context.store.appendEvent({
      threadId: this.context.run.threadId,
      runId: this.context.run.id,
      type:
        reason === "deadline_exceeded"
          ? "tool.deadline.exceeded"
          : "tool.cancellation.settled",
      category: "tool",
      visibility: "user",
      payload: evidence as unknown as JsonObject,
    });
    await emit(this.context.onEvent, event);
    return evidence;
  }

  private clear(
    timeout: ReturnType<typeof setTimeout> | undefined,
    graceTimeout: ReturnType<typeof setTimeout> | undefined,
    parentSignal: AbortSignal | undefined,
    onParentAbort: () => void,
  ): void {
    if (timeout) clearTimeout(timeout);
    if (graceTimeout) clearTimeout(graceTimeout);
    parentSignal?.removeEventListener("abort", onParentAbort);
  }
}

export function createToolDeadlineManager(input: {
  budget: RunBudgetTracker;
  registry: ModelRegistry;
  run: Pick<RunRecord, "id" | "threadId">;
  store: LocalStore;
  toolProtocol?: ToolProtocolRegistry;
  onEvent?: EventSink;
}): ToolDeadlineManager {
  const policy = {
    ...DEFAULT_TOOL_DEADLINE_POLICY,
    ...(input.registry.toolDeadlinePolicy ?? {}),
  };
  return new ToolDeadlineManager({ ...input, policy });
}

export function wrapToolsWithDeadlines(input: {
  budget: RunBudgetTracker;
  deferredTools: AgentTool[];
  immediateTools: AgentTool[];
  registry: ModelRegistry;
  run: Pick<RunRecord, "id" | "threadId">;
  store: LocalStore;
  toolProtocol?: ToolProtocolRegistry;
  onEvent?: EventSink;
}): ToolDeadlineManager {
  const manager = createToolDeadlineManager({
    budget: input.budget,
    registry: input.registry,
    run: input.run,
    store: input.store,
    ...(input.toolProtocol ? { toolProtocol: input.toolProtocol } : {}),
    ...(input.onEvent ? { onEvent: input.onEvent } : {}),
  });
  manager.wrap(input.immediateTools);
  manager.wrap(input.deferredTools);
  return manager;
}

function legacyEffect(
  effect: import("@napier/contracts/tool-protocol").ToolSideEffect | undefined,
): "read" | "write" | "unknown" {
  if (effect === "none") return "read";
  if (effect === "reversible" || effect === "irreversible") return "write";
  return "unknown";
}

function requestedTimeoutMs(value: unknown): number | undefined {
  if (!recordValue(value)) return undefined;
  const timeoutMs = value["timeoutMs"];
  return typeof timeoutMs === "number" &&
    Number.isSafeInteger(timeoutMs) &&
    timeoutMs > 0
    ? timeoutMs
    : undefined;
}

function minimumToolTimeoutMs(tool: AgentTool): number | undefined {
  const value = (tool as AgentTool & ToolMinimumDeadline)[
    TOOL_MINIMUM_DEADLINE_MS
  ];
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

function recordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unwrap(
  value:
    | { type: "result"; result: AgentToolResult<unknown> }
    | { type: "error"; error: unknown },
): AgentToolResult<unknown> {
  if (value.type === "error") throw value.error;
  return value.result;
}

async function emit(
  sink: EventSink | undefined,
  event: RunEvent,
): Promise<void> {
  if (!sink) return;
  try {
    await sink(event);
  } catch {
    // Durable deadline evidence survives a disconnected stream.
  }
}
