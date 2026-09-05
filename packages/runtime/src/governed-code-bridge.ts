import type {
  AfterToolCallResult,
  AgentTool,
  AgentToolResult,
  BeforeToolCallResult,
} from "@earendil-works/pi-agent-core";
import { validateToolArguments } from "@earendil-works/pi-ai";
import type { JsonValue, RunEvent, RunRecord } from "@napier/contracts";
import type { ToolFailureReceiptV1 } from "@napier/contracts/tool-protocol";

import {
  agentToolGenericDetailsLedgerProjection,
  agentToolInputLedgerProjection,
  agentToolOutputLedgerProjection,
} from "./agent-tool-ledger.js";
import { builtInToolHarnessProjection } from "./agent-tool-effects.js";
import type { AgentToolDisplayStore } from "./agent-tool-display-store.js";
import { agentToolResultText } from "./agent-tool-result-text.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import type { EventSink } from "./event-sink.js";
import { createProcessLeaseOwnerId } from "./ids.js";
import { claimRunHeadEvent } from "./event-idempotency.js";
import type { GovernedCodeBridgeDispatcher } from "./governed-code-bridge-model.js";
import type { LocalStore } from "./store.js";
import { toolOperationSetLedgerProjection } from "./tool-operation-journal.js";
import { ToolConcurrencyGate } from "./tool-concurrency-gate.js";
import { executeAdmittedToolCall } from "./tool-execution-admission-service.js";
import type { ToolOperationJournalOptions } from "./tool-operation-model.js";
import {
  ToolProtocolRegistry,
  type OwnedToolRecordV2,
} from "./tool-protocol-registry.js";

export function createGovernedCodeBridgeDispatcher(input: {
  store: LocalStore;
  run: Pick<RunRecord, "id" | "threadId">;
  tools: readonly AgentTool[];
  registry?: ToolProtocolRegistry;
  activeToolNames(): ReadonlySet<string>;
  assertBudget(): void;
  displays?: AgentToolDisplayStore;
  preflight(
    toolCall: { id: string; name: string },
    args: unknown,
    signal?: AbortSignal,
  ): Promise<BeforeToolCallResult | undefined>;
  finalize(value: {
    toolCall: { id: string; name: string };
    result: AgentToolResult<unknown>;
    isError: boolean;
  }): Promise<AfterToolCallResult | undefined>;
  replayTerminal?(
    toolCallId: string,
    toolName: string,
    args: unknown,
  ): Promise<
    | {
        result: AgentToolResult<unknown>;
        isError: boolean;
        resultEvidenceSha256?: string;
      }
    | undefined
  >;
  onEvent?: EventSink;
  concurrencyGate?: ToolConcurrencyGate;
  journalOptions?: ToolOperationJournalOptions;
}): GovernedCodeBridgeDispatcher {
  const tools = new Map(input.tools.map((tool) => [tool.name, tool]));
  const registry = input.registry ?? new ToolProtocolRegistry(input.tools);
  const concurrency =
    input.concurrencyGate ??
    new ToolConcurrencyGate({
      durable: {
        backend: input.store.toolConcurrencyLeaseBackend(),
        ownerId: createProcessLeaseOwnerId("codebridge"),
      },
    });
  return async (request, signal) => {
    const tool = tools.get(request.toolId);
    if (!tool) {
      throw new Error(
        `Code Bridge capability is unavailable: ${request.toolId}`,
      );
    }
    const protocol = registry.require(tool.name);
    const invocation = protocol.invocation(request.input);
    if (invocation.approval.codeBridge !== "allowed") {
      const sideEffect = invocation.sideEffect;
      const reason = `Code Bridge capability requires an approval checkpoint outside the code session: ${tool.name}/${sideEffect}`;
      await appendBlocked(input, request, tool.name, reason, protocol);
      throw new Error(reason);
    }
    if (!input.activeToolNames().has(tool.name)) {
      const reason = `Code Bridge capability is not active for this step: ${tool.name}`;
      await appendBlocked(input, request, tool.name, reason, protocol);
      throw new Error(reason);
    }
    return dispatchGovernedTool(
      input,
      request,
      tool,
      protocol,
      concurrency,
      signal,
    );
  };
}

async function appendBlocked(
  input: Parameters<typeof createGovernedCodeBridgeDispatcher>[0],
  request: Parameters<GovernedCodeBridgeDispatcher>[0],
  toolName: string,
  reason: string,
  protocol?: OwnedToolRecordV2,
): Promise<void> {
  await captureBlockedDisplay(input, request, toolName, reason);
  await append(
    input,
    "tool.blocked",
    {
      id: `codebridge_${request.evaluationId}_${String(request.callId)}`,
      name: toolName,
    },
    {
      status: "blocked",
      nestedDispatch: true,
      parentEvaluationId: request.evaluationId,
      policyReason: reason,
      harnessInterventionReason: "approval_block",
      inputSha256: sha256(canonicalJson(request.input)),
      ...(protocol
        ? {
            toolProtocol: protocol.uiProjection(
              "blocked",
              request.input,
            ) as never,
          }
        : {}),
    },
  );
}

async function captureBlockedDisplay(
  input: Parameters<typeof createGovernedCodeBridgeDispatcher>[0],
  request: Parameters<GovernedCodeBridgeDispatcher>[0],
  toolName: string,
  reason: string,
): Promise<void> {
  if (!input.displays) return;
  const owner = {
    threadId: input.run.threadId,
    runId: input.run.id,
    callId: `codebridge_${request.evaluationId}_${String(request.callId)}`,
    toolName,
  };
  await input.displays.recordInput(owner, request.input).catch(() => undefined);
  await input.displays.recordOutput(owner, reason, true).catch(() => undefined);
}

async function dispatchGovernedTool(
  input: Parameters<typeof createGovernedCodeBridgeDispatcher>[0],
  request: Parameters<GovernedCodeBridgeDispatcher>[0],
  tool: AgentTool,
  protocol: OwnedToolRecordV2,
  concurrencyGate: ToolConcurrencyGate,
  signal?: AbortSignal,
) {
  const callId = `codebridge_${request.evaluationId}_${String(request.callId)}`;
  const toolCall = { id: callId, name: tool.name };
  const args = validateToolArguments(tool, {
    type: "toolCall",
    id: callId,
    name: tool.name,
    arguments: bridgeArguments(request.input),
  });
  const invocation = protocol.invocation(args);
  try {
    input.assertBudget();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await captureBlockedDisplay(input, request, tool.name, reason);
    await append(input, "tool.blocked", toolCall, {
      status: "blocked",
      nestedDispatch: true,
      parentEvaluationId: request.evaluationId,
      policyReason: reason,
      harnessInterventionReason: "budget_pause",
      inputSha256: sha256(canonicalJson(request.input)),
      toolProtocol: protocol.uiProjection("blocked", args) as never,
    });
    throw error;
  }
  const block = await input.preflight(toolCall, args, signal);
  if (block?.block)
    throw new Error(block.reason || "Code Bridge call was blocked");
  const startedPayload = {
    nestedDispatch: true,
    parentEvaluationId: request.evaluationId,
    inputSha256: sha256(canonicalJson(request.input)),
    ...builtInToolHarnessProjection(tool.name, args),
    ...agentToolInputLedgerProjection(tool.name, args),
    toolProtocol: protocol.uiProjection("started", args) as never,
  };
  const outcome = await executeAdmittedToolCall({
    store: input.store,
    run: input.run,
    callId,
    toolName: tool.name,
    args,
    protocol,
    concurrencyGate,
    startedPayload,
    ...(signal ? { signal } : {}),
    ...(input.journalOptions ? { journalOptions: input.journalOptions } : {}),
    admissionVisibility: "user" as const,
    admissionPayload: {
      nestedDispatch: true,
      parentEvaluationId: request.evaluationId,
    },
    ...(input.onEvent ? { onEvent: input.onEvent } : {}),
    ...(input.replayTerminal
      ? {
          replay: {
            load: async () => {
              const replay = await input.replayTerminal!(
                callId,
                tool.name,
                args,
              );
              return replay?.resultEvidenceSha256
                ? {
                    result: replay.result,
                    isError: replay.isError,
                    resultEvidenceSha256: replay.resultEvidenceSha256,
                  }
                : undefined;
            },
            restore: async (captured) => {
              const override = await input.finalize({
                toolCall,
                result: captured.result,
                isError: captured.isError,
              });
              return withFailureReceipt(
                protocol,
                args,
                applyPresentation(captured.result, captured.isError, override),
              );
            },
          },
        }
      : {}),
    onAuthorized: () =>
      append(input, "code_bridge.authorized", toolCall, {
        nestedDispatch: true,
        parentEvaluationId: request.evaluationId,
        inputSha256: sha256(canonicalJson(request.input)),
        definitionSha256: protocol.definitionSha256,
        toolVersionSha256: protocol.implementationSha256,
        semanticVersion: invocation.semanticVersion,
        concurrency: invocation.concurrency,
        sideEffect: invocation.sideEffect,
        retryStrategy: invocation.retry.strategy,
        idempotencyKey: invocation.idempotency.key,
        approvalMode: invocation.approval.mode,
        compatibilityMode: invocation.compatibilityMode,
        validationChecked: true,
        policyChecked: true,
        workspaceBoundaryChecked: true,
        budgetChecked: true,
        sandboxDelegated: true,
      }).then(() => undefined),
    execute: async () => {
      let result: AgentToolResult<unknown>;
      let isError = false;
      let failure: ToolFailureReceiptV1 | undefined;
      try {
        result = await tool.execute(callId, args, signal);
      } catch (error) {
        isError = true;
        failure = protocol.failure(args, error);
        result = {
          content: [
            {
              type: "text",
              text: error instanceof Error ? error.message : String(error),
            },
          ],
          details: {},
        };
      }
      const override = await input.finalize({ toolCall, result, isError });
      return withFailureReceipt(
        protocol,
        args,
        applyPresentation(result, isError, override),
        failure,
      );
    },
    settlement: (presented) => presented,
  });
  return finishGovernedResult(
    input,
    request,
    tool,
    protocol,
    args,
    outcome.value,
  );
}

export function createGovernedCodeBridgeBinding(): {
  dispatcher: GovernedCodeBridgeDispatcher;
  attach(input: Parameters<typeof createGovernedCodeBridgeDispatcher>[0]): void;
} {
  let delegate: GovernedCodeBridgeDispatcher | undefined;
  return {
    dispatcher: (request, signal) => {
      if (!delegate) throw new Error("Code Bridge is not ready");
      return delegate(request, signal);
    },
    attach: (input) => {
      if (delegate) throw new Error("Code Bridge is already attached");
      delegate = createGovernedCodeBridgeDispatcher(input);
    },
  };
}

async function finishGovernedResult(
  input: Parameters<typeof createGovernedCodeBridgeDispatcher>[0],
  request: Parameters<GovernedCodeBridgeDispatcher>[0],
  tool: AgentTool,
  protocol: OwnedToolRecordV2,
  args: unknown,
  presented: {
    result: AgentToolResult<unknown>;
    isError: boolean;
    failure?: ToolFailureReceiptV1;
  },
) {
  const callId = `codebridge_${request.evaluationId}_${String(request.callId)}`;
  const output = agentToolResultText(presented.result);
  const outputProjection = agentToolOutputLedgerProjection(
    tool.name,
    output,
    presented.result,
  );
  const operationSetProjection = await toolOperationSetLedgerProjection(
    input.store,
    { threadId: input.run.threadId, runId: input.run.id },
    callId,
  );
  await append(
    input,
    presented.isError ? "tool.failed" : "tool.completed",
    { id: callId, name: tool.name },
    {
      status: presented.isError ? "failed" : "completed",
      nestedDispatch: true,
      parentEvaluationId: request.evaluationId,
      outputTextSha256: sha256(output),
      outputTextBytes: Buffer.byteLength(output, "utf8"),
      ...operationSetProjection,
      ...outputProjection,
      ...agentToolGenericDetailsLedgerProjection(
        tool.name,
        outputProjection,
        presented.result.details,
      ),
      ...(presented.isError
        ? {
            toolFailure: (presented.failure ??
              protocol.failure(args, presented.result)) as unknown as JsonValue,
          }
        : {}),
      toolProtocol: protocol.uiProjection(
        presented.isError ? "failed" : "completed",
        args,
        presented.result,
        presented.isError,
      ) as never,
    },
  );
  return {
    content: structuredClone(presented.result.content),
    details: structuredClone(presented.result.details),
    isError: presented.isError,
  };
}

function applyPresentation(
  result: AgentToolResult<unknown>,
  isError: boolean,
  override?: AfterToolCallResult,
): { result: AgentToolResult<unknown>; isError: boolean } {
  if (!override) return { result, isError };
  return {
    result: {
      ...result,
      content: override.content ?? result.content,
      details: override.details ?? result.details,
      ...((override.usage ?? result.usage)
        ? { usage: override.usage ?? result.usage }
        : {}),
      ...((override.terminate ?? result.terminate) !== undefined
        ? { terminate: override.terminate ?? result.terminate }
        : {}),
    },
    isError: override.isError ?? isError,
  };
}

function withFailureReceipt(
  protocol: OwnedToolRecordV2,
  args: unknown,
  presented: { result: AgentToolResult<unknown>; isError: boolean },
  failure?: ToolFailureReceiptV1,
): {
  result: AgentToolResult<unknown>;
  isError: boolean;
  failure?: ToolFailureReceiptV1;
} {
  return presented.isError
    ? {
        ...presented,
        failure: failure ?? protocol.failure(args, presented.result),
      }
    : presented;
}

function bridgeArguments(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Code Bridge tool input must be an object");
  }
  return value as Record<string, unknown>;
}

async function append(
  input: {
    store: LocalStore;
    run: Pick<RunRecord, "id" | "threadId">;
    onEvent?: EventSink;
  },
  type:
    | "code_bridge.authorized"
    | "tool.blocked"
    | "tool.completed"
    | "tool.failed"
    | "tool.started",
  toolCall: { id: string; name: string },
  payload: Record<string, JsonValue>,
): Promise<void> {
  const eventInput = {
    threadId: input.run.threadId,
    runId: input.run.id,
    type,
    category: "tool",
    visibility: "user",
    payload: { callId: toolCall.id, toolName: toolCall.name, ...payload },
  } as const;
  const phase =
    type === "tool.completed" ||
    type === "tool.failed" ||
    type === "tool.blocked"
      ? "terminal"
      : type;
  const receipt = await claimRunHeadEvent(input.store, eventInput, {
    namespace: "code-bridge-tool-phase",
    key: `${toolCall.id}:${phase}`,
  });
  if (!receipt.appended) return;
  try {
    await input.onEvent?.(receipt.event as RunEvent);
  } catch {
    // Durable nested-dispatch evidence survives a disconnected observer.
  }
}
