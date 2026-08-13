import type {
  ModelContextEnvelopeReceipt,
  ModelInvocationPurpose,
} from "@napier/contracts";

import {
  COMPILED_PROMPT_PACKAGE_VERSION_V3,
  type CompiledPromptLayerReceiptV3,
  type CompiledPromptPackageReceiptV3,
  type CompiledPromptSourceReceipt,
} from "./compiled-prompt-package-v3-types.js";
export {
  COMPILED_PROMPT_PACKAGE_VERSION_V3,
  type CompiledPromptLayerReceiptV3,
  type CompiledPromptPackageReceiptV3,
  type CompiledPromptSourceReceipt,
} from "./compiled-prompt-package-v3-types.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import type { ModelAdapterReceiptV2 } from "./model-adapters.js";
import { validateModelAdapterReceipt } from "./model-adapters.js";
import type {
  CompiledPromptArtifact,
  CompiledPromptLayerId,
  CompiledPromptSourceArtifact,
} from "./prompt-compiler.js";
import {
  PROMPT_COMPILER_ASSEMBLY,
  PROMPT_COMPILER_VERSION,
  validateCompiledPromptArtifact,
} from "./prompt-compiler.js";
import {
  PROMPT_INVARIANT_CORE_CONTENT_SHA256,
  PROMPT_INVARIANT_CORE_VERSION,
} from "./prompt-invariant-core.js";

const LAYER_IDS: readonly CompiledPromptLayerId[] = [
  "invariant_core",
  "effective_capabilities",
  "task_skill_overlay",
  "workspace_context",
  "model_adapter",
];
const HASH = /^[a-f0-9]{64}$/u;
const PURPOSES = new Set<ModelInvocationPurpose>([
  "agent_turn",
  "context_compaction",
  "goal_evaluation",
  "memory_extraction",
]);

export function createCompiledPromptPackageReceiptV3(input: {
  compiled: CompiledPromptArtifact;
  envelope: ModelContextEnvelopeReceipt;
  adapter: ModelAdapterReceiptV2;
  purpose: ModelInvocationPurpose;
}): CompiledPromptPackageReceiptV3 {
  validateCompiledPromptArtifact(input.compiled);
  const adapter = validateModelAdapterReceipt(input.adapter);
  if (adapter.schemaVersion !== 2) {
    throw new Error("Prompt Compiler requires a modern Model Adapter");
  }
  if (
    !PURPOSES.has(input.purpose) ||
    input.compiled.purpose !== input.purpose ||
    input.compiled.adapter.contentSha256 !== adapter.contentSha256 ||
    input.compiled.systemPromptSha256 !== input.envelope.systemPromptSha256 ||
    input.compiled.systemPromptBytes !== input.envelope.systemPromptBytes
  ) {
    throw new Error("Compiled Prompt package compiler binding is invalid");
  }
  const layers = input.compiled.layers.map(toLayerReceipt);
  const partitionSha256 = layerPartitionSha256(layers);
  const content = {
    kind: "napier.compiled-prompt-package" as const,
    schemaVersion: 3 as const,
    packageVersion: COMPILED_PROMPT_PACKAGE_VERSION_V3,
    compilerVersion: PROMPT_COMPILER_VERSION,
    purpose: input.purpose,
    invariantCore: invariantCoreBinding(input.purpose, layers[0]!),
    turnIndex: input.envelope.turnIndex,
    classification: "independent_layers_v1" as const,
    assembly: PROMPT_COMPILER_ASSEMBLY,
    tokenEstimateMethod: "sum_layer_ceil_utf8_bytes_div_4" as const,
    systemPromptSha256: input.envelope.systemPromptSha256,
    systemPromptBytes: input.envelope.systemPromptBytes,
    estimatedTokens: layers.reduce(
      (total, layer) => total + layer.estimatedTokens,
      0,
    ),
    segmentCount: layers.reduce(
      (total, layer) => total + layer.segmentCount,
      0,
    ),
    partitionSha256,
    lossless: true as const,
    layers,
    effectiveCapabilities: {
      toolCount: input.envelope.toolCount,
      toolNameSetSha256: input.envelope.toolNameSetSha256,
      toolDefinitionSetSha256: input.envelope.toolDefinitionSetSha256,
    },
    modelAdapter: {
      adapterId: adapter.adapterId,
      adapterContentSha256: adapter.contentSha256,
    },
  };
  return validateCompiledPromptPackageReceiptV3({
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  });
}

export function validateCompiledPromptPackageReceiptV3(
  input: unknown,
): CompiledPromptPackageReceiptV3 {
  const value = record(input);
  const keys = [
    "kind",
    "schemaVersion",
    "packageVersion",
    "compilerVersion",
    "purpose",
    "invariantCore",
    "turnIndex",
    "classification",
    "assembly",
    "tokenEstimateMethod",
    "systemPromptSha256",
    "systemPromptBytes",
    "estimatedTokens",
    "segmentCount",
    "partitionSha256",
    "lossless",
    "layers",
    "effectiveCapabilities",
    "modelAdapter",
    "contentSha256",
  ];
  const scalarFieldsValid = [
    exactKeys(value, keys),
    value["kind"] === "napier.compiled-prompt-package",
    value["schemaVersion"] === 3,
    value["packageVersion"] === COMPILED_PROMPT_PACKAGE_VERSION_V3,
    value["compilerVersion"] === PROMPT_COMPILER_VERSION,
    PURPOSES.has(value["purpose"] as ModelInvocationPurpose),
    value["classification"] === "independent_layers_v1",
    value["assembly"] === PROMPT_COMPILER_ASSEMBLY,
    value["tokenEstimateMethod"] === "sum_layer_ceil_utf8_bytes_div_4",
    value["lossless"] === true,
    integer(value["turnIndex"]),
    integer(value["systemPromptBytes"]),
    integer(value["estimatedTokens"]),
    integer(value["segmentCount"]),
    hash(value["systemPromptSha256"]),
    hash(value["partitionSha256"]),
    hash(value["contentSha256"]),
    Array.isArray(value["layers"]),
  ].every(Boolean);
  if (!scalarFieldsValid) {
    throw new Error("Compiled Prompt package v3 receipt is invalid");
  }
  const layers = (value["layers"] as unknown[]).map(validateLayer);
  const capabilities = validateCapabilities(value["effectiveCapabilities"]);
  const modelAdapter = validateAdapter(value["modelAdapter"]);
  const adapterSource = layers[4]!.sources[0];
  const adapterFamily = modelAdapter.adapterId.includes("anthropic")
    ? "anthropic"
    : modelAdapter.adapterId.includes("openai")
      ? "openai"
      : "generic";
  if (
    layers[4]!.sources.length !== 1 ||
    adapterSource?.sourceId !== `model_adapter.${adapterFamily}` ||
    !adapterSource.required ||
    !adapterSource.included
  )
    invalid("Adapter layer binding");
  validateInvariantCore(
    value["invariantCore"],
    value["purpose"] as ModelInvocationPurpose,
    layers[0]!,
  );
  const nonemptyLayers = layers.filter((layer) => layer.bytes > 0).length;
  if (
    layers.length !== LAYER_IDS.length ||
    layers.some((layer, index) => layer.id !== LAYER_IDS[index]) ||
    layers.reduce((total, layer) => total + layer.estimatedTokens, 0) !==
      value["estimatedTokens"] ||
    layers.reduce((total, layer) => total + layer.segmentCount, 0) !==
      value["segmentCount"] ||
    layers.reduce((total, layer) => total + layer.bytes, 0) +
      Math.max(0, nonemptyLayers - 1) * 2 !==
      value["systemPromptBytes"] ||
    layerPartitionSha256(layers) !== value["partitionSha256"]
  ) {
    throw new Error("Compiled Prompt package v3 layer binding is invalid");
  }
  const receipt = {
    ...structuredClone(value),
    layers,
    effectiveCapabilities: capabilities,
    modelAdapter,
  } as CompiledPromptPackageReceiptV3;
  const { contentSha256, ...content } = receipt;
  if (sha256(canonicalJson(content)) !== contentSha256) {
    throw new Error("Compiled Prompt package receipt hash mismatch");
  }
  return receipt;
}

function toLayerReceipt(
  layer: CompiledPromptArtifact["layers"][number],
): CompiledPromptLayerReceiptV3 {
  return {
    id: layer.id,
    source: "compiler_input",
    priority: layer.priority,
    budgetBytes: layer.budgetBytes,
    inputBytes: layer.inputBytes,
    segmentCount: layer.sources.filter((source) => source.included).length,
    bytes: layer.bytes,
    estimatedTokens: layer.estimatedTokens,
    inputContentSha256: layer.inputContentSha256,
    contentSha256: layer.contentSha256,
    trimmingReason: layer.trimmingReason,
    sources: layer.sources.map(toSourceReceipt),
  };
}

function toSourceReceipt(
  source: CompiledPromptSourceArtifact,
): CompiledPromptSourceReceipt {
  return { ...source };
}

function validateLayer(input: unknown): CompiledPromptLayerReceiptV3 {
  const value = record(input);
  const sources = Array.isArray(value["sources"])
    ? value["sources"].map(validateSource)
    : invalid("layer sources");
  const included = sources.filter((source) => source.included);
  const valid = [
    exactKeys(value, [
      "id",
      "source",
      "priority",
      "budgetBytes",
      "inputBytes",
      "segmentCount",
      "bytes",
      "estimatedTokens",
      "inputContentSha256",
      "contentSha256",
      "trimmingReason",
      "sources",
    ]),
    LAYER_IDS.includes(value["id"] as CompiledPromptLayerId),
    value["source"] === "compiler_input",
    integer(value["priority"]),
    positiveInteger(value["budgetBytes"]),
    integer(value["inputBytes"]),
    integer(value["segmentCount"]),
    integer(value["bytes"]),
    integer(value["estimatedTokens"]),
    hash(value["inputContentSha256"]),
    hash(value["contentSha256"]),
    ["within_budget", "budget_exceeded"].includes(
      String(value["trimmingReason"]),
    ),
    Number(value["bytes"]) <= Number(value["budgetBytes"]),
    Number(value["inputBytes"]) >= Number(value["bytes"]),
    value["segmentCount"] === included.length,
    value["estimatedTokens"] === Math.ceil(Number(value["bytes"]) / 4),
    new Set(sources.map((source) => source.sourceId)).size === sources.length,
    value["inputContentSha256"] === sourceSetSha256(sources),
    (value["trimmingReason"] === "budget_exceeded") ===
      sources.some((source) => !source.included),
  ].every(Boolean);
  if (!valid) invalid("layer");
  return { ...structuredClone(value), sources } as CompiledPromptLayerReceiptV3;
}

function validateSource(input: unknown): CompiledPromptSourceReceipt {
  const value = record(input);
  if (
    !exactKeys(value, [
      "sourceId",
      "priority",
      "required",
      "inputBytes",
      "inputContentSha256",
      "included",
      "trimmingReason",
    ]) ||
    typeof value["sourceId"] !== "string" ||
    !/^[a-z][a-z0-9_.-]{0,127}$/u.test(value["sourceId"]) ||
    !integer(value["priority"]) ||
    typeof value["required"] !== "boolean" ||
    !integer(value["inputBytes"]) ||
    !hash(value["inputContentSha256"]) ||
    typeof value["included"] !== "boolean" ||
    (value["trimmingReason"] !== "within_budget" &&
      value["trimmingReason"] !== "lower_priority_source_omitted") ||
    value["included"] !== (value["trimmingReason"] === "within_budget") ||
    (value["required"] && !value["included"])
  ) {
    invalid("layer source");
  }
  return structuredClone(value) as unknown as CompiledPromptSourceReceipt;
}

function validateCapabilities(
  input: unknown,
): CompiledPromptPackageReceiptV3["effectiveCapabilities"] {
  const value = record(input);
  if (
    !exactKeys(value, [
      "toolCount",
      "toolNameSetSha256",
      "toolDefinitionSetSha256",
    ]) ||
    !integer(value["toolCount"]) ||
    !hash(value["toolNameSetSha256"]) ||
    !hash(value["toolDefinitionSetSha256"])
  ) {
    invalid("capabilities");
  }
  return structuredClone(
    value,
  ) as CompiledPromptPackageReceiptV3["effectiveCapabilities"];
}

function validateAdapter(
  input: unknown,
): CompiledPromptPackageReceiptV3["modelAdapter"] {
  const value = record(input);
  if (
    !exactKeys(value, ["adapterId", "adapterContentSha256"]) ||
    (value["adapterId"] !== "napier.anthropic-messages.v2" &&
      value["adapterId"] !== "napier.openai-family.v2" &&
      value["adapterId"] !== "napier.generic.v2") ||
    !hash(value["adapterContentSha256"])
  ) {
    invalid("adapter");
  }
  return structuredClone(
    value,
  ) as CompiledPromptPackageReceiptV3["modelAdapter"];
}

function validateInvariantCore(
  input: unknown,
  purpose: ModelInvocationPurpose,
  layer: CompiledPromptLayerReceiptV3,
): void {
  const value = record(input);
  if (
    purpose !== "agent_turn" &&
    exactKeys(value, ["status"]) &&
    value["status"] === "not_applicable" &&
    layer.bytes === 0 &&
    layer.segmentCount === 0 &&
    layer.sources.length === 0
  ) {
    return;
  }
  if (
    !exactKeys(value, ["status", "version", "contentSha256", "bytes"]) ||
    value["status"] !== "bound" ||
    value["version"] !== PROMPT_INVARIANT_CORE_VERSION ||
    value["contentSha256"] !== PROMPT_INVARIANT_CORE_CONTENT_SHA256 ||
    value["bytes"] !== layer.bytes ||
    layer.contentSha256 !== PROMPT_INVARIANT_CORE_CONTENT_SHA256 ||
    layer.sources[0]?.sourceId !== "runtime.invariant_core" ||
    !layer.sources[0]?.required
  ) {
    invalid("Invariant Core");
  }
}

function invariantCoreBinding(
  purpose: ModelInvocationPurpose,
  layer: CompiledPromptLayerReceiptV3,
): CompiledPromptPackageReceiptV3["invariantCore"] {
  return purpose === "agent_turn"
    ? {
        status: "bound",
        version: PROMPT_INVARIANT_CORE_VERSION,
        contentSha256: PROMPT_INVARIANT_CORE_CONTENT_SHA256,
        bytes: layer.bytes,
      }
    : { status: "not_applicable" };
}

function sourceSetSha256(sources: readonly CompiledPromptSourceReceipt[]) {
  return sha256(
    canonicalJson(
      sources.map(({ sourceId, priority, required, inputContentSha256 }) => ({
        sourceId,
        priority,
        required,
        contentSha256: inputContentSha256,
      })),
    ),
  );
}

function layerPartitionSha256(
  layers: readonly CompiledPromptLayerReceiptV3[],
): string {
  return sha256(
    canonicalJson(
      layers.map(({ id, bytes, contentSha256 }) => ({
        id,
        bytes,
        contentSha256,
      })),
    ),
  );
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const observed = Object.keys(value);
  return (
    observed.length === keys.length &&
    observed.every((key) => keys.includes(key))
  );
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function hash(value: unknown): value is string {
  return typeof value === "string" && HASH.test(value);
}

function integer(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function invalid(part: string): never {
  throw new Error(`Compiled Prompt package v3 ${part} is invalid`);
}
