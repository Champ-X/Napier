import type { BeforeToolCallResult } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ToolLoopGuardPolicy } from "@napier/contracts";

import { agentToolInputLedgerProjection } from "./agent-tool-ledger.js";
import type { AgentToolResultLifecycle } from "./agent-tool-result-lifecycle.js";
import type { AgentTurnPipeline } from "./agent-turn-pipeline.js";
import type { EventSink } from "./event-sink.js";
import type { RunBudgetTracker } from "./run-budget.js";
import { progTool, type RunProgressTracker } from "./run-progress-vector.js";
import type { LocalStore } from "./store.js";
import {
  createToolCallSha256,
  latestActiveToolLoopGuard,
  TOOL_LOOP_GUARD_POLICY_REASON,
  toolLoopGuardBlockReason,
} from "./tool-loop-guard.js";

type PolicyContext = Omit<
  Parameters<AgentTurnPipeline["preflightPolicy"]>[0],
  "toolCall" | "args" | "signal"
>;

interface ToolCallContext {
  assistantMessage: AssistantMessage;
  toolCall: { id: string; name: string };
  args: unknown;
}

export function createAgentToolPreflight(input: {
  store: LocalStore;
  policy: PolicyContext;
  turnPipeline: AgentTurnPipeline;
  budget: RunBudgetTracker;
  progress: RunProgressTracker;
  lifecycle: AgentToolResultLifecycle;
  activeToolNames(): ReadonlySet<string>;
  toolLoopGuardPolicy: ToolLoopGuardPolicy;
  onEvent?: EventSink;
}): {
  governed(
    toolCall: { id: string; name: string },
    args: unknown,
    signal?: AbortSignal,
  ): Promise<BeforeToolCallResult | undefined>;
  beforeToolCall(
    context: ToolCallContext,
    signal?: AbortSignal,
  ): Promise<BeforeToolCallResult | undefined>;
} {
  const governed = async (
    toolCall: { id: string; name: string },
    args: unknown,
    signal?: AbortSignal,
  ) => {
    const block = await input.turnPipeline.preflightPolicy({
      ...input.policy,
      toolCall,
      args,
      ...(signal ? { signal } : {}),
    });
    return block ?? progTool(input.progress, input.lifecycle, toolCall, args);
  };
  return {
    governed,
    beforeToolCall: async ({ assistantMessage, toolCall, args }, signal) => {
      if (signal?.aborted && !input.budget.exhaustion) return undefined;
      if (!input.activeToolNames().has(toolCall.name)) {
        return {
          block: true,
          reason: `Tool ${toolCall.name} is not active for this step`,
        };
      }
      const toolCalls = assistantMessage.content.filter(
        (content) => content.type === "toolCall",
      );
      if (
        toolCalls.some(
          (candidate) => candidate.name === "request_operator_decision",
        ) &&
        toolCalls.length !== 1
      ) {
        return {
          block: true,
          reason:
            "request_operator_decision must be the only tool call in its assistant turn",
        };
      }
      const exhaustion =
        toolCall.name === "request_operator_decision"
          ? input.budget.exhaustion
          : input.budget.exhaustBeforeNextPrimaryTurn();
      if (exhaustion) {
        await append(input, "tool.blocked", {
          callId: toolCall.id,
          toolName: toolCall.name,
          status: "blocked",
          ...agentToolInputLedgerProjection(toolCall.name, args),
          policyReason: exhaustion.message,
          harnessInterventionReason: "budget_pause",
        });
        return { block: true, reason: exhaustion.message };
      }
      const guard = latestActiveToolLoopGuard(
        await input.store.listEvents(input.policy.run.threadId),
        input.policy.run.id,
        input.toolLoopGuardPolicy,
      );
      if (
        guard &&
        toolCalls.length === 1 &&
        !input.toolLoopGuardPolicy.exemptTools.includes(toolCall.name) &&
        createToolCallSha256(toolCall.name, args) === guard.receipt.callSha256
      ) {
        const reason = toolLoopGuardBlockReason(guard);
        await append(input, "tool.blocked", {
          callId: toolCall.id,
          toolName: toolCall.name,
          status: "blocked",
          inputSha256: createToolCallSha256(toolCall.name, args),
          policyReason: TOOL_LOOP_GUARD_POLICY_REASON,
          loopGuardTriggerSha256: guard.receipt.contentSha256,
        });
        return { block: true, reason };
      }
      return governed(toolCall, args, signal);
    },
  };
}

async function append(
  input: Pick<
    Parameters<typeof createAgentToolPreflight>[0],
    "store" | "policy" | "onEvent"
  >,
  type: "tool.blocked",
  payload: Parameters<LocalStore["appendEvent"]>[0]["payload"],
): Promise<void> {
  const event = await input.store.appendEvent({
    threadId: input.policy.run.threadId,
    runId: input.policy.run.id,
    type,
    category: "tool",
    visibility: "user",
    payload,
  });
  try {
    await input.onEvent?.(event);
  } catch {
    // Durable policy evidence survives a disconnected observer.
  }
}
