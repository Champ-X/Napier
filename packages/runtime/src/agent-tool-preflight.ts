import type { BeforeToolCallResult } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { JsonValue, ToolLoopGuardPolicy } from "@napier/contracts";

import { agentToolInputLedgerProjection } from "./agent-tool-ledger.js";
import type { AgentToolDisplayStore } from "./agent-tool-display-store.js";
import type { AgentToolResultLifecycle } from "./agent-tool-result-lifecycle.js";
import type { AgentTurnPipeline } from "./agent-turn-pipeline.js";
import type { EventSink } from "./event-sink.js";
import type { RunBudgetTracker } from "./run-budget.js";
import { progTool, type RunProgressTracker } from "./run-progress-vector.js";
import type { LocalStore } from "./store.js";
import { unresolvedCapabilityClaim } from "./capability-availability-guard.js";
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
  displays: AgentToolDisplayStore;
  policy: PolicyContext;
  turnPipeline: AgentTurnPipeline;
  budget: RunBudgetTracker;
  progress: RunProgressTracker;
  lifecycle: AgentToolResultLifecycle;
  activeToolNames(): ReadonlySet<string>;
  runtimeAvailableToolNames(): ReadonlySet<string>;
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
  const recordBlock = async (
    toolCall: ToolCallContext["toolCall"],
    args: unknown,
    reason: string,
    evidence: Record<string, JsonValue> = {},
  ): Promise<BeforeToolCallResult> => {
    await captureBlockDisplay(
      input.displays,
      input.policy.run,
      toolCall,
      args,
      reason,
    );
    await append(input, "tool.blocked", {
      callId: toolCall.id,
      toolName: toolCall.name,
      status: "blocked",
      ...input.lifecycle.protocolProjection(
        toolCall.id,
        toolCall.name,
        "blocked",
        args,
      ),
      ...agentToolInputLedgerProjection(toolCall.name, args),
      policyReason: reason,
      ...evidence,
    });
    return { block: true, reason };
  };
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
        return recordBlock(
          toolCall,
          args,
          `Tool ${toolCall.name} is not active for this step`,
          { harnessInterventionReason: "capability_block" },
        );
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
        return recordBlock(
          toolCall,
          args,
          "request_operator_decision must be the only tool call in its assistant turn",
          { harnessInterventionReason: "safety_block" },
        );
      }
      if (toolCall.name === "request_operator_decision") {
        const active = input.activeToolNames();
        const claim = unresolvedCapabilityClaim({
          args,
          events: await input.store.listRunEvents(input.policy.run.id),
          activeToolNames: active,
          runtimeAvailableToolNames: input.runtimeAvailableToolNames(),
        });
        if (claim) {
          if (claim.usableNow.length > 0) {
            return recordBlock(
              toolCall,
              args,
              `Do not request operator input for a capability blocker: ${claim.usableNow.join(", ")} is active on this step. Call the active tool and continue; only a recorded tool failure can establish an execution blocker.`,
              { harnessInterventionReason: "capability_use_required" },
            );
          }
          if (active.has("capability") && claim.discoverable.length > 0) {
            return recordBlock(
              toolCall,
              args,
              `Do not request operator input for a capability blocker: ${claim.discoverable.join(", ")} is configured but hidden by the focused model surface. Call capability with ${claim.discoverable.map((name) => `uri=${JSON.stringify(`cap://tools/${name}`)}`).join(" or ")}, then continue on the next step.`,
              { harnessInterventionReason: "capability_discovery_required" },
            );
          }
        }
      }
      const exhaustion =
        toolCall.name === "request_operator_decision"
          ? input.budget.exhaustion
          : input.budget.exhaustBeforeNextPrimaryTurn();
      if (exhaustion) {
        return recordBlock(toolCall, args, exhaustion.message, {
          harnessInterventionReason: "budget_pause",
        });
      }
      const guard = latestActiveToolLoopGuard(
        await input.store.listRunEvents(input.policy.run.id),
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
        await recordBlock(toolCall, args, TOOL_LOOP_GUARD_POLICY_REASON, {
          inputSha256: createToolCallSha256(toolCall.name, args),
          loopGuardTriggerSha256: guard.receipt.contentSha256,
        });
        return { block: true, reason };
      }
      return governed(toolCall, args, signal);
    },
  };
}

export { claimedUnavailableCapabilityTools } from "./capability-availability-guard.js";

async function captureBlockDisplay(
  displays: AgentToolDisplayStore,
  run: { threadId: string; id: string },
  toolCall: { id: string; name: string },
  args: unknown,
  reason: string,
): Promise<void> {
  const owner = {
    threadId: run.threadId,
    runId: run.id,
    callId: toolCall.id,
    toolName: toolCall.name,
  };
  await displays.recordInput(owner, args).catch(() => undefined);
  await displays.recordOutput(owner, reason, true).catch(() => undefined);
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
