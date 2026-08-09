import type {
  Api,
  Model,
  MutableModels,
  StreamOptions,
} from "@earendil-works/pi-ai";

import { canonicalJson, sha256 } from "./ed25519.js";

export type ModelAdapterId =
  | "napier.anthropic-messages.v1"
  | "napier.openai-family.v1"
  | "napier.generic.v1";

export interface ModelAdapterReceipt {
  kind: "napier.model-adapter-selection";
  schemaVersion: 1;
  adapterId: ModelAdapterId;
  family: "anthropic" | "openai" | "generic";
  adapterVersion: 1;
  modelApi: string;
  cacheRetention: "none" | "short" | "long" | "provider_default";
  cacheRetentionSource: "caller" | "adapter" | "provider_default";
  contentSha256: string;
}

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
]);
const CACHE_RETENTIONS = new Set(["none", "short", "long", "provider_default"]);
const CACHE_RETENTION_SOURCES = new Set([
  "caller",
  "adapter",
  "provider_default",
]);

export function modelAdapterReceipt(
  model: Pick<Model<Api>, "api" | "compat">,
  options?: Pick<StreamOptions, "cacheRetention">,
): ModelAdapterReceipt {
  const adapter =
    model.api === "anthropic-messages"
      ? {
          adapterId: "napier.anthropic-messages.v1" as const,
          family: "anthropic" as const,
          defaultCacheRetention:
            record(model.compat)["supportsLongCacheRetention"] === false
              ? ("short" as const)
              : ("long" as const),
        }
      : OPENAI_APIS.has(model.api)
        ? {
            adapterId: "napier.openai-family.v1" as const,
            family: "openai" as const,
            defaultCacheRetention: "short" as const,
          }
        : {
            adapterId: "napier.generic.v1" as const,
            family: "generic" as const,
            defaultCacheRetention: "provider_default" as const,
          };
  const callerCacheRetention = options?.cacheRetention;
  const content: Omit<ModelAdapterReceipt, "contentSha256"> = {
    kind: "napier.model-adapter-selection" as const,
    schemaVersion: 1 as const,
    adapterId: adapter.adapterId,
    family: adapter.family,
    adapterVersion: 1 as const,
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
  };
  return Object.freeze({
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  });
}

export function applyModelAdapterOptions<Options extends StreamOptions>(
  model: Pick<Model<Api>, "api" | "compat">,
  options?: Options,
): Options | undefined {
  if (options?.cacheRetention !== undefined) return options;
  const receipt = modelAdapterReceipt(model);
  if (receipt.cacheRetention === "provider_default") return options;
  return {
    ...(options ?? ({} as Options)),
    cacheRetention: receipt.cacheRetention,
  };
}

export function validateModelAdapterReceipt(
  input: unknown,
): ModelAdapterReceipt {
  const value = record(input);
  const keys = [
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
  if (
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !(key in value)) ||
    value["kind"] !== "napier.model-adapter-selection" ||
    value["schemaVersion"] !== 1 ||
    !ADAPTER_IDS.has(value["adapterId"] as ModelAdapterId) ||
    value["adapterVersion"] !== 1 ||
    typeof value["modelApi"] !== "string" ||
    value["modelApi"].length < 1 ||
    value["modelApi"].length > 128 ||
    !CACHE_RETENTIONS.has(String(value["cacheRetention"])) ||
    !CACHE_RETENTION_SOURCES.has(String(value["cacheRetentionSource"])) ||
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
  return structuredClone(receipt);
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
  const adapterMatchesApi =
    receipt.adapterId === "napier.anthropic-messages.v1"
      ? receipt.family === "anthropic" &&
        receipt.modelApi === "anthropic-messages"
      : receipt.adapterId === "napier.openai-family.v1"
        ? receipt.family === "openai" && OPENAI_APIS.has(receipt.modelApi)
        : receipt.family === "generic" &&
          receipt.modelApi !== "anthropic-messages" &&
          !OPENAI_APIS.has(receipt.modelApi);
  if (!adapterMatchesApi) return false;
  if (receipt.cacheRetentionSource === "caller") {
    return receipt.cacheRetention !== "provider_default";
  }
  if (receipt.cacheRetentionSource === "provider_default") {
    return (
      receipt.adapterId === "napier.generic.v1" &&
      receipt.cacheRetention === "provider_default"
    );
  }
  if (receipt.adapterId === "napier.anthropic-messages.v1") {
    return (
      receipt.cacheRetention === "short" || receipt.cacheRetention === "long"
    );
  }
  return (
    receipt.adapterId === "napier.openai-family.v1" &&
    receipt.cacheRetention === "short"
  );
}
