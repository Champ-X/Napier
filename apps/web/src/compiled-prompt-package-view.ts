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
  packageVersion: "napier.prompt-context.v1" | "napier.prompt-context.v2";
  purpose?:
    | "agent_turn"
    | "context_compaction"
    | "goal_evaluation"
    | "memory_extraction";
  invariantCore:
    | {
        status: "bound";
        version: "napier.invariant-core.v1";
        contentSha256: string;
        bytes: number;
      }
    | {
        status: "not_applicable" | "legacy_unavailable";
      };
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
    | "napier.generic.v1"
    | "napier.anthropic-messages.v2"
    | "napier.openai-family.v2"
    | "napier.generic.v2";
  adapterContentSha256: string;
  contentSha256: string;
}

const HASH = /^[a-f0-9]{64}$/u;
const PROMPT_INVARIANT_CORE_CONTENT_SHA256 =
  "4bd4be0290317713104cbeb5dca77e3ec62757849e3bea0fb14645f54beeadda";
const PROMPT_INVARIANT_CORE_BYTES = 922;
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
const V2_ALLOWED_KEYS = new Set([...ALLOWED_KEYS, "purpose", "invariantCore"]);

export function compiledPromptPackageViews(
  events: readonly RunEvent[],
): CompiledPromptPackageView[] {
  return events.flatMap((event) => {
    const view = compiledPromptPackageView(event);
    return view ? [view] : [];
  });
}

function compiledPromptPackageView(
  event: RunEvent,
): CompiledPromptPackageView | undefined {
  if (event.type !== "context.prompt_package" || !record(event.payload)) {
    return undefined;
  }
  const payload = event.payload;
  const generation = packageGeneration(payload);
  if (!generation || !validPackageShape(payload, generation)) return undefined;
  const scalars = scalarView(payload);
  const layers = layerViews(payload["layers"]);
  const capabilities = capabilityView(payload["effectiveCapabilities"]);
  const adapter = adapterView(payload["modelAdapter"], generation);
  const purpose =
    generation === "modern" ? purposeView(payload["purpose"]) : undefined;
  const invariantCore =
    generation === "modern"
      ? invariantCoreView(payload["invariantCore"], purpose)
      : { status: "legacy_unavailable" as const };
  if (
    !scalars ||
    !layers ||
    !capabilities ||
    !adapter ||
    !invariantCore ||
    !validLayerTotals(layers, scalars, adapter)
  ) {
    return undefined;
  }
  return {
    eventSeq: event.seq,
    runId: event.runId,
    packageVersion:
      generation === "modern"
        ? "napier.prompt-context.v2"
        : "napier.prompt-context.v1",
    ...(purpose ? { purpose } : {}),
    invariantCore,
    classification: "conservative_tagged_v1",
    tokenEstimateMethod: "sum_layer_ceil_utf8_bytes_div_4",
    ...scalars,
    layers,
    ...capabilities,
    ...adapter,
  };
}

type PackageGeneration = "legacy" | "modern";

function packageGeneration(
  payload: Record<string, unknown>,
): PackageGeneration | undefined {
  if (
    payload["schemaVersion"] === 2 &&
    payload["packageVersion"] === "napier.prompt-context.v2"
  ) {
    return "modern";
  }
  if (
    payload["schemaVersion"] === 1 &&
    payload["packageVersion"] === "napier.prompt-context.v1"
  ) {
    return "legacy";
  }
  return undefined;
}

function validPackageShape(
  payload: Record<string, unknown>,
  generation: PackageGeneration,
): boolean {
  const allowedKeys = generation === "modern" ? V2_ALLOWED_KEYS : ALLOWED_KEYS;
  return [
    Object.keys(payload).length === allowedKeys.size,
    Object.keys(payload).every((key) => allowedKeys.has(key)),
    payload["kind"] === "napier.compiled-prompt-package",
    payload["classification"] === "conservative_tagged_v1",
    payload["tokenEstimateMethod"] === "sum_layer_ceil_utf8_bytes_div_4",
    payload["lossless"] === true,
  ].every(Boolean);
}

function scalarView(
  payload: Record<string, unknown>,
):
  | Pick<
      CompiledPromptPackageView,
      | "turnIndex"
      | "systemPromptBytes"
      | "estimatedTokens"
      | "segmentCount"
      | "systemPromptSha256"
      | "partitionSha256"
      | "contentSha256"
    >
  | undefined {
  const values = {
    turnIndex: integer(payload["turnIndex"]),
    systemPromptBytes: integer(payload["systemPromptBytes"]),
    estimatedTokens: integer(payload["estimatedTokens"]),
    segmentCount: integer(payload["segmentCount"]),
    systemPromptSha256: hash(payload["systemPromptSha256"]),
    partitionSha256: hash(payload["partitionSha256"]),
    contentSha256: hash(payload["contentSha256"]),
  };
  return Object.values(values).every((value) => value !== undefined)
    ? (values as Pick<
        CompiledPromptPackageView,
        | "turnIndex"
        | "systemPromptBytes"
        | "estimatedTokens"
        | "segmentCount"
        | "systemPromptSha256"
        | "partitionSha256"
        | "contentSha256"
      >)
    : undefined;
}

function validLayerTotals(
  layers: CompiledPromptLayerView[],
  scalars: Pick<
    CompiledPromptPackageView,
    "systemPromptBytes" | "estimatedTokens" | "segmentCount"
  >,
  adapter: Pick<
    CompiledPromptPackageView,
    "adapterId" | "adapterContentSha256"
  >,
): boolean {
  return [
    layers
      .filter((layer) => layer.source === "system_prompt")
      .reduce((total, layer) => total + layer.bytes, 0) ===
      scalars.systemPromptBytes,
    layers.reduce((total, layer) => total + layer.estimatedTokens, 0) ===
      scalars.estimatedTokens,
    layers.reduce((total, layer) => total + layer.segmentCount, 0) ===
      scalars.segmentCount,
    layers.at(-1)?.contentSha256 === adapter.adapterContentSha256,
  ].every(Boolean);
}

function purposeView(
  input: unknown,
): CompiledPromptPackageView["purpose"] | undefined {
  return input === "agent_turn" ||
    input === "context_compaction" ||
    input === "goal_evaluation" ||
    input === "memory_extraction"
    ? input
    : undefined;
}

function invariantCoreView(
  input: unknown,
  purpose: CompiledPromptPackageView["purpose"] | undefined,
): CompiledPromptPackageView["invariantCore"] | undefined {
  if (!record(input) || !purpose) return undefined;
  if (
    purpose !== "agent_turn" &&
    Object.keys(input).length === 1 &&
    input["status"] === "not_applicable"
  ) {
    return { status: "not_applicable" };
  }
  const contentSha256 = hash(input["contentSha256"]);
  const bytes = integer(input["bytes"]);
  return purpose === "agent_turn" &&
    Object.keys(input).length === 4 &&
    input["status"] === "bound" &&
    input["version"] === "napier.invariant-core.v1" &&
    contentSha256 === PROMPT_INVARIANT_CORE_CONTENT_SHA256 &&
    bytes === PROMPT_INVARIANT_CORE_BYTES
    ? {
        status: "bound",
        version: "napier.invariant-core.v1",
        contentSha256,
        bytes,
      }
    : undefined;
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
  generation: PackageGeneration,
):
  | Pick<CompiledPromptPackageView, "adapterId" | "adapterContentSha256">
  | undefined {
  if (!record(input) || Object.keys(input).length !== 2) return undefined;
  const adapterId =
    input["adapterId"] === "napier.anthropic-messages.v1" ||
    input["adapterId"] === "napier.openai-family.v1" ||
    input["adapterId"] === "napier.generic.v1" ||
    input["adapterId"] === "napier.anthropic-messages.v2" ||
    input["adapterId"] === "napier.openai-family.v2" ||
    input["adapterId"] === "napier.generic.v2"
      ? input["adapterId"]
      : undefined;
  const adapterContentSha256 = hash(input["adapterContentSha256"]);
  return adapterId &&
    adapterContentSha256 &&
    adapterId.endsWith(generation === "modern" ? ".v2" : ".v1")
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
