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
import type { ToolFailureReceiptV1 } from "@napier/contracts/tool-protocol";
import { isSkillResourceLoadFailureV1 } from "@napier/contracts/skill-resource";

import type { FrozenToolResultReplayController } from "./agent-message-tool-result-replay.js";
import { preserveAgentToolIdentity } from "./agent-tool-metadata.js";
import { wrapToolsWithFailureCapture } from "./agent-tool-failure-capture.js";
import { replayedToolFailureReceipt } from "./agent-tool-failure-replay.js";
import {
  agentToolDisplayOwner,
  type AgentToolDisplayStore,
} from "./agent-tool-display-store.js";
import { agentToolResultText } from "./agent-tool-result-text.js";
import { captureToolInvocation } from "./tool-invocation-capture.js";
import { toolInvocationArgumentsSha256 } from "./tool-invocation-capsule.js";
import type { ToolInvocationCapsuleStore } from "./tool-invocation-capsule-store.js";
import { captureToolInvocationResult } from "./tool-invocation-result-capture.js";
import {
  replayableToolResult,
  validateToolInvocationResultCapsuleReceipt,
} from "./tool-invocation-result-capsule.js";
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
  private readonly failureReceipts = new Map<string, ToolFailureReceiptV1>();
  private readonly finalizations = new Map<
    string,
    {
      toolName: string;
      result: Promise<AfterToolCallResult | undefined>;
    }
  >();
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
    const captured = (callId: string, receipt: ToolFailureReceiptV1) =>
      this.failureReceipts.set(callId, receipt);
    for (const tools of [options.tools, options.deferredTools])
      wrapToolsWithFailureCapture({
        tools,
        protocols: options.toolProtocol,
        captured,
      });
    if (options.replay) {
      for (const [index, tool] of options.tools.entries()) {
        options.tools[index] = preserveAgentToolIdentity(tool, {
          ...tool,
          execute: (toolCallId, _args, signal) =>
            Promise.resolve(options.replay!.resultFor(toolCallId, signal)),
        });
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
      return {
        block: true,
        reason: `Tool Protocol definition is unavailable: ${toolName}`,
      };
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
    const existing = this.finalizations.get(input.toolCall.id);
    if (existing) {
      if (existing.toolName !== input.toolCall.name) {
        throw new Error(
          `Tool result finalization replay conflicts for ${input.toolCall.id}`,
        );
      }
      return existing.result;
    }
    const result = this.finalizeOnce(input);
    this.finalizations.set(input.toolCall.id, {
      toolName: input.toolCall.name,
      result,
    });
    return result;
  }

  async replayCapturedResult(
    toolCallId: string,
    toolName: string,
    args: unknown,
  ): Promise<
    | {
        result: AgentToolResult<unknown>;
        isError: boolean;
        resultEvidenceSha256: string;
      }
    | undefined
  > {
    const protocol = this.options.toolProtocol.get(toolName);
    if (
      !protocol ||
      protocol.invocation(args).idempotency.resultReplay !== "exact_result_only"
    ) {
      return undefined;
    }
    const runEvents = await this.options.store.listRunEvents(
      this.options.run.id,
    );
    const candidates = runEvents.filter((event) => {
      const payload = jsonRecord(event.payload);
      return (
        event.type === "context.tool_result" &&
        payload?.["callId"] === toolCallId
      );
    });
    if (candidates.length === 0) return undefined;
    try {
      const receipts = candidates.map((event) =>
        validateToolInvocationResultCapsuleReceipt(event.payload),
      );
      const receipt = receipts[0]!;
      // Accept duplicate historical receipts only when content-identical.
      if (
        receipts.some(
          (candidate) => candidate.contentSha256 !== receipt.contentSha256,
        )
      ) {
        return undefined;
      }
      if (
        receipt.toolName !== toolName ||
        !protocol.matchesReplayIdentitySha256(receipt.toolDefinitionSha256) ||
        receipt.argumentsSha256 !== toolInvocationArgumentsSha256(args)
      ) {
        return undefined;
      }
      const capsule = await this.options.resultCapsules.read(
        receipt.capsuleSha256,
      );
      if (
        capsule.sourceThreadId !== this.options.run.threadId ||
        capsule.sourceRunId !== this.options.run.id ||
        capsule.callId !== toolCallId ||
        capsule.toolName !== toolName ||
        capsule.contentSha256 !== receipt.capsuleSha256 ||
        capsule.invocationCapsuleSha256 !== receipt.invocationCapsuleSha256 ||
        capsule.toolDefinitionSha256 !== receipt.toolDefinitionSha256 ||
        capsule.argumentsSha256 !== receipt.argumentsSha256 ||
        capsule.resultSha256 !== receipt.resultSha256 ||
        capsule.outputTextSha256 !== receipt.outputTextSha256 ||
        capsule.outputTextBytes !== receipt.outputTextBytes ||
        capsule.isError !== receipt.isError
      ) {
        return undefined;
      }
      const replay = {
        result: replayableToolResult(capsule),
        isError: capsule.isError,
        resultEvidenceSha256: receipt.contentSha256,
      };
      const failure = replayedToolFailureReceipt(runEvents, toolCallId);
      if (capsule.isError && failure)
        this.failureReceipts.set(toolCallId, failure);
      // Seed finalization because Pi still invokes afterToolCall on replay.
      if (!this.finalizations.has(toolCallId)) {
        this.finalizations.set(toolCallId, {
          toolName,
          result: Promise.resolve(
            capsule.isError ? { isError: true } : undefined,
          ),
        });
      }
      return replay;
    } catch {
      return undefined;
    }
  }

  private async finalizeOnce(input: {
    toolCall: { id: string; name: string };
    result: AgentToolResult<unknown>;
    isError: boolean;
  }): Promise<AfterToolCallResult | undefined> {
    const protocol = this.options.toolProtocol.require(input.toolCall.name);
    const typedSkillFailure =
      isSkillLoadFailure(input.result.details) ||
      isSkillResourceLoadFailureV1(input.result.details);
    const replay = this.options.replay;
    const effectiveIsError =
      replay?.effectiveIsError(
        input.toolCall.id,
        input.isError || typedSkillFailure,
      ) ??
      (input.isError || typedSkillFailure);
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
    const receipt = await captureToolInvocationResult(
      this.options.store,
      this.options.resultCapsules,
      this.options.run,
      this.captured.get(input.toolCall.id),
      input.result,
      effectiveIsError,
      this.options.onEvent,
    );
    if (this.captured.has(input.toolCall.id) && !receipt) {
      // Experiment evidence is auxiliary. Capture fails closed as an
      // unavailable experiment, but must never rewrite a successful primary
      // tool outcome (for example, Browser image results are intentionally not
      // replayable text capsules).
      this.captured.delete(input.toolCall.id);
    }
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
    result?: AgentToolResult<unknown>,
    isError?: boolean,
  ): Record<string, JsonValue> {
    const protocol = this.options.toolProtocol.get(toolName);
    if (!protocol) return {};
    const input = args ?? this.invocationInputs.get(toolCallId);
    return {
      toolProtocol: protocol.uiProjection(
        status,
        input,
        result,
        isError,
      ) as unknown as JsonValue,
    };
  }

  failureProjection(
    toolCallId: string,
    toolName: string,
    failure: unknown,
  ): Record<string, JsonValue> {
    const protocol = this.options.toolProtocol.get(toolName);
    if (!protocol) return {};
    const input = this.invocationInputs.get(toolCallId);
    const receipt =
      this.failureReceipts.get(toolCallId) ?? protocol.failure(input, failure);
    return { toolFailure: receipt as unknown as JsonValue };
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

function jsonRecord(
  value: JsonValue | undefined,
): Record<string, JsonValue> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : undefined;
}
