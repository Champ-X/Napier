import type { RunEvent } from "@napier/contracts";

export interface ModelAdapterView {
  eventSeq: number;
  runId: string;
  adapterId:
    | "napier.anthropic-messages.v1"
    | "napier.openai-family.v1"
    | "napier.generic.v1"
    | "napier.anthropic-messages.v2"
    | "napier.openai-family.v2"
    | "napier.generic.v2";
  family: "anthropic" | "openai" | "generic";
  adapterVersion: 1 | 2;
  modelApi: string;
  cacheRetention: "none" | "short" | "long" | "provider_default";
  cacheRetentionSource: "caller" | "adapter" | "provider_default";
  streamOptionMaxTokens?: number;
  streamOptionMaxTokensSource?:
    | "caller"
    | "caller_clamped_to_model"
    | "adapter"
    | "model";
  modelMaxTokens?: number;
  contentSha256: string;
}

const SHA256 = /^[a-f0-9]{64}$/u;
const MODEL_API = /^[A-Za-z0-9_.:-]{1,128}$/u;
const OPENAI_APIS = new Set([
  "openai-completions",
  "openai-responses",
  "azure-openai-responses",
  "openai-codex-responses",
]);
const ALLOWED_KEYS = new Set([
  "kind",
  "schemaVersion",
  "adapterId",
  "family",
  "adapterVersion",
  "modelApi",
  "cacheRetention",
  "cacheRetentionSource",
  "contentSha256",
]);
const V2_ALLOWED_KEYS = new Set([
  ...ALLOWED_KEYS,
  "streamOptionMaxTokens",
  "streamOptionMaxTokensSource",
  "modelMaxTokens",
]);

export function modelAdapterViews(
  events: readonly RunEvent[],
): ModelAdapterView[] {
  return events.flatMap((event) => {
    const view = modelAdapterView(event);
    return view ? [view] : [];
  });
}

function modelAdapterView(event: RunEvent): ModelAdapterView | undefined {
  if (event.type !== "context.model_adapter" || !record(event.payload)) {
    return undefined;
  }
  const payload = event.payload;
  const generation = adapterGeneration(payload);
  if (!generation || !validShape(payload, generation)) return undefined;
  const base = baseAdapterView(event, payload, generation);
  if (!base) return undefined;
  if (generation === "legacy") {
    return validSelection(base) ? base : undefined;
  }
  const outputTokens = outputTokenView(payload);
  if (!outputTokens) return undefined;
  const modern = { ...base, ...outputTokens };
  return validSelection(modern) ? modern : undefined;
}

type AdapterGeneration = "legacy" | "modern";

function adapterGeneration(
  payload: Record<string, unknown>,
): AdapterGeneration | undefined {
  if (payload["schemaVersion"] === 1 && payload["adapterVersion"] === 1) {
    return "legacy";
  }
  if (payload["schemaVersion"] === 2 && payload["adapterVersion"] === 2) {
    return "modern";
  }
  return undefined;
}

function validShape(
  payload: Record<string, unknown>,
  generation: AdapterGeneration,
): boolean {
  const allowedKeys = generation === "modern" ? V2_ALLOWED_KEYS : ALLOWED_KEYS;
  return (
    Object.keys(payload).length === allowedKeys.size &&
    Object.keys(payload).every((key) => allowedKeys.has(key)) &&
    payload["kind"] === "napier.model-adapter-selection"
  );
}

function baseAdapterView(
  event: RunEvent,
  payload: Record<string, unknown>,
  generation: AdapterGeneration,
): ModelAdapterView | undefined {
  const adapterId = adapter(payload["adapterId"]);
  const family = adapterFamily(payload["family"]);
  const modelApi = safeModelApi(payload["modelApi"]);
  const cacheRetention = retention(payload["cacheRetention"]);
  const cacheRetentionSource = retentionSource(payload["cacheRetentionSource"]);
  const contentSha256 = hash(payload["contentSha256"]);
  if (
    !adapterId ||
    !family ||
    !modelApi ||
    !cacheRetention ||
    !cacheRetentionSource ||
    !contentSha256 ||
    !adapterId.endsWith(generation === "modern" ? ".v2" : ".v1")
  ) {
    return undefined;
  }
  return {
    eventSeq: event.seq,
    runId: event.runId,
    adapterId,
    family,
    adapterVersion: generation === "modern" ? 2 : 1,
    modelApi,
    cacheRetention,
    cacheRetentionSource,
    contentSha256,
  };
}

function outputTokenView(
  payload: Record<string, unknown>,
):
  | Required<
      Pick<
        ModelAdapterView,
        | "streamOptionMaxTokens"
        | "streamOptionMaxTokensSource"
        | "modelMaxTokens"
      >
    >
  | undefined {
  const streamOptionMaxTokens = integer(payload["streamOptionMaxTokens"]);
  const streamOptionMaxTokensSource = outputTokenSource(
    payload["streamOptionMaxTokensSource"],
  );
  const modelMaxTokens = integer(payload["modelMaxTokens"]);
  return streamOptionMaxTokens &&
    streamOptionMaxTokensSource &&
    modelMaxTokens &&
    streamOptionMaxTokens <= modelMaxTokens
    ? { streamOptionMaxTokens, streamOptionMaxTokensSource, modelMaxTokens }
    : undefined;
}

function validSelection(view: ModelAdapterView): boolean {
  const adapterMatches = view.adapterId.startsWith("napier.anthropic-messages.")
    ? view.family === "anthropic" && view.modelApi === "anthropic-messages"
    : view.adapterId.startsWith("napier.openai-family.")
      ? view.family === "openai" && OPENAI_APIS.has(view.modelApi)
      : view.family === "generic" &&
        view.modelApi !== "anthropic-messages" &&
        !OPENAI_APIS.has(view.modelApi);
  if (!adapterMatches || !validOutputTokens(view)) return false;
  if (view.cacheRetentionSource === "caller") {
    return view.cacheRetention !== "provider_default";
  }
  if (view.cacheRetentionSource === "provider_default") {
    return (
      view.adapterId.startsWith("napier.generic.") &&
      view.cacheRetention === "provider_default"
    );
  }
  if (view.adapterId.startsWith("napier.anthropic-messages.")) {
    return view.cacheRetention === "short" || view.cacheRetention === "long";
  }
  return (
    view.adapterId.startsWith("napier.openai-family.") &&
    view.cacheRetention === "short"
  );
}

function adapter(value: unknown): ModelAdapterView["adapterId"] | undefined {
  return value === "napier.anthropic-messages.v1" ||
    value === "napier.openai-family.v1" ||
    value === "napier.generic.v1" ||
    value === "napier.anthropic-messages.v2" ||
    value === "napier.openai-family.v2" ||
    value === "napier.generic.v2"
    ? value
    : undefined;
}

function validOutputTokens(view: ModelAdapterView): boolean {
  if (view.adapterVersion === 1) {
    return (
      view.streamOptionMaxTokens === undefined &&
      view.streamOptionMaxTokensSource === undefined &&
      view.modelMaxTokens === undefined
    );
  }
  if (
    view.streamOptionMaxTokens === undefined ||
    view.streamOptionMaxTokensSource === undefined ||
    view.modelMaxTokens === undefined ||
    view.streamOptionMaxTokens > view.modelMaxTokens
  ) {
    return false;
  }
  if (view.streamOptionMaxTokensSource === "model") {
    return view.streamOptionMaxTokens === view.modelMaxTokens;
  }
  if (view.streamOptionMaxTokensSource === "caller_clamped_to_model") {
    return view.streamOptionMaxTokens === view.modelMaxTokens;
  }
  if (view.streamOptionMaxTokensSource === "adapter") {
    return (
      view.family !== "generic" &&
      view.streamOptionMaxTokens === 16_384 &&
      view.modelMaxTokens > 16_384
    );
  }
  return true;
}

function outputTokenSource(
  value: unknown,
): ModelAdapterView["streamOptionMaxTokensSource"] | undefined {
  return value === "caller" ||
    value === "caller_clamped_to_model" ||
    value === "adapter" ||
    value === "model"
    ? value
    : undefined;
}

function integer(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

function adapterFamily(value: unknown): ModelAdapterView["family"] | undefined {
  return value === "anthropic" || value === "openai" || value === "generic"
    ? value
    : undefined;
}

function retention(
  value: unknown,
): ModelAdapterView["cacheRetention"] | undefined {
  return value === "none" ||
    value === "short" ||
    value === "long" ||
    value === "provider_default"
    ? value
    : undefined;
}

function retentionSource(
  value: unknown,
): ModelAdapterView["cacheRetentionSource"] | undefined {
  return value === "caller" ||
    value === "adapter" ||
    value === "provider_default"
    ? value
    : undefined;
}

function safeModelApi(value: unknown): string | undefined {
  return typeof value === "string" && MODEL_API.test(value) ? value : undefined;
}

function hash(value: unknown): string | undefined {
  return typeof value === "string" && SHA256.test(value) ? value : undefined;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
