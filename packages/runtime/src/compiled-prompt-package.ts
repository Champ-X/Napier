import type { ModelContextEnvelopeReceipt } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import type { ModelAdapterReceipt } from "./model-adapters.js";
import { validateModelAdapterReceipt } from "./model-adapters.js";

export const COMPILED_PROMPT_PACKAGE_EVENT = "context.prompt_package";
export const COMPILED_PROMPT_PACKAGE_VERSION = "napier.prompt-context.v1";

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

export interface CompiledPromptPackageReceipt {
  kind: "napier.compiled-prompt-package";
  schemaVersion: 1;
  packageVersion: typeof COMPILED_PROMPT_PACKAGE_VERSION;
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

interface PromptSegment {
  id: Exclude<PromptLayerId, "model_adapter">;
  text: string;
  start: number;
}

interface TaggedRegion {
  id: Exclude<PromptLayerId, "invariant_core" | "model_adapter">;
  start: number;
  end: number;
}

const HASH = /^[a-f0-9]{64}$/u;
const LAYER_IDS: readonly PromptLayerId[] = [
  "invariant_core",
  "effective_capabilities",
  "task_skill_overlay",
  "workspace_context",
  "model_adapter",
];
const TAGGED_BLOCKS: ReadonlyArray<{
  id: TaggedRegion["id"];
  pattern: RegExp;
}> = [
  {
    id: "effective_capabilities",
    pattern: /<workspace_tool_protocol>[\s\S]*?<\/workspace_tool_protocol>/gu,
  },
  {
    id: "effective_capabilities",
    pattern: /<plan_tool_protocol>[\s\S]*?<\/plan_tool_protocol>/gu,
  },
  {
    id: "task_skill_overlay",
    pattern:
      /The following skills provide specialized instructions for specific tasks\.[\s\S]*?<\/available_skills>/gu,
  },
  {
    id: "workspace_context",
    pattern:
      /<(?:imported-ledger-boundary|context_checkpoint|memory_context|delegation_ledger_projection|agent_milestone_projection|tool-loop-guard)>[\s\S]*?<\/(?:imported-ledger-boundary|context_checkpoint|memory_context|delegation_ledger_projection|agent_milestone_projection|tool-loop-guard)>/gu,
  },
];

export function createCompiledPromptPackageReceipt(input: {
  systemPrompt: string;
  envelope: ModelContextEnvelopeReceipt;
  adapter: ModelAdapterReceipt;
}): CompiledPromptPackageReceipt {
  const adapter = validateModelAdapterReceipt(input.adapter);
  if (
    input.envelope.systemPromptSha256 !== sha256(input.systemPrompt) ||
    input.envelope.systemPromptBytes !==
      Buffer.byteLength(input.systemPrompt, "utf8")
  ) {
    throw new Error("Compiled Prompt package envelope binding is invalid");
  }
  const segments = partitionPrompt(input.systemPrompt);
  const reconstructed = segments.map((segment) => segment.text).join("");
  if (reconstructed !== input.systemPrompt) {
    throw new Error("Compiled Prompt package partition is not lossless");
  }
  const segmentProjection = segments.map((segment, index) => ({
    index,
    id: segment.id,
    start: segment.start,
    bytes: bytes(segment.text),
    contentSha256: sha256(segment.text),
  }));
  const layers = LAYER_IDS.map((id): CompiledPromptLayerReceipt => {
    if (id === "model_adapter") {
      return {
        id,
        source: "request_options",
        segmentCount: 0,
        bytes: 0,
        estimatedTokens: 0,
        contentSha256: adapter.contentSha256,
      };
    }
    const selected = segments.filter((segment) => segment.id === id);
    const layerBytes = selected.reduce(
      (total, segment) => total + bytes(segment.text),
      0,
    );
    return {
      id,
      source: "system_prompt",
      segmentCount: selected.length,
      bytes: layerBytes,
      estimatedTokens: estimateTokens(layerBytes),
      contentSha256: sha256(
        canonicalJson(selected.map((segment) => segment.text)),
      ),
    };
  });
  const content = {
    kind: "napier.compiled-prompt-package" as const,
    schemaVersion: 1 as const,
    packageVersion: COMPILED_PROMPT_PACKAGE_VERSION,
    turnIndex: input.envelope.turnIndex,
    classification: "conservative_tagged_v1" as const,
    tokenEstimateMethod: "sum_layer_ceil_utf8_bytes_div_4" as const,
    systemPromptSha256: input.envelope.systemPromptSha256,
    systemPromptBytes: input.envelope.systemPromptBytes,
    estimatedTokens: layers.reduce(
      (total, layer) => total + layer.estimatedTokens,
      0,
    ),
    segmentCount: segments.length,
    partitionSha256: sha256(canonicalJson(segmentProjection)),
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
  return validateCompiledPromptPackageReceipt({
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  });
}

export function validateCompiledPromptPackageReceipt(
  input: unknown,
): CompiledPromptPackageReceipt {
  const value = record(input);
  const keys = [
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
  ];
  if (
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !(key in value)) ||
    value["kind"] !== "napier.compiled-prompt-package" ||
    value["schemaVersion"] !== 1 ||
    value["packageVersion"] !== COMPILED_PROMPT_PACKAGE_VERSION ||
    !nonNegativeInteger(value["turnIndex"]) ||
    value["classification"] !== "conservative_tagged_v1" ||
    value["tokenEstimateMethod"] !== "sum_layer_ceil_utf8_bytes_div_4" ||
    !hash(value["systemPromptSha256"]) ||
    !nonNegativeInteger(value["systemPromptBytes"]) ||
    !nonNegativeInteger(value["estimatedTokens"]) ||
    !nonNegativeInteger(value["segmentCount"]) ||
    !hash(value["partitionSha256"]) ||
    value["lossless"] !== true ||
    !Array.isArray(value["layers"]) ||
    !hash(value["contentSha256"])
  ) {
    throw new Error("Compiled Prompt package receipt is invalid");
  }
  const layers = validateLayers(value["layers"]);
  const effectiveCapabilities = validateEffectiveCapabilities(
    value["effectiveCapabilities"],
  );
  const modelAdapter = validateAdapterBinding(value["modelAdapter"]);
  const promptLayers = layers.filter(
    (layer) => layer.source === "system_prompt",
  );
  if (
    promptLayers.reduce((total, layer) => total + layer.bytes, 0) !==
      value["systemPromptBytes"] ||
    layers.reduce((total, layer) => total + layer.estimatedTokens, 0) !==
      value["estimatedTokens"] ||
    layers.reduce((total, layer) => total + layer.segmentCount, 0) !==
      value["segmentCount"] ||
    layers.at(-1)?.contentSha256 !== modelAdapter.adapterContentSha256
  ) {
    throw new Error("Compiled Prompt package layer totals are invalid");
  }
  const receipt = {
    ...structuredClone(value),
    layers,
    effectiveCapabilities,
    modelAdapter,
  } as unknown as CompiledPromptPackageReceipt;
  const { contentSha256, ...content } = receipt;
  if (sha256(canonicalJson(content)) !== contentSha256) {
    throw new Error("Compiled Prompt package receipt hash mismatch");
  }
  return receipt;
}

function partitionPrompt(systemPrompt: string): PromptSegment[] {
  const regions = TAGGED_BLOCKS.flatMap(({ id, pattern }) =>
    [...systemPrompt.matchAll(pattern)].map(
      (match): TaggedRegion => ({
        id,
        start: match.index,
        end: match.index + match[0].length,
      }),
    ),
  ).sort((left, right) => left.start - right.start || right.end - left.end);
  const selected: TaggedRegion[] = [];
  for (const region of regions) {
    const previous = selected.at(-1);
    if (previous && region.start < previous.end) continue;
    selected.push(region);
  }
  const segments: PromptSegment[] = [];
  let cursor = 0;
  for (const region of selected) {
    if (region.start > cursor) {
      segments.push({
        id: "invariant_core",
        text: systemPrompt.slice(cursor, region.start),
        start: cursor,
      });
    }
    segments.push({
      id: region.id,
      text: systemPrompt.slice(region.start, region.end),
      start: region.start,
    });
    cursor = region.end;
  }
  if (cursor < systemPrompt.length || segments.length === 0) {
    segments.push({
      id: "invariant_core",
      text: systemPrompt.slice(cursor),
      start: cursor,
    });
  }
  return segments.filter((segment) => segment.text.length > 0);
}

function validateLayers(input: unknown[]): CompiledPromptLayerReceipt[] {
  if (input.length !== LAYER_IDS.length) {
    throw new Error("Compiled Prompt package layers are invalid");
  }
  return input.map((item, index) => {
    const layer = record(item);
    if (
      Object.keys(layer).length !== 6 ||
      layer["id"] !== LAYER_IDS[index] ||
      (layer["source"] !== "system_prompt" &&
        layer["source"] !== "request_options") ||
      !nonNegativeInteger(layer["segmentCount"]) ||
      !nonNegativeInteger(layer["bytes"]) ||
      !nonNegativeInteger(layer["estimatedTokens"]) ||
      !hash(layer["contentSha256"])
    ) {
      throw new Error("Compiled Prompt package layer is invalid");
    }
    if (
      layer["id"] === "model_adapter"
        ? layer["source"] !== "request_options" ||
          layer["segmentCount"] !== 0 ||
          layer["bytes"] !== 0 ||
          layer["estimatedTokens"] !== 0
        : layer["source"] !== "system_prompt" ||
          (layer["segmentCount"] === 0
            ? layer["bytes"] !== 0 || layer["estimatedTokens"] !== 0
            : layer["bytes"] === 0 ||
              layer["estimatedTokens"] !== estimateTokens(layer["bytes"]))
    ) {
      throw new Error("Compiled Prompt package layer source is invalid");
    }
    return structuredClone(layer) as unknown as CompiledPromptLayerReceipt;
  });
}

function validateEffectiveCapabilities(
  input: unknown,
): CompiledPromptPackageReceipt["effectiveCapabilities"] {
  const value = record(input);
  if (
    Object.keys(value).length !== 3 ||
    !nonNegativeInteger(value["toolCount"]) ||
    !hash(value["toolNameSetSha256"]) ||
    !hash(value["toolDefinitionSetSha256"])
  ) {
    throw new Error("Compiled Prompt package capabilities are invalid");
  }
  return structuredClone(
    value,
  ) as unknown as CompiledPromptPackageReceipt["effectiveCapabilities"];
}

function validateAdapterBinding(
  input: unknown,
): CompiledPromptPackageReceipt["modelAdapter"] {
  const value = record(input);
  if (
    Object.keys(value).length !== 2 ||
    (value["adapterId"] !== "napier.anthropic-messages.v1" &&
      value["adapterId"] !== "napier.openai-family.v1" &&
      value["adapterId"] !== "napier.generic.v1") ||
    !hash(value["adapterContentSha256"])
  ) {
    throw new Error("Compiled Prompt package Adapter binding is invalid");
  }
  return structuredClone(
    value,
  ) as unknown as CompiledPromptPackageReceipt["modelAdapter"];
}

function estimateTokens(byteCount: number): number {
  return Math.ceil(byteCount / 4);
}

function bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
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
