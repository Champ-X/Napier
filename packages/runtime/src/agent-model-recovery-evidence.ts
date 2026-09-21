import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import type {
  ModelContextEnvelopeReceipt,
  RunEvent,
  RunRecord,
} from "@napier/contracts";
import type { EventSink } from "./event-sink.js";
import type { AppendEventInput } from "./run-event-registry.js";
import type { RunBudgetTracker } from "./run-budget.js";
import type { ModelThinkingLoopEvidence } from "./model-thinking-loop-policy.js";
import type { ModelThinkingTraceSnapshot } from "./model-thinking-trace.js";
import { recordModelThinkingTrace } from "./model-thinking-trace-store.js";
import { mapModelUsage } from "./agent-model-projection.js";
import { createUsageAccounting } from "./token-accounting.js";
import { canonicalJson, sha256 } from "./ed25519.js";

interface RecoveryEvidenceInput {
  host: {
    store: {
      dataRoot: string;
      appendEvent(event: AppendEventInput): Promise<RunEvent>;
    };
  };
  budget: RunBudgetTracker;
  run: RunRecord;
  onEvent?: EventSink;
}

export async function recordContextOverflow(
  input: RecoveryEvidenceInput,
  model: Model<Api>,
  error: AssistantMessage,
  envelope: ModelContextEnvelopeReceipt,
): Promise<"retry" | "budget_exhausted"> {
  const usage = mapModelUsage(error.usage);
  const usageAccounting = createUsageAccounting(
    { provider: model.provider, id: model.id },
    usage,
  );
  input.budget.observeAuxiliaryUsage(usage, Date.now(), usageAccounting);
  const action = input.budget.exhaustion
    ? ("budget_exhausted" as const)
    : ("retry" as const);
  const content = {
    kind: "napier.model-context-overflow" as const,
    schemaVersion: 1 as const,
    action,
    provider: model.provider,
    model: model.id,
    diagnosticSha256: sha256(error.errorMessage ?? ""),
    usage,
    usageAccounting,
    modelContextEnvelopeSha256: envelope.contentSha256,
    modelContextEnvelopeTurnIndex: envelope.turnIndex,
    modelContextMessageSetSha256: envelope.messageSetSha256,
    modelContextToolDefinitionSetSha256: envelope.toolDefinitionSetSha256,
  };
  const event = await input.host.store.appendEvent({
    threadId: input.run.threadId,
    runId: input.run.id,
    type: "model.context.overflow",
    category: "model",
    visibility: "debug",
    payload: { ...content, contentSha256: sha256(canonicalJson(content)) },
  });
  if (input.onEvent) {
    try {
      await input.onEvent(event);
    } catch {
      // Durable overflow evidence survives a disconnected stream.
    }
  }
  return action;
}

export async function recordDetection(
  input: RecoveryEvidenceInput,
  model: Model<Api>,
  evidence: ModelThinkingLoopEvidence,
  action: "retry" | "finalize",
  envelope: ModelContextEnvelopeReceipt | undefined,
  terminalMessage?: AssistantMessage,
  trace?: ModelThinkingTraceSnapshot,
): Promise<"retry" | "finalize" | "budget_exhausted"> {
  const usage = terminalMessage
    ? mapModelUsage(terminalMessage.usage)
    : {
        inputTokens: 0,
        outputTokens: Math.ceil(evidence.observedBytes / 4),
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
      };
  const usageAccounting = createUsageAccounting(
    { provider: model.provider, id: model.id },
    usage,
  );
  input.budget.observeAuxiliaryUsage(usage, Date.now(), usageAccounting);
  const effectiveAction = input.budget.exhaustion
    ? ("budget_exhausted" as const)
    : action;
  const reasoningTrace = trace
    ? await recordModelThinkingTrace(
        input.host.store.dataRoot,
        input.run,
        envelope,
        evidence,
        trace,
      )
    : undefined;
  const content = {
    kind: "napier.model-thinking-loop" as const,
    schemaVersion: 1 as const,
    action: effectiveAction,
    provider: model.provider,
    model: model.id,
    ...evidence,
    usage,
    usageSource: terminalMessage
      ? "provider_terminal"
      : "reasoning_bytes_estimate",
    usageAccounting,
    ...(reasoningTrace ? { reasoningTrace } : {}),
    ...(effectiveAction === "retry" && envelope
      ? {
          modelContextEnvelopeSha256: envelope.contentSha256,
          modelContextEnvelopeTurnIndex: envelope.turnIndex,
          modelContextMessageSetSha256: envelope.messageSetSha256,
          modelContextToolDefinitionSetSha256: envelope.toolDefinitionSetSha256,
        }
      : {}),
  };
  const event = await input.host.store.appendEvent({
    threadId: input.run.threadId,
    runId: input.run.id,
    type: "model.thinking_loop.detected",
    category: "model",
    visibility: effectiveAction === "retry" ? "debug" : "user",
    payload: {
      ...content,
      contentSha256: sha256(canonicalJson(content)),
    },
  });
  if (input.onEvent) {
    try {
      await input.onEvent(event);
    } catch {
      // Durable thinking-loop evidence survives a disconnected stream.
    }
  }
  return effectiveAction;
}
