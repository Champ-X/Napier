import type { RunEvent } from "@napier/contracts";

export type PromptLayerId =
  | "invariant_core"
  | "effective_capabilities"
  | "task_skill_overlay"
  | "workspace_context"
  | "model_adapter";

export interface CompiledPromptLayerView {
  id: PromptLayerId;
  source: "system_prompt" | "request_options";
  segmentCount: number;
  bytes: number;
  estimatedTokens: number;
  contentSha256: string;
}

export interface CompiledPromptPackageView {
  eventSeq: number;
  runId: string;
  turnIndex: number;
  packageVersion: "napier.prompt-context.v1";
  classification: "conservative_tagged_v1";
  tokenEstimateMethod: "sum_layer_ceil_utf8_bytes_div_4";
  systemPromptBytes: number;
  estimatedTokens: number;
  segmentCount: number;
  systemPromptSha256: string;
  partitionSha256: string;
  layers: CompiledPromptLayerView[];
  toolCount: number;
  toolNameSetSha256: string;
  toolDefinitionSetSha256: string;
  adapterId:
    | "napier.anthropic-messages.v1"
    | "napier.openai-family.v1"
    | "napier.generic.v1";
  adapterContentSha256: string;
  contentSha256: string;
}

const HASH = /^[a-f0-9]{64}$/u;
const LAYER_IDS: readonly PromptLayerId[] = [
  "invariant_core",
  "effective_capabilities",
  "task_skill_overlay",
  "workspace_context",
  "model_adapter",
];
const ALLOWED_KEYS = new Set([
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
]);

export function compiledPromptPackageViews(
  events: readonly RunEvent[],
): CompiledPromptPackageView[] {
  return events.flatMap((event): CompiledPromptPackageView[] => {
    if (event.type !== "context.prompt_package" || !record(event.payload)) {
      return [];
    }
    const payload = event.payload;
    if (
      Object.keys(payload).length !== ALLOWED_KEYS.size ||
      Object.keys(payload).some((key) => !ALLOWED_KEYS.has(key)) ||
      payload["kind"] !== "napier.compiled-prompt-package" ||
      payload["schemaVersion"] !== 1 ||
      payload["packageVersion"] !== "napier.prompt-context.v1" ||
      payload["classification"] !== "conservative_tagged_v1" ||
      payload["tokenEstimateMethod"] !== "sum_layer_ceil_utf8_bytes_div_4" ||
      payload["lossless"] !== true
    ) {
      return [];
    }
    const turnIndex = integer(payload["turnIndex"]);
    const systemPromptBytes = integer(payload["systemPromptBytes"]);
    const estimatedTokens = integer(payload["estimatedTokens"]);
    const segmentCount = integer(payload["segmentCount"]);
    const systemPromptSha256 = hash(payload["systemPromptSha256"]);
    const partitionSha256 = hash(payload["partitionSha256"]);
    const contentSha256 = hash(payload["contentSha256"]);
    const layers = layerViews(payload["layers"]);
    const capabilities = capabilityView(payload["effectiveCapabilities"]);
    const adapter = adapterView(payload["modelAdapter"]);
    if (
      turnIndex === undefined ||
      systemPromptBytes === undefined ||
      estimatedTokens === undefined ||
      segmentCount === undefined ||
      !systemPromptSha256 ||
      !partitionSha256 ||
      !contentSha256 ||
      !layers ||
      !capabilities ||
      !adapter ||
      layers
        .filter((layer) => layer.source === "system_prompt")
        .reduce((total, layer) => total + layer.bytes, 0) !==
        systemPromptBytes ||
      layers.reduce((total, layer) => total + layer.estimatedTokens, 0) !==
        estimatedTokens ||
      layers.reduce((total, layer) => total + layer.segmentCount, 0) !==
        segmentCount ||
      layers.at(-1)?.contentSha256 !== adapter.adapterContentSha256
    ) {
      return [];
    }
    return [
      {
        eventSeq: event.seq,
        runId: event.runId,
        turnIndex,
        packageVersion: "napier.prompt-context.v1",
        classification: "conservative_tagged_v1",
        tokenEstimateMethod: "sum_layer_ceil_utf8_bytes_div_4",
        systemPromptBytes,
        estimatedTokens,
        segmentCount,
        systemPromptSha256,
        partitionSha256,
        layers,
        ...capabilities,
        ...adapter,
        contentSha256,
      },
    ];
  });
}

function layerViews(input: unknown): CompiledPromptLayerView[] | undefined {
  if (!Array.isArray(input) || input.length !== LAYER_IDS.length) {
    return undefined;
  }
  const layers = input.map((item, index) => {
    if (!record(item) || Object.keys(item).length !== 6) return undefined;
    const id = item["id"] === LAYER_IDS[index] ? LAYER_IDS[index] : undefined;
    const source =
      item["source"] === "system_prompt" || item["source"] === "request_options"
        ? item["source"]
        : undefined;
    const segmentCount = integer(item["segmentCount"]);
    const bytes = integer(item["bytes"]);
    const estimatedTokens = integer(item["estimatedTokens"]);
    const contentSha256 = hash(item["contentSha256"]);
    if (
      !id ||
      !source ||
      segmentCount === undefined ||
      bytes === undefined ||
      estimatedTokens === undefined ||
      !contentSha256 ||
      (id === "model_adapter"
        ? source !== "request_options" ||
          segmentCount !== 0 ||
          bytes !== 0 ||
          estimatedTokens !== 0
        : source !== "system_prompt" ||
          (segmentCount === 0
            ? bytes !== 0 || estimatedTokens !== 0
            : bytes === 0 || estimatedTokens !== Math.ceil(bytes / 4)))
    ) {
      return undefined;
    }
    return {
      id,
      source,
      segmentCount,
      bytes,
      estimatedTokens,
      contentSha256,
    };
  });
  return layers.every(Boolean)
    ? (layers as CompiledPromptLayerView[])
    : undefined;
}

function capabilityView(
  input: unknown,
):
  | Pick<
      CompiledPromptPackageView,
      "toolCount" | "toolNameSetSha256" | "toolDefinitionSetSha256"
    >
  | undefined {
  if (!record(input) || Object.keys(input).length !== 3) return undefined;
  const toolCount = integer(input["toolCount"]);
  const toolNameSetSha256 = hash(input["toolNameSetSha256"]);
  const toolDefinitionSetSha256 = hash(input["toolDefinitionSetSha256"]);
  return toolCount !== undefined && toolNameSetSha256 && toolDefinitionSetSha256
    ? { toolCount, toolNameSetSha256, toolDefinitionSetSha256 }
    : undefined;
}

function adapterView(
  input: unknown,
):
  | Pick<CompiledPromptPackageView, "adapterId" | "adapterContentSha256">
  | undefined {
  if (!record(input) || Object.keys(input).length !== 2) return undefined;
  const adapterId =
    input["adapterId"] === "napier.anthropic-messages.v1" ||
    input["adapterId"] === "napier.openai-family.v1" ||
    input["adapterId"] === "napier.generic.v1"
      ? input["adapterId"]
      : undefined;
  const adapterContentSha256 = hash(input["adapterContentSha256"]);
  return adapterId && adapterContentSha256
    ? { adapterId, adapterContentSha256 }
    : undefined;
}

function integer(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function hash(value: unknown): string | undefined {
  return typeof value === "string" && HASH.test(value) ? value : undefined;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
