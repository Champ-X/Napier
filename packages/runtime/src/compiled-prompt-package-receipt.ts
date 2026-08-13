import type { ModelInvocationPurpose } from "@napier/contracts";

import {
  validateCompiledPromptPackageReceiptV3,
  type CompiledPromptPackageReceiptV3,
} from "./compiled-prompt-package-v3.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import type { ModelAdapterReceipt } from "./model-adapters.js";
import {
  PROMPT_INVARIANT_CORE,
  PROMPT_INVARIANT_CORE_CONTENT_SHA256,
  PROMPT_INVARIANT_CORE_VERSION,
} from "./prompt-invariant-core.js";

export const COMPILED_PROMPT_PACKAGE_VERSION = "napier.prompt-context.v2";
export const LEGACY_COMPILED_PROMPT_PACKAGE_VERSION =
  "napier.prompt-context.v1";

export type PromptLayerId =
  | "invariant_core"
  | "effective_capabilities"
  | "task_skill_overlay"
  | "workspace_context"
  | "model_adapter";

export interface CompiledPromptLayerReceipt {
  id: PromptLayerId;
  source: "system_prompt" | "request_options";
  segmentCount: number;
  bytes: number;
  estimatedTokens: number;
  contentSha256: string;
}

export type PromptInvariantCoreBinding =
  | {
      status: "bound";
      version: typeof PROMPT_INVARIANT_CORE_VERSION;
      contentSha256: string;
      bytes: number;
    }
  | {
      status: "not_applicable";
    };

export interface CompiledPromptPackageReceiptV2 {
  kind: "napier.compiled-prompt-package";
  schemaVersion: 1 | 2;
  packageVersion:
    | typeof LEGACY_COMPILED_PROMPT_PACKAGE_VERSION
    | typeof COMPILED_PROMPT_PACKAGE_VERSION;
  purpose?: ModelInvocationPurpose;
  invariantCore?: PromptInvariantCoreBinding;
  turnIndex: number;
  classification: "conservative_tagged_v1";
  tokenEstimateMethod: "sum_layer_ceil_utf8_bytes_div_4";
  systemPromptSha256: string;
  systemPromptBytes: number;
  estimatedTokens: number;
  segmentCount: number;
  partitionSha256: string;
  lossless: true;
  layers: CompiledPromptLayerReceipt[];
  effectiveCapabilities: {
    toolCount: number;
    toolNameSetSha256: string;
    toolDefinitionSetSha256: string;
  };
  modelAdapter: {
    adapterId: ModelAdapterReceipt["adapterId"];
    adapterContentSha256: string;
  };
  contentSha256: string;
}

export type CompiledPromptPackageReceipt =
  | CompiledPromptPackageReceiptV2
  | CompiledPromptPackageReceiptV3;

export const PROMPT_LAYER_IDS: readonly PromptLayerId[] = [
  "invariant_core",
  "effective_capabilities",
  "task_skill_overlay",
  "workspace_context",
  "model_adapter",
];

const HASH = /^[a-f0-9]{64}$/u;
const BASE_KEYS = [
  "kind",
  "schemaVersion",
  "packageVersion",
  "turnIndex",
  "classification",
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
] as const;
const PURPOSES = new Set<ModelInvocationPurpose>([
  "agent_turn",
  "context_compaction",
  "goal_evaluation",
  "memory_extraction",
]);

type ReceiptGeneration = "legacy" | "modern";

export function validateCompiledPromptPackageReceipt(
  input: unknown,
): CompiledPromptPackageReceipt {
  const value = record(input);
  if (value["schemaVersion"] === 3) {
    return validateCompiledPromptPackageReceiptV3(input);
  }
  const generation = receiptGeneration(value);
  assertReceiptShape(value, generation);
  const layers = validateLayers(value["layers"] as unknown[]);
  const effectiveCapabilities = validateEffectiveCapabilities(
    value["effectiveCapabilities"],
  );
  const modelAdapter = validateAdapterBinding(
    value["modelAdapter"],
    generation,
  );
  assertLayerTotals(value, layers, modelAdapter);
  const purpose =
    generation === "modern" ? validatePurpose(value["purpose"]) : undefined;
  const invariantCore =
    generation === "modern"
      ? validateInvariantCoreBinding(value["invariantCore"], purpose!)
      : undefined;
  const receipt = {
    ...structuredClone(value),
    layers,
    effectiveCapabilities,
    modelAdapter,
    ...(purpose ? { purpose } : {}),
    ...(invariantCore ? { invariantCore } : {}),
  } as unknown as CompiledPromptPackageReceiptV2;
  const { contentSha256, ...content } = receipt;
  if (sha256(canonicalJson(content)) !== contentSha256) {
    throw new Error("Compiled Prompt package receipt hash mismatch");
  }
  return receipt;
}

export function createPromptInvariantCoreBinding(
  systemPrompt: string,
  purpose: ModelInvocationPurpose,
): PromptInvariantCoreBinding {
  if (purpose !== "agent_turn") return { status: "not_applicable" };
  if (
    !systemPrompt.startsWith(PROMPT_INVARIANT_CORE) ||
    systemPrompt.indexOf(
      PROMPT_INVARIANT_CORE,
      PROMPT_INVARIANT_CORE.length,
    ) !== -1
  ) {
    throw new Error(
      "Compiled Prompt package Invariant Core binding is invalid",
    );
  }
  return boundInvariantCore();
}

function receiptGeneration(
  value: Record<string, unknown>,
): ReceiptGeneration | undefined {
  if (
    value["schemaVersion"] === 2 &&
    value["packageVersion"] === COMPILED_PROMPT_PACKAGE_VERSION
  ) {
    return "modern";
  }
  if (
    value["schemaVersion"] === 1 &&
    value["packageVersion"] === LEGACY_COMPILED_PROMPT_PACKAGE_VERSION
  ) {
    return "legacy";
  }
  return undefined;
}

function assertReceiptShape(
  value: Record<string, unknown>,
  generation: ReceiptGeneration | undefined,
): asserts generation is ReceiptGeneration {
  const allowedKeys =
    generation === "modern"
      ? [...BASE_KEYS, "purpose", "invariantCore"]
      : BASE_KEYS;
  const fieldsValid = [
    generation !== undefined,
    exactKeys(value, allowedKeys),
    value["kind"] === "napier.compiled-prompt-package",
    nonNegativeInteger(value["turnIndex"]),
    value["classification"] === "conservative_tagged_v1",
    value["tokenEstimateMethod"] === "sum_layer_ceil_utf8_bytes_div_4",
    hash(value["systemPromptSha256"]),
    nonNegativeInteger(value["systemPromptBytes"]),
    nonNegativeInteger(value["estimatedTokens"]),
    nonNegativeInteger(value["segmentCount"]),
    hash(value["partitionSha256"]),
    value["lossless"] === true,
    Array.isArray(value["layers"]),
    hash(value["contentSha256"]),
  ];
  if (fieldsValid.some((valid) => !valid)) {
    throw new Error("Compiled Prompt package receipt is invalid");
  }
}

function assertLayerTotals(
  value: Record<string, unknown>,
  layers: CompiledPromptLayerReceipt[],
  modelAdapter: CompiledPromptPackageReceiptV2["modelAdapter"],
): void {
  const promptBytes = layers
    .filter((layer) => layer.source === "system_prompt")
    .reduce((total, layer) => total + layer.bytes, 0);
  const estimatedTokens = layers.reduce(
    (total, layer) => total + layer.estimatedTokens,
    0,
  );
  const segmentCount = layers.reduce(
    (total, layer) => total + layer.segmentCount,
    0,
  );
  if (
    [
      promptBytes === value["systemPromptBytes"],
      estimatedTokens === value["estimatedTokens"],
      segmentCount === value["segmentCount"],
      layers.at(-1)?.contentSha256 === modelAdapter.adapterContentSha256,
    ].some((valid) => !valid)
  ) {
    throw new Error("Compiled Prompt package layer totals are invalid");
  }
}

function validatePurpose(input: unknown): ModelInvocationPurpose {
  if (!PURPOSES.has(input as ModelInvocationPurpose)) {
    throw new Error("Compiled Prompt package purpose is invalid");
  }
  return input as ModelInvocationPurpose;
}

function validateInvariantCoreBinding(
  input: unknown,
  purpose: ModelInvocationPurpose,
): PromptInvariantCoreBinding {
  const value = record(input);
  if (
    purpose !== "agent_turn" &&
    exactKeys(value, ["status"]) &&
    value["status"] === "not_applicable"
  ) {
    return { status: "not_applicable" };
  }
  const bound =
    purpose === "agent_turn" &&
    exactKeys(value, ["status", "version", "contentSha256", "bytes"]) &&
    value["status"] === "bound" &&
    value["version"] === PROMPT_INVARIANT_CORE_VERSION &&
    value["contentSha256"] === PROMPT_INVARIANT_CORE_CONTENT_SHA256 &&
    value["bytes"] === promptInvariantCoreBytes();
  if (!bound) {
    throw new Error(
      "Compiled Prompt package Invariant Core binding is invalid",
    );
  }
  return boundInvariantCore();
}

function boundInvariantCore(): PromptInvariantCoreBinding {
  return {
    status: "bound",
    version: PROMPT_INVARIANT_CORE_VERSION,
    contentSha256: PROMPT_INVARIANT_CORE_CONTENT_SHA256,
    bytes: promptInvariantCoreBytes(),
  };
}

function validateLayers(input: unknown[]): CompiledPromptLayerReceipt[] {
  if (input.length !== PROMPT_LAYER_IDS.length) {
    throw new Error("Compiled Prompt package layers are invalid");
  }
  return input.map((item, index) => validateLayer(item, index));
}

function validateLayer(
  input: unknown,
  index: number,
): CompiledPromptLayerReceipt {
  const layer = record(input);
  const fieldsValid = [
    exactKeys(layer, [
      "id",
      "source",
      "segmentCount",
      "bytes",
      "estimatedTokens",
      "contentSha256",
    ]),
    layer["id"] === PROMPT_LAYER_IDS[index],
    layer["source"] === "system_prompt" ||
      layer["source"] === "request_options",
    nonNegativeInteger(layer["segmentCount"]),
    nonNegativeInteger(layer["bytes"]),
    nonNegativeInteger(layer["estimatedTokens"]),
    hash(layer["contentSha256"]),
  ];
  if (fieldsValid.some((valid) => !valid)) {
    throw new Error("Compiled Prompt package layer is invalid");
  }
  if (!validLayerSource(layer)) {
    throw new Error("Compiled Prompt package layer source is invalid");
  }
  return structuredClone(layer) as unknown as CompiledPromptLayerReceipt;
}

function validLayerSource(layer: Record<string, unknown>): boolean {
  if (layer["id"] === "model_adapter") {
    return [
      layer["source"] === "request_options",
      layer["segmentCount"] === 0,
      layer["bytes"] === 0,
      layer["estimatedTokens"] === 0,
    ].every(Boolean);
  }
  if (layer["source"] !== "system_prompt") return false;
  if (layer["segmentCount"] === 0) {
    return layer["bytes"] === 0 && layer["estimatedTokens"] === 0;
  }
  return (
    Number(layer["bytes"]) > 0 &&
    layer["estimatedTokens"] === Math.ceil(Number(layer["bytes"]) / 4)
  );
}

function validateEffectiveCapabilities(
  input: unknown,
): CompiledPromptPackageReceiptV2["effectiveCapabilities"] {
  const value = record(input);
  const valid = [
    exactKeys(value, [
      "toolCount",
      "toolNameSetSha256",
      "toolDefinitionSetSha256",
    ]),
    nonNegativeInteger(value["toolCount"]),
    hash(value["toolNameSetSha256"]),
    hash(value["toolDefinitionSetSha256"]),
  ].every(Boolean);
  if (!valid) {
    throw new Error("Compiled Prompt package capabilities are invalid");
  }
  return structuredClone(
    value,
  ) as unknown as CompiledPromptPackageReceiptV2["effectiveCapabilities"];
}

function validateAdapterBinding(
  input: unknown,
  generation: ReceiptGeneration,
): CompiledPromptPackageReceiptV2["modelAdapter"] {
  const value = record(input);
  const allowedAdapterIds =
    generation === "modern"
      ? [
          "napier.anthropic-messages.v2",
          "napier.openai-family.v2",
          "napier.generic.v2",
        ]
      : [
          "napier.anthropic-messages.v1",
          "napier.openai-family.v1",
          "napier.generic.v1",
        ];
  const adapterId = allowedAdapterIds.includes(String(value["adapterId"]))
    ? (value["adapterId"] as ModelAdapterReceipt["adapterId"])
    : undefined;
  const adapterContentSha256 = value["adapterContentSha256"];
  if (
    !exactKeys(value, ["adapterId", "adapterContentSha256"]) ||
    !adapterId ||
    !hash(adapterContentSha256)
  ) {
    throw new Error("Compiled Prompt package Adapter binding is invalid");
  }
  return {
    adapterId,
    adapterContentSha256,
  };
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === allowed.length && keys.every((key) => allowed.includes(key))
  );
}

function promptInvariantCoreBytes(): number {
  return Buffer.byteLength(PROMPT_INVARIANT_CORE, "utf8");
}

function hash(value: unknown): value is string {
  return typeof value === "string" && HASH.test(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
