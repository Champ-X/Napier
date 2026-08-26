import type { ContextProjectionReceiptV1 } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import type { ModelContextTokenPressureReceipt } from "./model-context-token-pressure.js";
import type { CompiledPromptArtifact } from "./prompt-compiler.js";
import type { ToolResultContextPruningReceipt } from "./tool-result-context-pruner.js";

export const CONTEXT_PROJECTION_EVENT = "context.projected";

export interface ContextProjectionPreparationReceipt {
  durableMessageCount: number;
  durableMessageSetSha256: string;
  prePruningMessageCount: number;
  prePruningMessageSetSha256: string;
  postPruningMessageCount: number;
  postPruningMessageSetSha256: string;
  pruning: ToolResultContextPruningReceipt;
}

export function createContextProjectionReceipt(input: {
  provider: string;
  model: string;
  modelAttempt: number;
  recoveryAttempt: 0 | 1;
  toolCount: number;
  toolDefinitionSetSha256: string;
  compiledPrompt: CompiledPromptArtifact;
  prepared: ContextProjectionPreparationReceipt;
  pressure: ModelContextTokenPressureReceipt;
}): ContextProjectionReceiptV1 {
  const promptSources = input.compiledPrompt.layers.flatMap((layer) =>
    layer.sources.map((source) => ({
      sourceIdSha256: sha256(source.sourceId),
      inputContentSha256: source.inputContentSha256,
      included: source.included,
      trimmingReason: source.trimmingReason,
    })),
  );
  const projected =
    input.prepared.pruning.replacementCount > 0 ||
    input.pressure.status === "projected";
  const content = {
    kind: "napier.context-projection" as const,
    schemaVersion: 1 as const,
    status:
      input.pressure.status === "unavailable"
        ? ("unavailable" as const)
        : projected
          ? ("projected" as const)
          : ("within_budget" as const),
    provider: input.provider,
    model: input.model,
    modelAttempt: input.modelAttempt,
    recoveryAttempt: input.recoveryAttempt,
    durableMessageSource: "durable_run_context" as const,
    durableMessageCount: input.prepared.durableMessageCount,
    durableMessageSetSha256: input.prepared.durableMessageSetSha256,
    prePruningMessageCount: input.prepared.prePruningMessageCount,
    prePruningMessageSetSha256: input.prepared.prePruningMessageSetSha256,
    postPruningMessageCount: input.prepared.postPruningMessageCount,
    postPruningMessageSetSha256: input.prepared.postPruningMessageSetSha256,
    preparedMessageCount: input.pressure.originalMessageCount,
    preparedMessageSetSha256: input.pressure.originalMessageSetSha256,
    activeMessageCount: input.pressure.activeMessageCount,
    activeMessageSetSha256: input.pressure.activeMessageSetSha256,
    toolCount: input.toolCount,
    toolDefinitionSetSha256: input.toolDefinitionSetSha256,
    systemPromptBytes: input.compiledPrompt.systemPromptBytes,
    systemPromptSha256: input.compiledPrompt.systemPromptSha256,
    promptSourceCount: promptSources.length,
    includedPromptSourceCount: promptSources.filter((source) => source.included)
      .length,
    omittedPromptSourceCount: promptSources.filter((source) => !source.included)
      .length,
    promptSourceSetSha256: sha256(canonicalJson(promptSources)),
    skillCatalog: componentState(input.compiledPrompt, "task.skill_catalog"),
    memory: componentState(input.compiledPrompt, "workspace.memory"),
    compactionCheckpoint: componentState(
      input.compiledPrompt,
      "workspace.checkpoint",
    ),
    toolResultPruning:
      input.prepared.pruning.replacementCount > 0
        ? ("applied" as const)
        : ("none" as const),
    prunedToolResultCount: input.prepared.pruning.replacementCount,
    prunedToolResultBytes: input.prepared.pruning.savedToolResultTextBytes,
    tokenProjection: input.pressure.projection,
    removedMessageCount: input.pressure.removedMessageCount,
    removedUnitCount: input.pressure.removedUnitCount,
    cacheRetention: input.compiledPrompt.adapter.cacheRetention,
    cacheRetentionSource: input.compiledPrompt.adapter.cacheRetentionSource,
    adapterContentSha256: input.compiledPrompt.adapter.contentSha256,
    contentClass: input.pressure.contentClass,
    meterProviderId: input.pressure.meterProviderId,
    estimateMethod: input.pressure.estimateMethod,
    activeEstimatedInputTokens:
      input.pressure.activeEstimatedTotalTokens -
      input.pressure.outputReserveTokens -
      input.pressure.reasoningReserveTokens -
      input.pressure.safetyReserveTokens,
    outputReserveTokens: input.pressure.outputReserveTokens,
    reasoningReserveTokens: input.pressure.reasoningReserveTokens,
    safetyReserveTokens: input.pressure.safetyReserveTokens,
    activeEstimatedTotalTokens: input.pressure.activeEstimatedTotalTokens,
    contextWindowTokens: input.pressure.contextWindowTokens,
    pruningReceiptSha256: input.prepared.pruning.contentSha256,
    tokenPressureReceiptSha256: input.pressure.contentSha256,
  };
  return validateContextProjectionReceipt({
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  });
}

const RECEIPT_KEYS = [
  "kind",
  "schemaVersion",
  "status",
  "provider",
  "model",
  "modelAttempt",
  "recoveryAttempt",
  "durableMessageSource",
  "durableMessageCount",
  "durableMessageSetSha256",
  "prePruningMessageCount",
  "prePruningMessageSetSha256",
  "postPruningMessageCount",
  "postPruningMessageSetSha256",
  "preparedMessageCount",
  "preparedMessageSetSha256",
  "activeMessageCount",
  "activeMessageSetSha256",
  "toolCount",
  "toolDefinitionSetSha256",
  "systemPromptBytes",
  "systemPromptSha256",
  "promptSourceCount",
  "includedPromptSourceCount",
  "omittedPromptSourceCount",
  "promptSourceSetSha256",
  "skillCatalog",
  "memory",
  "compactionCheckpoint",
  "toolResultPruning",
  "prunedToolResultCount",
  "prunedToolResultBytes",
  "tokenProjection",
  "removedMessageCount",
  "removedUnitCount",
  "cacheRetention",
  "cacheRetentionSource",
  "adapterContentSha256",
  "contentClass",
  "meterProviderId",
  "estimateMethod",
  "activeEstimatedInputTokens",
  "outputReserveTokens",
  "reasoningReserveTokens",
  "safetyReserveTokens",
  "activeEstimatedTotalTokens",
  "contextWindowTokens",
  "pruningReceiptSha256",
  "tokenPressureReceiptSha256",
  "contentSha256",
] as const;
const NUMBER_KEYS = [
  "modelAttempt",
  "recoveryAttempt",
  "durableMessageCount",
  "prePruningMessageCount",
  "postPruningMessageCount",
  "preparedMessageCount",
  "activeMessageCount",
  "toolCount",
  "systemPromptBytes",
  "promptSourceCount",
  "includedPromptSourceCount",
  "omittedPromptSourceCount",
  "prunedToolResultCount",
  "prunedToolResultBytes",
  "removedMessageCount",
  "removedUnitCount",
  "activeEstimatedInputTokens",
  "outputReserveTokens",
  "reasoningReserveTokens",
  "safetyReserveTokens",
  "activeEstimatedTotalTokens",
  "contextWindowTokens",
] as const;
const HASH_KEYS = [
  "durableMessageSetSha256",
  "prePruningMessageSetSha256",
  "postPruningMessageSetSha256",
  "preparedMessageSetSha256",
  "activeMessageSetSha256",
  "toolDefinitionSetSha256",
  "systemPromptSha256",
  "promptSourceSetSha256",
  "adapterContentSha256",
  "pruningReceiptSha256",
  "tokenPressureReceiptSha256",
] as const;

export function validateContextProjectionReceipt(
  input: unknown,
): ContextProjectionReceiptV1 {
  if (!record(input)) throw invalidReceipt();
  const receipt = input as unknown as ContextProjectionReceiptV1;
  const { contentSha256, ...content } = receipt;
  if (
    !exactKeys(input, RECEIPT_KEYS) ||
    !validIdentity(receipt) ||
    !validScalars(receipt, contentSha256) ||
    !validCounts(receipt) ||
    !validEnums(receipt) ||
    !validProjectionState(receipt) ||
    sha256(canonicalJson(content)) !== contentSha256
  )
    throw invalidReceipt();
  return structuredClone(receipt);
}

function validIdentity(receipt: ContextProjectionReceiptV1): boolean {
  return (
    receipt.kind === "napier.context-projection" &&
    receipt.schemaVersion === 1 &&
    boundedText(receipt.provider) &&
    boundedText(receipt.model) &&
    receipt.durableMessageSource === "durable_run_context" &&
    receipt.modelAttempt >= 1 &&
    (receipt.recoveryAttempt === 0 || receipt.recoveryAttempt === 1)
  );
}

function validScalars(
  receipt: ContextProjectionReceiptV1,
  contentSha256: unknown,
): boolean {
  return (
    NUMBER_KEYS.every((field) => nonNegativeInteger(receipt[field])) &&
    HASH_KEYS.every((field) => hash(receipt[field])) &&
    hash(contentSha256) &&
    boundedText(receipt.meterProviderId) &&
    boundedText(receipt.estimateMethod)
  );
}

function validCounts(receipt: ContextProjectionReceiptV1): boolean {
  return (
    receipt.durableMessageCount === receipt.prePruningMessageCount &&
    receipt.durableMessageSetSha256 === receipt.prePruningMessageSetSha256 &&
    receipt.prePruningMessageCount === receipt.postPruningMessageCount &&
    receipt.includedPromptSourceCount + receipt.omittedPromptSourceCount ===
      receipt.promptSourceCount &&
    receipt.activeMessageCount + receipt.removedMessageCount ===
      receipt.preparedMessageCount &&
    receipt.activeEstimatedInputTokens +
      receipt.outputReserveTokens +
      receipt.reasoningReserveTokens +
      receipt.safetyReserveTokens ===
      receipt.activeEstimatedTotalTokens
  );
}

function validEnums(receipt: ContextProjectionReceiptV1): boolean {
  const componentStates = ["absent", "included", "omitted"] as const;
  return (
    oneOf(receipt.status, ["within_budget", "projected", "unavailable"]) &&
    oneOf(receipt.skillCatalog, componentStates) &&
    oneOf(receipt.memory, componentStates) &&
    oneOf(receipt.compactionCheckpoint, componentStates) &&
    oneOf(receipt.toolResultPruning, ["none", "applied"]) &&
    oneOf(receipt.tokenProjection, ["none", "oldest_complete_units_removed"]) &&
    oneOf(receipt.cacheRetention, [
      "none",
      "short",
      "long",
      "provider_default",
    ]) &&
    oneOf(receipt.cacheRetentionSource, [
      "caller",
      "adapter",
      "provider_default",
    ]) &&
    oneOf(receipt.contentClass, ["text", "structured", "multimodal"])
  );
}

function componentState(
  prompt: CompiledPromptArtifact,
  sourceId: string,
): ContextProjectionReceiptV1["skillCatalog"] {
  const source = prompt.layers
    .flatMap((layer) => layer.sources)
    .find((candidate) => candidate.sourceId === sourceId);
  return source ? (source.included ? "included" : "omitted") : "absent";
}

function validProjectionState(receipt: ContextProjectionReceiptV1): boolean {
  const pruned = receipt.prunedToolResultCount > 0;
  const pressure = receipt.removedMessageCount > 0;
  return (
    (receipt.toolResultPruning === "applied") === pruned &&
    receipt.prunedToolResultBytes > 0 === pruned &&
    (receipt.tokenProjection === "oldest_complete_units_removed") ===
      pressure &&
    (pressure || receipt.removedUnitCount === 0) &&
    (receipt.status !== "within_budget" || (!pruned && !pressure)) &&
    (receipt.status !== "projected" || pruned || pressure) &&
    (receipt.status === "unavailable" ||
      receipt.activeEstimatedTotalTokens <= receipt.contextWindowTokens)
  );
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function oneOf<T>(value: unknown, candidates: readonly T[]): value is T {
  return candidates.includes(value as T);
}

function boundedText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function invalidReceipt(): Error {
  return new Error("Context Projection receipt is invalid");
}
