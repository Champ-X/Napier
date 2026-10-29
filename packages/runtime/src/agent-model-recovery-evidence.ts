import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import type {
  ModelContextEnvelopeReceipt,
  RunEvent,
  RunRecord,
} from "@napier/contracts";
import type { ModelCallAttributionV1 } from "@napier/contracts/model-accounting";
import { modelResultAttribution, modelAccountingLinkage } from "./model-call-attribution.js";
import type { EventSink } from "./event-sink.js";
import type { AppendEventInput } from "./run-event-registry.js";
import type { RunBudgetTracker } from "./run-budget.js";
import type { ModelThinkingLoopEvidence } from "./model-thinking-loop-policy.js";
import type { ModelThinkingTraceSnapshot } from "./model-thinking-trace.js";
import { recordModelThinkingTrace } from "./model-thinking-trace-store.js";
import { mapModelUsage } from "./agent-model-projection.js";
import { createUsageAccounting } from "./token-accounting.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import type { ModelContextOverflowDecision } from "./model-context-overflow-recovery.js";
import type { ModelRecoveryReadiness } from "./model-call-recovery.js";

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
  decision?: ModelContextOverflowDecision,
): Promise<{ action: "retry" | "finalize" | "budget_exhausted"; contentSha256: string }> {
  const attribution = modelResultAttribution(error);
  await input.budget.refreshAccounting();
  const action = decision?.action === "finalize" ? "finalize" as const : input.budget.exhaustion
    ? ("budget_exhausted" as const)
    : ("retry" as const);
  const content = {
    kind: "napier.model-context-overflow" as const,
    schemaVersion: 1 as const,
    evidenceRole: "diagnostic" as const,
    action,
    ...(decision ? { recoveryReadiness: decision.readiness } : {}),
    provider: model.provider,
    model: model.id,
    diagnosticSha256: sha256(error.errorMessage ?? ""),
    ...(attribution ? modelAccountingLinkage(attribution) : {}),
    modelContextEnvelopeSha256: envelope.contentSha256,
    modelContextEnvelopeTurnIndex: envelope.turnIndex,
    modelContextMessageSetSha256: envelope.messageSetSha256,
    modelContextToolDefinitionSetSha256: envelope.toolDefinitionSetSha256,
  };
  const contentSha256 = sha256(canonicalJson(content));
  const event = await input.host.store.appendEvent({
    threadId: input.run.threadId,
    runId: input.run.id,
    type: "model.context.overflow",
    category: "model",
    visibility: "debug",
    payload: { ...content, contentSha256 },
  });
  if (input.onEvent) {
    try {
      await input.onEvent(event);
    } catch {
      // Durable overflow evidence survives a disconnected stream.
    }
  }
  return { action, contentSha256 };
}

/** The failed main response becomes hidden only when recovery actually starts. */
export async function recordHiddenContextOverflowResponse(
  input: RecoveryEvidenceInput,
  model: Model<Api>,
  error: AssistantMessage,
  envelope: ModelContextEnvelopeReceipt,
): Promise<void> {
  const attribution = modelResultAttribution(error), usage = mapModelUsage(error.usage);
  const usageAccounting = createUsageAccounting({ provider: model.provider, id: model.id }, usage);
  input.budget.observeAuxiliaryUsage(usage, Date.now(), usageAccounting);
  await input.budget.refreshAccounting();
  const event = await input.host.store.appendEvent({
    threadId: input.run.threadId, runId: input.run.id, type: "model.response", category: "model", visibility: "debug",
    payload: { model: `${error.provider}/${error.model}`, stopReason: error.stopReason,
      responseSha256: sha256(canonicalJson(error)), responseDisposition: "context_overflow_retry",
      diagnosticSha256: sha256(error.errorMessage ?? ""), usage, usageAccounting,
      ...(attribution ? modelAccountingLinkage(attribution) : {}),
      modelContextEnvelopeSha256: envelope.contentSha256, modelContextEnvelopeTurnIndex: envelope.turnIndex,
      modelContextMessageSetSha256: envelope.messageSetSha256,
      modelContextToolDefinitionSetSha256: envelope.toolDefinitionSetSha256 },
  });
  try { await input.onEvent?.(event); } catch { /* The hidden failed response remains durable. */ }
}

/** Diagnostic continuation only: no usage, logical response or retry authority. */
export async function recordContextOverflowStopped(
  input: Pick<RecoveryEvidenceInput, "host" | "run" | "onEvent">,
  overflowEventSha256: string,
  readiness: "cancelled" | "pending_timeout",
): Promise<void> {
  const content = { kind: "napier.model-context-overflow-recovery-stopped", schemaVersion: 1,
    action: "finalize", recoveryReadiness: readiness, overflowEventSha256 };
  const event = await input.host.store.appendEvent({
    threadId: input.run.threadId, runId: input.run.id,
    type: "model.context.overflow_recovery_stopped", category: "model", visibility: "debug",
    payload: { ...content, contentSha256: sha256(canonicalJson(content)) },
  });
  try { await input.onEvent?.(event); } catch { /* Durable diagnostic survives a disconnected observer. */ }
}

export async function recordDetection(
  input: RecoveryEvidenceInput,
  model: Model<Api>,
  evidence: ModelThinkingLoopEvidence,
  action: "retry" | "finalize",
  envelope: ModelContextEnvelopeReceipt | undefined,
  terminalMessage?: AssistantMessage,
  trace?: ModelThinkingTraceSnapshot,
  invocationAttribution?: ModelCallAttributionV1,
  recovery?: { readiness: ModelRecoveryReadiness; outputDisposition: "suppressed_thinking_recovery" },
): Promise<"retry" | "finalize" | "budget_exhausted"> {
  const attribution = modelResultAttribution(terminalMessage) ?? invocationAttribution;
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
  await input.budget.refreshAccounting();
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
    ...(attribution ? modelAccountingLinkage(attribution) : {}),
    usageSource: terminalMessage
      ? "provider_terminal"
      : "reasoning_bytes_estimate",
    usageAccounting,
    ...(recovery ? { recoveryReadiness: recovery.readiness, outputDisposition: recovery.outputDisposition } : {}),
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
