import type { RunEvent } from "@napier/contracts";

import {
  COMPILED_PROMPT_PACKAGE_EVENT,
  validateCompiledPromptPackageReceipt,
} from "./compiled-prompt-package.js";
import {
  assertModelContextEnvelopeEventBindings,
  MODEL_CONTEXT_ENVELOPE_EVENT,
  validateModelContextEnvelopeReceipt,
} from "./model-context-envelope.js";
import { validateModelAdapterReceipt } from "./model-adapters.js";
import {
  CONTEXT_PROJECTION_EVENT,
  validateContextProjectionReceipt,
} from "./context-projection-receipt.js";
import {
  projectionInvocationEvents,
  projectionPromptSourcesMatch,
  projectionSourceReceiptsMatch,
} from "./context-projection-evidence.js";

export const MODEL_ADAPTER_EVENT = "context.model_adapter";

export function assertModelRequestEvidenceBindings(
  events: readonly RunEvent[],
  options: {
    knownRunIds?: ReadonlySet<string>;
    label?: string;
  } = {},
): void {
  const label = options.label ?? "Model request evidence";
  assertModelContextEnvelopeEventBindings(events, {
    ...options,
    label: `${label} Model Context Envelope`,
  });
  assertContextProjectionEventBindings(events, {
    ...options,
    label: `${label} Context Projection`,
  });
  assertModelPromptEvidenceBindings(events, {
    ...options,
    label: `${label} Model Prompt evidence`,
  });
}

export function assertContextProjectionEventBindings(
  events: readonly RunEvent[],
  options: { knownRunIds?: ReadonlySet<string>; label?: string } = {},
): void {
  const label = options.label ?? "Context Projection";
  for (const [index, event] of events.entries()) {
    if (event.type !== CONTEXT_PROJECTION_EVENT) continue;
    assertContextProjectionEventBinding(events, index, event, {
      ...(options.knownRunIds ? { knownRunIds: options.knownRunIds } : {}),
      label,
    });
  }
}

type ProjectionReceipt = ReturnType<typeof validateContextProjectionReceipt>;

interface ProjectionInvocationEvidence {
  envelope: RunEvent | undefined;
  adapter: RunEvent | undefined;
  promptPackage: RunEvent | undefined;
  envelopeReceipt:
    | ReturnType<typeof validateModelContextEnvelopeReceipt>
    | undefined;
  adapterReceipt: ReturnType<typeof validateModelAdapterReceipt> | undefined;
  packageReceipt:
    | ReturnType<typeof validateCompiledPromptPackageReceipt>
    | undefined;
}

interface CompleteProjectionInvocationEvidence extends ProjectionInvocationEvidence {
  envelope: RunEvent;
  adapter: RunEvent;
  promptPackage: RunEvent;
  envelopeReceipt: ReturnType<typeof validateModelContextEnvelopeReceipt>;
  adapterReceipt: ReturnType<typeof validateModelAdapterReceipt>;
  packageReceipt: ReturnType<typeof validateCompiledPromptPackageReceipt>;
}

function assertContextProjectionEventBinding(
  events: readonly RunEvent[],
  index: number,
  event: RunEvent,
  options: { knownRunIds?: ReadonlySet<string>; label: string },
): void {
  if (options.knownRunIds && !options.knownRunIds.has(event.runId)) {
    throw new Error(`${options.label} references unknown Run: ${event.runId}`);
  }
  const receipt = validateContextProjectionReceipt(event.payload);
  assertProjectionSourceBinding(events, index, event, receipt, options.label);
  if (receipt.status === "unavailable") return;
  assertProjectionOutputBinding(events, index, event, receipt, options.label);
}

function assertProjectionSourceBinding(
  events: readonly RunEvent[],
  index: number,
  event: RunEvent,
  receipt: ProjectionReceipt,
  label: string,
): void {
  const pruning = latestPriorEvent(
    events,
    index,
    event.runId,
    "model.context.tool-results.pruned",
  );
  const pressure = latestPriorEvent(
    events,
    index,
    event.runId,
    "model.context.token_pressure",
  );
  if (
    !validProjectionSourceSequence(event, pruning, pressure) ||
    !projectionSourceReceiptsMatch(receipt, pruning?.payload, pressure?.payload)
  ) {
    throw new Error(
      `${label} source receipt binding is invalid: ${event.runId}`,
    );
  }
}

function latestPriorEvent(
  events: readonly RunEvent[],
  index: number,
  runId: string,
  type: string,
): RunEvent | undefined {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const candidate = events[cursor]!;
    if (candidate.runId === runId && candidate.type === type) return candidate;
  }
  return undefined;
}

function validProjectionSourceSequence(
  event: RunEvent,
  pruning: RunEvent | undefined,
  pressure: RunEvent | undefined,
): boolean {
  if (!pruning || !pressure) return false;
  return pruning.seq < pressure.seq && pressure.seq < event.seq;
}

function assertProjectionOutputBinding(
  events: readonly RunEvent[],
  index: number,
  event: RunEvent,
  receipt: ProjectionReceipt,
  label: string,
): void {
  const evidence = collectProjectionInvocationEvidence(
    events,
    index,
    event.runId,
  );
  if (
    !completeProjectionInvocationEvidence(evidence) ||
    evidence.adapterReceipt.schemaVersion !== 2 ||
    evidence.packageReceipt.schemaVersion !== 3 ||
    !projectionOutputSequenceMatches(event, evidence) ||
    !projectionEnvelopeMatches(receipt, evidence) ||
    !projectionAdapterMatches(receipt, evidence) ||
    !projectionPromptSourcesMatch(receipt, evidence.packageReceipt)
  ) {
    throw new Error(`${label} envelope binding is invalid: ${event.runId}`);
  }
}

function collectProjectionInvocationEvidence(
  events: readonly RunEvent[],
  index: number,
  runId: string,
): ProjectionInvocationEvidence {
  const invocationEvents = projectionInvocationEvents(events, runId, index);
  const envelope = invocationEvents.find(
    (candidate) => candidate.type === MODEL_CONTEXT_ENVELOPE_EVENT,
  );
  const adapter = invocationEvents.find(
    (candidate) => candidate.type === MODEL_ADAPTER_EVENT,
  );
  const promptPackage = invocationEvents.find(
    (candidate) => candidate.type === COMPILED_PROMPT_PACKAGE_EVENT,
  );
  return {
    envelope,
    adapter,
    promptPackage,
    envelopeReceipt: envelope
      ? validateModelContextEnvelopeReceipt(envelope.payload)
      : undefined,
    adapterReceipt: adapter
      ? validateModelAdapterReceipt(adapter.payload)
      : undefined,
    packageReceipt: promptPackage
      ? validateCompiledPromptPackageReceipt(promptPackage.payload)
      : undefined,
  };
}

function completeProjectionInvocationEvidence(
  evidence: ProjectionInvocationEvidence,
): evidence is CompleteProjectionInvocationEvidence {
  return Boolean(
    evidence.envelope &&
    evidence.adapter &&
    evidence.promptPackage &&
    evidence.envelopeReceipt &&
    evidence.adapterReceipt &&
    evidence.packageReceipt,
  );
}

function projectionOutputSequenceMatches(
  event: RunEvent,
  evidence: CompleteProjectionInvocationEvidence,
): boolean {
  return (
    evidence.envelope.seq > event.seq &&
    evidence.adapter.seq > evidence.envelope.seq &&
    evidence.promptPackage.seq > evidence.adapter.seq
  );
}

function projectionEnvelopeMatches(
  receipt: ProjectionReceipt,
  evidence: CompleteProjectionInvocationEvidence,
): boolean {
  return (
    receipt.activeMessageCount === evidence.envelopeReceipt.messageCount &&
    receipt.activeMessageSetSha256 ===
      evidence.envelopeReceipt.messageSetSha256 &&
    receipt.toolCount === evidence.envelopeReceipt.toolCount &&
    receipt.toolDefinitionSetSha256 ===
      evidence.envelopeReceipt.toolDefinitionSetSha256 &&
    receipt.systemPromptBytes === evidence.envelopeReceipt.systemPromptBytes &&
    receipt.systemPromptSha256 === evidence.envelopeReceipt.systemPromptSha256
  );
}

function projectionAdapterMatches(
  receipt: ProjectionReceipt,
  evidence: CompleteProjectionInvocationEvidence,
): boolean {
  return (
    receipt.cacheRetention === evidence.adapterReceipt.cacheRetention &&
    receipt.cacheRetentionSource ===
      evidence.adapterReceipt.cacheRetentionSource &&
    receipt.adapterContentSha256 === evidence.adapterReceipt.contentSha256
  );
}

export function assertModelPromptEvidenceBindings(
  events: readonly RunEvent[],
  options: {
    knownRunIds?: ReadonlySet<string>;
    label?: string;
  } = {},
): void {
  const label = options.label ?? "Model Prompt evidence";
  const runs = new Map<string, PromptEvidenceRun>();
  for (const event of events) {
    if (
      event.type !== MODEL_CONTEXT_ENVELOPE_EVENT &&
      event.type !== MODEL_ADAPTER_EVENT &&
      event.type !== COMPILED_PROMPT_PACKAGE_EVENT &&
      event.type !== "model.response" &&
      event.type !== "model.context.overflow" &&
      event.type !== "model.thinking_loop.detected"
    ) {
      continue;
    }
    if (options.knownRunIds && !options.knownRunIds.has(event.runId)) {
      throw new Error(`${label} references unknown Run: ${event.runId}`);
    }
    const run = runs.get(event.runId) ?? createRunEvidence();
    runs.set(event.runId, run);
    if (event.type === MODEL_CONTEXT_ENVELOPE_EVENT) {
      run.envelopes.push({
        event,
        receipt: validateModelContextEnvelopeReceipt(event.payload),
      });
    } else if (event.type === MODEL_ADAPTER_EVENT) {
      run.adapters.push({
        event,
        receipt: validateModelAdapterReceipt(event.payload),
      });
    } else if (event.type === COMPILED_PROMPT_PACKAGE_EVENT) {
      run.packages.push({
        event,
        receipt: validateCompiledPromptPackageReceipt(event.payload),
      });
    } else {
      const turnIndex = responseTurnIndex(event);
      const payload =
        event.payload &&
        typeof event.payload === "object" &&
        !Array.isArray(event.payload)
          ? event.payload
          : undefined;
      if (
        turnIndex !== undefined &&
        (event.type === "model.response" ||
          event.type === "model.context.overflow" ||
          payload?.["action"] === "retry")
      ) {
        if (run.responses.has(turnIndex)) {
          throw new Error(
            `${label} terminal binding is duplicated: ${event.runId}`,
          );
        }
        run.responses.set(turnIndex, event);
      }
    }
  }
  for (const [runId, run] of runs) {
    assertRunEvidence(runId, run, label);
  }
}

interface PromptEvidenceRun {
  envelopes: Array<{
    event: RunEvent;
    receipt: ReturnType<typeof validateModelContextEnvelopeReceipt>;
  }>;
  adapters: Array<{
    event: RunEvent;
    receipt: ReturnType<typeof validateModelAdapterReceipt>;
  }>;
  packages: Array<{
    event: RunEvent;
    receipt: ReturnType<typeof validateCompiledPromptPackageReceipt>;
  }>;
  responses: Map<number, RunEvent>;
}

function createRunEvidence(): PromptEvidenceRun {
  return {
    envelopes: [],
    adapters: [],
    packages: [],
    responses: new Map(),
  };
}

function assertRunEvidence(
  runId: string,
  run: PromptEvidenceRun,
  label: string,
): void {
  const modern = run.adapters.length > 0 || run.packages.length > 0;
  if (!modern) return;
  if (
    run.envelopes.length === 0 ||
    run.adapters.length !== run.envelopes.length ||
    (run.packages.length > 0 && run.packages.length !== run.envelopes.length)
  ) {
    throw new Error(`${label} count is invalid: ${runId}`);
  }
  for (const [index, envelope] of run.envelopes.entries()) {
    const adapter = run.adapters[index]!;
    const promptPackage = run.packages[index];
    const turnIndex = envelope.receipt.turnIndex;
    const response = run.responses.get(turnIndex);
    if (
      adapter.event.seq <= envelope.event.seq ||
      !response ||
      response.seq <= adapter.event.seq
    ) {
      throw new Error(`${label} sequence is invalid: ${runId}`);
    }
    if (!promptPackage) continue;
    if (
      promptPackage.event.seq <= adapter.event.seq ||
      response.seq <= promptPackage.event.seq
    ) {
      throw new Error(`${label} sequence is invalid: ${runId}`);
    }
    if (
      promptPackage.receipt.turnIndex !== turnIndex ||
      promptPackage.receipt.systemPromptSha256 !==
        envelope.receipt.systemPromptSha256 ||
      promptPackage.receipt.systemPromptBytes !==
        envelope.receipt.systemPromptBytes ||
      promptPackage.receipt.effectiveCapabilities.toolCount !==
        envelope.receipt.toolCount ||
      promptPackage.receipt.effectiveCapabilities.toolNameSetSha256 !==
        envelope.receipt.toolNameSetSha256 ||
      promptPackage.receipt.effectiveCapabilities.toolDefinitionSetSha256 !==
        envelope.receipt.toolDefinitionSetSha256 ||
      promptPackage.receipt.modelAdapter.adapterId !==
        adapter.receipt.adapterId ||
      promptPackage.receipt.modelAdapter.adapterContentSha256 !==
        adapter.receipt.contentSha256
    ) {
      throw new Error(`${label} binding is invalid: ${runId}`);
    }
  }
}

function responseTurnIndex(event: RunEvent): number | undefined {
  if (
    !event.payload ||
    Array.isArray(event.payload) ||
    typeof event.payload !== "object"
  ) {
    return undefined;
  }
  const value = event.payload["modelContextEnvelopeTurnIndex"];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}
