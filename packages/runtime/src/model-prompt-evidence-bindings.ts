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
  assertModelPromptEvidenceBindings(events, {
    ...options,
    label: `${label} Model Prompt evidence`,
  });
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
