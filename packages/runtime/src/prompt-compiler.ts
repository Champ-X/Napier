import type { ModelInvocationPurpose } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import type { ModelAdapterReceiptV2 } from "./model-adapters.js";
import {
  PROMPT_INVARIANT_CORE,
  PROMPT_INVARIANT_CORE_CONTENT_SHA256,
} from "./prompt-invariant-core.js";

export const PROMPT_COMPILER_VERSION = "napier.prompt-compiler.v1";
export const PROMPT_COMPILER_ASSEMBLY = "ordered_nonempty_layers_v1";

export type CompiledPromptLayerId =
  | "invariant_core"
  | "effective_capabilities"
  | "task_skill_overlay"
  | "workspace_context"
  | "model_adapter";

export interface PromptCompilerSourceInput {
  sourceId: string;
  content: string;
  priority: number;
  required?: boolean;
}

export interface PromptCompilerLayerInput {
  id: Exclude<CompiledPromptLayerId, "model_adapter">;
  priority: number;
  budgetBytes: number;
  sources: readonly PromptCompilerSourceInput[];
}

export interface PromptCompilerInput {
  purpose: ModelInvocationPurpose;
  layers: readonly PromptCompilerLayerInput[];
  adapter: ModelAdapterReceiptV2;
}

export interface CompiledPromptSourceArtifact {
  sourceId: string;
  priority: number;
  required: boolean;
  inputBytes: number;
  inputContentSha256: string;
  included: boolean;
  trimmingReason: "within_budget" | "lower_priority_source_omitted";
}

export interface CompiledPromptLayerArtifact {
  id: CompiledPromptLayerId;
  priority: number;
  budgetBytes: number;
  inputBytes: number;
  bytes: number;
  estimatedTokens: number;
  inputContentSha256: string;
  contentSha256: string;
  trimmingReason: "within_budget" | "budget_exceeded";
  sources: CompiledPromptSourceArtifact[];
  content: string;
}

export interface CompiledPromptArtifact {
  compilerVersion: typeof PROMPT_COMPILER_VERSION;
  assembly: typeof PROMPT_COMPILER_ASSEMBLY;
  purpose: ModelInvocationPurpose;
  systemPrompt: string;
  systemPromptSha256: string;
  systemPromptBytes: number;
  layers: CompiledPromptLayerArtifact[];
  adapter: ModelAdapterReceiptV2;
}

const LAYER_IDS: readonly CompiledPromptLayerId[] = [
  "invariant_core",
  "effective_capabilities",
  "task_skill_overlay",
  "workspace_context",
  "model_adapter",
];

export function compilePrompt(
  input: PromptCompilerInput,
): CompiledPromptArtifact {
  const expectedInputIds = LAYER_IDS.slice(0, -1);
  if (
    input.layers.length !== expectedInputIds.length ||
    input.layers.some((layer, index) => layer.id !== expectedInputIds[index])
  ) {
    throw new Error(
      "Prompt Compiler layer inputs must be complete and ordered",
    );
  }
  const layers = [
    ...input.layers.map(compileLayer),
    compileLayer(modelAdapterLayer(input.adapter)),
  ];
  if (input.purpose === "agent_turn") {
    assertInvariantCore(layers[0]!);
  } else {
    assertAuxiliaryInvariantLayer(layers[0]!);
  }
  const systemPrompt = layers
    .map((layer) => layer.content)
    .filter(Boolean)
    .join("\n\n");
  return validateCompiledPromptArtifact({
    compilerVersion: PROMPT_COMPILER_VERSION,
    assembly: PROMPT_COMPILER_ASSEMBLY,
    purpose: input.purpose,
    systemPrompt,
    systemPromptSha256: sha256(systemPrompt),
    systemPromptBytes: bytes(systemPrompt),
    layers,
    adapter: input.adapter,
  });
}

export function validateCompiledPromptArtifact(
  input: CompiledPromptArtifact,
): CompiledPromptArtifact {
  const reconstructed = input.layers
    .map((layer) => layer.content)
    .filter(Boolean)
    .join("\n\n");
  const adapterLayer = input.layers[4];
  const expectedAdapterLayer = compileLayer(modelAdapterLayer(input.adapter));
  if (
    input.compilerVersion !== PROMPT_COMPILER_VERSION ||
    input.assembly !== PROMPT_COMPILER_ASSEMBLY ||
    input.layers.length !== LAYER_IDS.length ||
    input.layers.some((layer, index) => layer.id !== LAYER_IDS[index]) ||
    reconstructed !== input.systemPrompt ||
    sha256(reconstructed) !== input.systemPromptSha256 ||
    bytes(reconstructed) !== input.systemPromptBytes ||
    input.layers.some(
      (layer) =>
        layer.bytes !== bytes(layer.content) ||
        layer.contentSha256 !== sha256(layer.content) ||
        layer.estimatedTokens !== Math.ceil(layer.bytes / 4) ||
        layer.bytes > layer.budgetBytes,
    ) ||
    !adapterLayer ||
    canonicalJson(adapterLayer) !== canonicalJson(expectedAdapterLayer)
  ) {
    throw new Error("Compiled Prompt artifact binding is invalid");
  }
  if (input.purpose === "agent_turn") assertInvariantCore(input.layers[0]!);
  else assertAuxiliaryInvariantLayer(input.layers[0]!);
  return Object.freeze(input);
}

function compileLayer(
  input: PromptCompilerLayerInput | PromptCompilerModelAdapterLayerInput,
): CompiledPromptLayerArtifact {
  assertLayerInput(input);
  const sources = input.sources
    .map((source, index) => normalizeSource(source, index))
    .filter((source) => source.content.length > 0);
  const selected = new Set(sources.map((source) => source.index));
  const removable = sources
    .filter((source) => !source.required)
    .sort(
      (left, right) =>
        left.priority - right.priority || right.index - left.index,
    );
  while (joinedBytes(sources, selected) > input.budgetBytes) {
    const source = removable.shift();
    if (!source) {
      throw new Error(
        `Prompt Compiler ${input.id} required sources exceed budget`,
      );
    }
    selected.delete(source.index);
  }
  const included = sources.filter((source) => selected.has(source.index));
  const content = included.map((source) => source.content).join("\n\n");
  const trimmed = included.length !== sources.length;
  return Object.freeze({
    id: input.id,
    priority: input.priority,
    budgetBytes: input.budgetBytes,
    inputBytes: joinedBytes(
      sources,
      new Set(sources.map(({ index }) => index)),
    ),
    bytes: bytes(content),
    estimatedTokens: Math.ceil(bytes(content) / 4),
    inputContentSha256: sha256(
      canonicalJson(
        sources.map(({ sourceId, priority, required, content }) => ({
          sourceId,
          priority,
          required,
          contentSha256: sha256(content),
        })),
      ),
    ),
    contentSha256: sha256(content),
    trimmingReason: trimmed ? "budget_exceeded" : "within_budget",
    sources: sources.map((source) => ({
      sourceId: source.sourceId,
      priority: source.priority,
      required: source.required,
      inputBytes: bytes(source.content),
      inputContentSha256: sha256(source.content),
      included: selected.has(source.index),
      trimmingReason: selected.has(source.index)
        ? ("within_budget" as const)
        : ("lower_priority_source_omitted" as const),
    })),
    content,
  });
}

interface PromptCompilerModelAdapterLayerInput {
  id: "model_adapter";
  priority: number;
  budgetBytes: number;
  sources: readonly PromptCompilerSourceInput[];
}

function modelAdapterLayer(
  adapter: ModelAdapterReceiptV2,
): PromptCompilerModelAdapterLayerInput {
  const schemaGuidance =
    adapter.family === "anthropic"
      ? "Tool definitions use Anthropic Messages schemas. Send exact JSON inputs and keep tool-result IDs paired with their calls."
      : adapter.family === "openai"
        ? "Tool definitions use OpenAI-family function schemas. Send exact JSON arguments and keep tool-call IDs paired with their results."
        : "Tool definitions use the Provider's native schema. Send exact structured inputs and preserve call/result pairing.";
  const editGuidance =
    adapter.family === "openai"
      ? "For workspace edits, use the available edit tools and their declared patch format; do not emit an invented patch protocol."
      : "For workspace edits, use the available edit tools exactly as declared; do not simulate unavailable editing capabilities.";
  return {
    id: "model_adapter",
    priority: 900,
    budgetBytes: 4 * 1024,
    sources: [
      {
        sourceId: `model_adapter.${adapter.family}`,
        priority: 1_000,
        required: true,
        content: [
          `<model_adapter id="${adapter.adapterId}">`,
          schemaGuidance,
          editGuidance,
          `Request cache policy: ${adapter.cacheRetention}. Maximum output tokens: ${adapter.streamOptionMaxTokens}.`,
          "</model_adapter>",
        ].join("\n"),
      },
    ],
  };
}

function assertInvariantCore(layer: CompiledPromptLayerArtifact): void {
  if (
    layer.content !== PROMPT_INVARIANT_CORE ||
    layer.contentSha256 !== PROMPT_INVARIANT_CORE_CONTENT_SHA256 ||
    layer.sources.length !== 1 ||
    layer.sources[0]?.sourceId !== "runtime.invariant_core" ||
    !layer.sources[0].required
  ) {
    throw new Error("Prompt Compiler Invariant Core input is invalid");
  }
}

function assertAuxiliaryInvariantLayer(
  layer: CompiledPromptLayerArtifact,
): void {
  if (layer.content !== "" || layer.sources.length !== 0) {
    throw new Error(
      "Prompt Compiler auxiliary Invariant Core layer must be empty",
    );
  }
}

function assertLayerInput(
  input: PromptCompilerLayerInput | PromptCompilerModelAdapterLayerInput,
): void {
  if (
    !LAYER_IDS.includes(input.id) ||
    !Number.isSafeInteger(input.priority) ||
    input.priority < 0 ||
    !Number.isSafeInteger(input.budgetBytes) ||
    input.budgetBytes < 1
  ) {
    throw new Error(`Prompt Compiler ${input.id} layer input is invalid`);
  }
  const ids = input.sources.map((source) => source.sourceId);
  if (new Set(ids).size !== ids.length) {
    throw new Error(`Prompt Compiler ${input.id} source IDs must be unique`);
  }
}

function normalizeSource(source: PromptCompilerSourceInput, index: number) {
  if (
    !/^[a-z][a-z0-9_.-]{0,127}$/u.test(source.sourceId) ||
    typeof source.content !== "string" ||
    source.content.includes("\u0000") ||
    !Number.isSafeInteger(source.priority) ||
    source.priority < 0
  ) {
    throw new Error(
      `Prompt Compiler source input is invalid: ${source.sourceId}`,
    );
  }
  return {
    ...source,
    content: source.content.trim(),
    required: source.required === true,
    index,
  };
}

function joinedBytes(
  sources: readonly ReturnType<typeof normalizeSource>[],
  selected: ReadonlySet<number>,
): number {
  return bytes(
    sources
      .filter((source) => selected.has(source.index))
      .map((source) => source.content)
      .join("\n\n"),
  );
}

function bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}
