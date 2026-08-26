import type {
  AfterToolCallResult,
  AgentTool,
  AgentToolResult,
  BeforeToolCallResult,
} from "@earendil-works/pi-agent-core";
import { validateToolArguments } from "@earendil-works/pi-ai";
import type { JsonValue, RunEvent, RunRecord } from "@napier/contracts";
import type { ToolConcurrency } from "@napier/contracts/tool-protocol";

import {
  agentToolGenericDetailsLedgerProjection,
  agentToolInputLedgerProjection,
  agentToolOutputLedgerProjection,
} from "./agent-tool-ledger.js";
import { builtInToolHarnessProjection } from "./agent-tool-effects.js";
import { agentToolResultText } from "./agent-tool-result-text.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import type { EventSink } from "./event-sink.js";
import type { GovernedCodeBridgeDispatcher } from "./governed-code-bridge-model.js";
import type { LocalStore } from "./store.js";
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
  onEvent?: EventSink;
}): GovernedCodeBridgeDispatcher {
  const tools = new Map(input.tools.map((tool) => [tool.name, tool]));
  const registry = input.registry ?? new ToolProtocolRegistry(input.tools);
  const concurrency = new ToolConcurrencyGate();
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
    return concurrency.run(invocation.concurrency, signal, () =>
      dispatchGovernedTool(input, request, tool, protocol, signal),
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

async function dispatchGovernedTool(
  input: Parameters<typeof createGovernedCodeBridgeDispatcher>[0],
  request: Parameters<GovernedCodeBridgeDispatcher>[0],
  tool: AgentTool,
  protocol: OwnedToolRecordV2,
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
  await append(input, "code_bridge.authorized", toolCall, {
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
  });
  await append(input, "tool.started", toolCall, {
    status: "started",
    nestedDispatch: true,
    parentEvaluationId: request.evaluationId,
    inputSha256: sha256(canonicalJson(request.input)),
    ...builtInToolHarnessProjection(tool.name, args),
    ...agentToolInputLedgerProjection(tool.name, args),
    toolProtocol: protocol.uiProjection("started", args) as never,
  });
  let result: AgentToolResult<unknown>;
  let isError = false;
  try {
    result = await tool.execute(callId, args, signal);
  } catch (error) {
    isError = true;
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
  const presented = applyPresentation(result, isError, override);
  const output = agentToolResultText(presented.result);
  const outputProjection = agentToolOutputLedgerProjection(
    tool.name,
    output,
    presented.result,
  );
  await append(
    input,
    presented.isError ? "tool.failed" : "tool.completed",
    toolCall,
    {
      status: presented.isError ? "failed" : "completed",
      nestedDispatch: true,
      parentEvaluationId: request.evaluationId,
      outputTextSha256: sha256(output),
      outputTextBytes: Buffer.byteLength(output, "utf8"),
      ...outputProjection,
      ...agentToolGenericDetailsLedgerProjection(
        tool.name,
        outputProjection,
        presented.result.details,
      ),
      toolProtocol: protocol.uiProjection(
        presented.isError ? "failed" : "completed",
        args,
      ) as never,
    },
  );
  return {
    content: structuredClone(presented.result.content),
    details: structuredClone(presented.result.details),
    isError: presented.isError,
  };
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

class ToolConcurrencyGate {
  private activeSafe = 0;
  private activeSerialized = 0;
  private activeExclusive = false;
  private readonly queue: Array<{
    mode: ToolConcurrency;
    signal?: AbortSignal;
    start(): void;
  }> = [];

  async run<T>(
    mode: ToolConcurrency,
    signal: AbortSignal | undefined,
    operation: () => Promise<T>,
  ): Promise<T> {
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason ?? new Error("Code Bridge call was cancelled"));
        return;
      }
      const entry = {
        mode,
        ...(signal ? { signal } : {}),
        start: () => {
          signal?.removeEventListener("abort", abort);
          if (mode === "safe") this.activeSafe += 1;
          else if (mode === "serialized") this.activeSerialized += 1;
          else this.activeExclusive = true;
          resolve();
        },
      };
      const abort = () => {
        const index = this.queue.indexOf(entry);
        if (index >= 0) this.queue.splice(index, 1);
        reject(signal?.reason ?? new Error("Code Bridge call was cancelled"));
        this.drain();
      };
      signal?.addEventListener("abort", abort, { once: true });
      this.queue.push(entry);
      this.drain();
    });
    try {
      return await operation();
    } finally {
      if (mode === "safe") this.activeSafe -= 1;
      else if (mode === "serialized") this.activeSerialized -= 1;
      else this.activeExclusive = false;
      this.drain();
    }
  }

  private drain(): void {
    if (this.activeExclusive || this.queue.length === 0) return;
    const next = this.queue[0]!;
    if (next.mode === "exclusive") {
      if (this.activeSafe === 0 && this.activeSerialized === 0) {
        this.queue.shift()!.start();
      }
      return;
    }
    if (next.mode === "serialized" && this.activeSerialized > 0) return;
    this.queue.shift()!.start();
    this.drain();
  }
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
  const event = await input.store.appendEvent({
    threadId: input.run.threadId,
    runId: input.run.id,
    type,
    category: "tool",
    visibility: "user",
    payload: { callId: toolCall.id, toolName: toolCall.name, ...payload },
  });
  try {
    await input.onEvent?.(event as RunEvent);
  } catch {
    // Durable nested-dispatch evidence survives a disconnected observer.
  }
}
