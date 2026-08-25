import type {
  Api,
  Model,
  MutableModels,
  StreamOptions,
} from "@earendil-works/pi-ai";

import { canonicalJson, sha256 } from "./ed25519.js";
import { recordCompatibilityHit } from "./compatibility-telemetry.js";

export type ModelAdapterId =
  | "napier.anthropic-messages.v1"
  | "napier.openai-family.v1"
  | "napier.generic.v1"
  | "napier.anthropic-messages.v2"
  | "napier.openai-family.v2"
  | "napier.generic.v2";

export interface LegacyModelAdapterReceipt {
  kind: "napier.model-adapter-selection";
  schemaVersion: 1;
  adapterId: Extract<ModelAdapterId, `${string}.v1`>;
  family: "anthropic" | "openai" | "generic";
  adapterVersion: 1;
  modelApi: string;
  cacheRetention: "none" | "short" | "long" | "provider_default";
  cacheRetentionSource: "caller" | "adapter" | "provider_default";
  contentSha256: string;
}

export interface ModelAdapterReceiptV2 {
  kind: "napier.model-adapter-selection";
  schemaVersion: 2;
  adapterId: Extract<ModelAdapterId, `${string}.v2`>;
  family: "anthropic" | "openai" | "generic";
  adapterVersion: 2;
  modelApi: string;
  cacheRetention: "none" | "short" | "long" | "provider_default";
  cacheRetentionSource: "caller" | "adapter" | "provider_default";
  streamOptionMaxTokens: number;
  streamOptionMaxTokensSource:
    | "caller"
    | "caller_clamped_to_model"
    | "adapter"
    | "model";
  modelMaxTokens: number;
  contentSha256: string;
}

export type ModelAdapterReceipt =
  | LegacyModelAdapterReceipt
  | ModelAdapterReceiptV2;

export const MODEL_ADAPTER_DEFAULT_STREAM_OPTION_MAX_TOKENS = 16_384;

const OPENAI_APIS = new Set([
  "openai-completions",
  "openai-responses",
  "azure-openai-responses",
  "openai-codex-responses",
]);
const ADAPTER_IDS = new Set<ModelAdapterId>([
  "napier.anthropic-messages.v1",
  "napier.openai-family.v1",
  "napier.generic.v1",
  "napier.anthropic-messages.v2",
  "napier.openai-family.v2",
  "napier.generic.v2",
]);
const CACHE_RETENTIONS = new Set(["none", "short", "long", "provider_default"]);
const CACHE_RETENTION_SOURCES = new Set([
  "caller",
  "adapter",
  "provider_default",
]);

export function modelAdapterReceipt(
  model: Pick<Model<Api>, "api" | "compat" | "maxTokens">,
  options?: Pick<StreamOptions, "cacheRetention" | "maxTokens">,
): ModelAdapterReceiptV2 {
  const adapter =
    model.api === "anthropic-messages"
      ? {
          adapterId: "napier.anthropic-messages.v2" as const,
          family: "anthropic" as const,
          defaultCacheRetention:
            record(model.compat)["supportsLongCacheRetention"] === false
              ? ("short" as const)
              : ("long" as const),
        }
      : OPENAI_APIS.has(model.api)
        ? {
            adapterId: "napier.openai-family.v2" as const,
            family: "openai" as const,
            defaultCacheRetention: "short" as const,
          }
        : {
            adapterId: "napier.generic.v2" as const,
            family: "generic" as const,
            defaultCacheRetention: "provider_default" as const,
          };
  const callerCacheRetention = options?.cacheRetention;
  const outputTokens = outputTokenPolicy(
    model,
    options?.maxTokens,
    adapter.family,
  );
  const content: Omit<ModelAdapterReceiptV2, "contentSha256"> = {
    kind: "napier.model-adapter-selection" as const,
    schemaVersion: 2 as const,
    adapterId: adapter.adapterId,
    family: adapter.family,
    adapterVersion: 2 as const,
    modelApi: model.api,
    cacheRetention:
      callerCacheRetention ??
      (adapter.defaultCacheRetention === "provider_default"
        ? "provider_default"
        : adapter.defaultCacheRetention),
    cacheRetentionSource:
      callerCacheRetention !== undefined
        ? ("caller" as const)
        : adapter.defaultCacheRetention === "provider_default"
          ? ("provider_default" as const)
          : ("adapter" as const),
    streamOptionMaxTokens: outputTokens.value,
    streamOptionMaxTokensSource: outputTokens.source,
    modelMaxTokens: model.maxTokens,
  };
  return Object.freeze({
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  });
}

export function applyModelAdapterOptions<Options extends StreamOptions>(
  model: Pick<Model<Api>, "api" | "compat" | "maxTokens">,
  options?: Options,
): Options {
  const receipt = modelAdapterReceipt(model, options);
  const adapted = {
    ...(options ?? ({} as Options)),
    ...(receipt.cacheRetention === "provider_default"
      ? {}
      : { cacheRetention: receipt.cacheRetention }),
    maxTokens: receipt.streamOptionMaxTokens,
  };
  return options?.cacheRetention === adapted.cacheRetention &&
    options?.maxTokens === adapted.maxTokens
    ? options
    : adapted;
}

export function validateModelAdapterReceipt(
  input: unknown,
): ModelAdapterReceipt {
  const value = record(input);
  const legacyKeys = [
    "kind",
    "schemaVersion",
    "adapterId",
    "family",
    "adapterVersion",
    "modelApi",
    "cacheRetention",
    "cacheRetentionSource",
    "contentSha256",
  ];
  const modernKeys = [
    ...legacyKeys.slice(0, -1),
    "streamOptionMaxTokens",
    "streamOptionMaxTokensSource",
    "modelMaxTokens",
    "contentSha256",
  ];
  const modern = value["schemaVersion"] === 2;
  const keys = modern ? modernKeys : legacyKeys;
  if (
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !(key in value)) ||
    value["kind"] !== "napier.model-adapter-selection" ||
    (value["schemaVersion"] !== 1 && value["schemaVersion"] !== 2) ||
    !ADAPTER_IDS.has(value["adapterId"] as ModelAdapterId) ||
    value["adapterVersion"] !== value["schemaVersion"] ||
    typeof value["modelApi"] !== "string" ||
    value["modelApi"].length < 1 ||
    value["modelApi"].length > 128 ||
    !CACHE_RETENTIONS.has(String(value["cacheRetention"])) ||
    !CACHE_RETENTION_SOURCES.has(String(value["cacheRetentionSource"])) ||
    (modern &&
      (!positiveInteger(value["streamOptionMaxTokens"]) ||
        !positiveInteger(value["modelMaxTokens"]) ||
        Number(value["streamOptionMaxTokens"]) >
          Number(value["modelMaxTokens"]) ||
        (value["streamOptionMaxTokensSource"] !== "caller" &&
          value["streamOptionMaxTokensSource"] !== "caller_clamped_to_model" &&
          value["streamOptionMaxTokensSource"] !== "adapter" &&
          value["streamOptionMaxTokensSource"] !== "model"))) ||
    !/^[a-f0-9]{64}$/u.test(String(value["contentSha256"]))
  ) {
    throw new Error("Model Adapter receipt is invalid");
  }
  const receipt = value as unknown as ModelAdapterReceipt;
  if (!validSelection(receipt)) {
    throw new Error("Model Adapter receipt selection is invalid");
  }
  const { contentSha256, ...content } = receipt;
  if (sha256(canonicalJson(content)) !== contentSha256) {
    throw new Error("Model Adapter receipt hash mismatch");
  }
  recordLegacyModelAdapterReceiptHit(receipt.schemaVersion);
  return structuredClone(receipt);
}

function recordLegacyModelAdapterReceiptHit(schemaVersion: number): void {
  if (schemaVersion === 1) recordCompatibilityHit("compat.receipt.legacy_read");
}

export function createModelAdapterModels(models: MutableModels): MutableModels {
  return new Proxy(models, {
    get(target, property) {
      if (
        property === "stream" ||
        property === "complete" ||
        property === "streamSimple" ||
        property === "completeSimple"
      ) {
        return (model: Model<Api>, context: unknown, options?: StreamOptions) =>
          Reflect.apply(target[property], target, [
            model,
            context,
            applyModelAdapterOptions(model, options),
          ]);
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function validSelection(receipt: ModelAdapterReceipt): boolean {
  if (!receipt.adapterId.endsWith(`.v${receipt.schemaVersion}`)) return false;
  const adapterMatchesApi = receipt.adapterId.startsWith(
    "napier.anthropic-messages.",
  )
    ? receipt.family === "anthropic" &&
      receipt.modelApi === "anthropic-messages"
    : receipt.adapterId.startsWith("napier.openai-family.")
      ? receipt.family === "openai" && OPENAI_APIS.has(receipt.modelApi)
      : receipt.family === "generic" &&
        receipt.modelApi !== "anthropic-messages" &&
        !OPENAI_APIS.has(receipt.modelApi);
  if (!adapterMatchesApi || !validOutputTokenSelection(receipt)) return false;
  if (receipt.cacheRetentionSource === "caller") {
    return receipt.cacheRetention !== "provider_default";
  }
  if (receipt.cacheRetentionSource === "provider_default") {
    return (
      receipt.adapterId.startsWith("napier.generic.") &&
      receipt.cacheRetention === "provider_default"
    );
  }
  if (receipt.adapterId.startsWith("napier.anthropic-messages.")) {
    return (
      receipt.cacheRetention === "short" || receipt.cacheRetention === "long"
    );
  }
  return (
    receipt.adapterId.startsWith("napier.openai-family.") &&
    receipt.cacheRetention === "short"
  );
}

function outputTokenPolicy(
  model: Pick<Model<Api>, "maxTokens">,
  callerMaxTokens: number | undefined,
  family: ModelAdapterReceiptV2["family"],
): {
  value: number;
  source: ModelAdapterReceiptV2["streamOptionMaxTokensSource"];
} {
  if (!positiveInteger(model.maxTokens)) {
    throw new Error("Model Adapter model output token limit is invalid");
  }
  if (callerMaxTokens !== undefined) {
    if (!positiveInteger(callerMaxTokens)) {
      throw new Error("Model Adapter caller output token limit is invalid");
    }
    return callerMaxTokens <= model.maxTokens
      ? { value: callerMaxTokens, source: "caller" }
      : { value: model.maxTokens, source: "caller_clamped_to_model" };
  }
  if (
    family === "generic" ||
    model.maxTokens <= MODEL_ADAPTER_DEFAULT_STREAM_OPTION_MAX_TOKENS
  ) {
    return { value: model.maxTokens, source: "model" };
  }
  return {
    value: MODEL_ADAPTER_DEFAULT_STREAM_OPTION_MAX_TOKENS,
    source: "adapter",
  };
}

function validOutputTokenSelection(receipt: ModelAdapterReceipt): boolean {
  if (receipt.schemaVersion === 1) return true;
  if (receipt.streamOptionMaxTokensSource === "caller") {
    return receipt.streamOptionMaxTokens <= receipt.modelMaxTokens;
  }
  if (receipt.streamOptionMaxTokensSource === "caller_clamped_to_model") {
    return receipt.streamOptionMaxTokens === receipt.modelMaxTokens;
  }
  if (receipt.streamOptionMaxTokensSource === "model") {
    return receipt.streamOptionMaxTokens === receipt.modelMaxTokens;
  }
  return (
    receipt.family !== "generic" &&
    receipt.streamOptionMaxTokens ===
      MODEL_ADAPTER_DEFAULT_STREAM_OPTION_MAX_TOKENS &&
    receipt.modelMaxTokens > MODEL_ADAPTER_DEFAULT_STREAM_OPTION_MAX_TOKENS
  );
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}
