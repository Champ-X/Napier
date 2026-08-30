import type {
  AgentTool,
  AgentToolResult,
  AfterToolCallResult,
  BeforeToolCallResult,
} from "@earendil-works/pi-agent-core";
import type {
  JsonValue,
  RunEvent,
  RunRecord,
  ToolInvocationCapsuleReceipt,
} from "@napier/contracts";
import { isSkillResourceLoadFailureV1 } from "@napier/contracts/skill-resource";

import type { FrozenToolResultReplayController } from "./agent-message-tool-result-replay.js";
import {
  agentToolDisplayOwner,
  type AgentToolDisplayStore,
} from "./agent-tool-display-store.js";
import { agentToolResultText } from "./agent-tool-result-text.js";
import { captureToolInvocation } from "./tool-invocation-capture.js";
import { toolInvocationArgumentsSha256 } from "./tool-invocation-capsule.js";
import type { ToolInvocationCapsuleStore } from "./tool-invocation-capsule-store.js";
import { captureToolInvocationResult } from "./tool-invocation-result-capture.js";
import type { ToolInvocationResultCapsuleStore } from "./tool-invocation-result-capsule-store.js";
import type { LocalStore } from "./store.js";
import { isSkillLoadFailure } from "./skill-load-contracts.js";
import { isSkillLoadAgentTool } from "./skill-load-tool.js";
import type { ModelRegistry } from "./models.js";
import type { ToolProtocolRegistry } from "./tool-protocol-registry.js";
import type { RunBudgetTracker } from "./run-budget.js";
import {
  wrapToolsWithDeadlines,
  type ToolDeadlineManager,
} from "./tool-deadline.js";

export interface AgentToolResultLifecycleOptions {
  store: LocalStore;
  run: RunRecord;
  tools: AgentTool[];
  definitions: AgentTool[];
  toolProtocol: ToolProtocolRegistry;
  invocationCapsules: ToolInvocationCapsuleStore;
  resultCapsules: ToolInvocationResultCapsuleStore;
  displays: AgentToolDisplayStore;
  budget: RunBudgetTracker;
  registry: ModelRegistry;
  deferredTools: AgentTool[];
  replay?: FrozenToolResultReplayController;
  onEvent?: (event: RunEvent) => Promise<void> | void;
}

export function toolLife(
  host: {
    store: LocalStore;
    modelRegistry: ModelRegistry;
    toolInvocationCapsules: ToolInvocationCapsuleStore;
    toolInvocationResultCapsules: ToolInvocationResultCapsuleStore;
    toolDisplays: AgentToolDisplayStore;
  },
  values: [RunBudgetTracker, RunRecord, AgentTool[], AgentTool[], AgentTool[]],
  optional: [
    FrozenToolResultReplayController | undefined,
    ((event: RunEvent) => Promise<void> | void) | undefined,
    ToolProtocolRegistry,
  ],
): AgentToolResultLifecycle {
  const [budget, run, tools, deferredTools, definitions] = values;
  const [replay, onEvent, toolProtocol] = optional;
  return new AgentToolResultLifecycle({
    store: host.store,
    registry: host.modelRegistry,
    invocationCapsules: host.toolInvocationCapsules,
    resultCapsules: host.toolInvocationResultCapsules,
    displays: host.toolDisplays,
    budget,
    run,
    tools,
    definitions,
    toolProtocol,
    deferredTools,
    ...(replay ? { replay } : {}),
    ...(onEvent ? { onEvent } : {}),
  });
}

export class AgentToolResultLifecycle {
  private readonly definitions: Map<string, AgentTool>;
  private readonly captured = new Map<string, ToolInvocationCapsuleReceipt>();
  private readonly invocationInputs = new Map<string, unknown>();
  readonly deadlines: ToolDeadlineManager;

  constructor(private readonly options: AgentToolResultLifecycleOptions) {
    this.definitions = new Map(
      options.definitions.map((tool) => [tool.name, tool]),
    );
    this.deadlines = wrapToolsWithDeadlines({
      budget: options.budget,
      deferredTools: options.deferredTools,
      immediateTools: options.tools,
      registry: options.registry,
      toolProtocol: options.toolProtocol,
      run: options.run,
      store: options.store,
      ...(options.onEvent ? { onEvent: options.onEvent } : {}),
    });
    if (options.replay) {
      for (const [index, tool] of options.tools.entries()) {
        options.tools[index] = {
          ...tool,
          execute: (toolCallId, _args, signal) =>
            Promise.resolve(options.replay!.resultFor(toolCallId, signal)),
        };
      }
    }
  }

  async preflight(
    toolCallId: string,
    toolName: string,
    args: unknown,
  ): Promise<BeforeToolCallResult | undefined> {
    await this.options.displays
      .recordInput(
        agentToolDisplayOwner(this.options.run, { toolCallId, toolName }),
        args,
      )
      .catch(() => undefined);
    const tool = this.definitions.get(toolName);
    const protocol = this.options.toolProtocol.get(toolName);
    if (!protocol) {
      return { block: true, reason: `Tool Protocol definition is unavailable: ${toolName}` };
    }
    this.invocationInputs.set(toolCallId, structuredClone(args));
    const replay = this.options.replay;
    if (replay) {
      const reservation = replay.reserve(toolCallId, protocol, toolName, args);
      if (reservation.block) {
        await this.append({
          threadId: this.options.run.threadId,
          runId: this.options.run.id,
          type: "tool.result_reuse.blocked",
          category: "tool",
          visibility: "user",
          payload: {
            schemaVersion: 1,
            callId: toolCallId,
            toolName,
            status: "blocked",
            reason: "diverged",
            sourceThreadId: replay.sourceThreadId,
            sourceRunId: replay.sourceRunId,
            sourceToolResultSetSha256: replay.plan.sourceResultSetSha256,
          },
        });
        return reservation;
      }
      return undefined;
    }
    const receipt = await captureToolInvocation(
      this.options.store,
      this.options.invocationCapsules,
      this.options.run,
      tool,
      toolCallId,
      toolName,
      args,
      protocol.definitionSha256,
      this.options.onEvent,
    );
    if (receipt) this.captured.set(toolCallId, receipt);
    return undefined;
  }

  async finalize(input: {
    toolCall: { id: string; name: string };
    result: AgentToolResult<unknown>;
    isError: boolean;
  }): Promise<AfterToolCallResult | undefined> {
    const protocol = this.options.toolProtocol.require(input.toolCall.name);
    const typedSkillFailure =
      isSkillLoadFailure(input.result.details) ||
      isSkillResourceLoadFailureV1(input.result.details);
    const replay = this.options.replay;
    const effectiveIsError = replay?.effectiveIsError(
      input.toolCall.id,
      input.isError || typedSkillFailure,
    ) ?? (input.isError || typedSkillFailure);
    await this.options.displays
      .recordOutput(
        agentToolDisplayOwner(this.options.run, {
          toolCallId: input.toolCall.id,
          toolName: input.toolCall.name,
        }),
        agentToolResultText(input.result),
        effectiveIsError,
      )
      .catch(() => undefined);
    protocol.validateCanonicalResult(input.result, effectiveIsError);
    const reused = replay?.finalize(input.toolCall.id);
    if (replay && reused) {
      await this.append({
        threadId: this.options.run.threadId,
        runId: this.options.run.id,
        type: "tool.result_reused",
        category: "tool",
        visibility: "user",
        payload: {
          schemaVersion: 1,
          sourceThreadId: replay.sourceThreadId,
          sourceRunId: replay.sourceRunId,
          sourceCallId: reused.entry.sourceCallId,
          targetCallId: input.toolCall.id,
          toolName: input.toolCall.name,
          resultReused: true,
          isError: reused.entry.isError,
          toolDefinitionSha256: reused.entry.toolDefinitionSha256,
          argumentsSha256: reused.entry.argumentsSha256,
          resultSha256: reused.entry.resultSha256,
          resultCapsuleSha256: reused.entry.resultCapsuleSha256,
          sourceToolResultSetSha256: replay.plan.sourceResultSetSha256,
        },
      });
      return reused.patch;
    }
    await captureToolInvocationResult(
      this.options.store,
      this.options.resultCapsules,
      this.options.run,
      this.captured.get(input.toolCall.id),
      input.result,
      effectiveIsError,
      this.options.onEvent,
    );
    return typedSkillFailure && !input.isError ? { isError: true } : undefined;
  }

  startedProjection(
    toolName: string,
    args: unknown,
  ): Record<string, JsonValue> {
    const tool = this.definitions.get(toolName);
    if (!isSkillLoadAgentTool(tool)) return {};
    const selection = tool.selection(args);
    return selection
      ? { details: JSON.parse(JSON.stringify(selection)) as JsonValue }
      : {};
  }

  protocolProjection(
    toolCallId: string,
    toolName: string,
    status: "started" | "completed" | "failed" | "blocked",
    args?: unknown,
  ): Record<string, JsonValue> {
    const protocol = this.options.toolProtocol.get(toolName);
    if (!protocol) return {};
    const input = args ?? this.invocationInputs.get(toolCallId);
    return {
      toolProtocol: protocol.uiProjection(status, input) as unknown as JsonValue,
    };
  }

  validateModelVisibleResult(
    toolName: string,
    result: AgentToolResult<unknown>,
    isError: boolean,
  ): void {
    this.options.toolProtocol
      .require(toolName)
      .validateModelVisibleResult(result, isError);
  }

  toolCallArguments(args: unknown, fallback: JsonValue): JsonValue {
    if (!this.options.replay) return fallback;
    return {
      kind: "napier.frozen-tool-result-arguments",
      schemaVersion: 1,
      argumentsSha256: toolInvocationArgumentsSha256(args),
    };
  }

  toolInput(
    args: unknown,
    fallback: Record<string, JsonValue>,
  ): Record<string, JsonValue> {
    if (!this.options.replay) return fallback;
    return {
      inputSha256: toolInvocationArgumentsSha256(args),
      inputRedacted: true,
    };
  }

  reusedTerminalProjection(
    toolCallId: string,
  ): Record<string, JsonValue> | undefined {
    return this.options.replay?.wasReused(toolCallId)
      ? { outputRedacted: true, resultReused: true }
      : undefined;
  }

  shouldStopAfterTurn(): boolean {
    return (
      Boolean(this.deadlines.error) ||
      (this.options.replay?.shouldStopAfterTurn() ?? false)
    );
  }

  private async append(
    input: Parameters<LocalStore["appendEvent"]>[0],
  ): Promise<void> {
    const event = await this.options.store.appendEvent(input);
    if (!this.options.onEvent) return;
    try {
      await this.options.onEvent(event);
    } catch {
      // Durable evidence survives a disconnected observer.
    }
  }
}
