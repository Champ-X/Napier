import type { RunEvent } from "@napier/contracts";

export interface ModelAdapterView {
  eventSeq: number;
  runId: string;
  adapterId:
    | "napier.anthropic-messages.v1"
    | "napier.openai-family.v1"
    | "napier.generic.v1";
  family: "anthropic" | "openai" | "generic";
  adapterVersion: 1;
  modelApi: string;
  cacheRetention: "none" | "short" | "long" | "provider_default";
  cacheRetentionSource: "caller" | "adapter" | "provider_default";
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

export function modelAdapterViews(
  events: readonly RunEvent[],
): ModelAdapterView[] {
  return events.flatMap((event): ModelAdapterView[] => {
    if (event.type !== "context.model_adapter" || !record(event.payload)) {
      return [];
    }
    const payload = event.payload;
    if (
      Object.keys(payload).length !== ALLOWED_KEYS.size ||
      Object.keys(payload).some((key) => !ALLOWED_KEYS.has(key)) ||
      payload["kind"] !== "napier.model-adapter-selection" ||
      payload["schemaVersion"] !== 1 ||
      payload["adapterVersion"] !== 1
    ) {
      return [];
    }
    const adapterId = adapter(payload["adapterId"]);
    const family = adapterFamily(payload["family"]);
    const modelApi = safeModelApi(payload["modelApi"]);
    const cacheRetention = retention(payload["cacheRetention"]);
    const cacheRetentionSource = retentionSource(
      payload["cacheRetentionSource"],
    );
    const contentSha256 = hash(payload["contentSha256"]);
    if (
      !adapterId ||
      !family ||
      !modelApi ||
      !cacheRetention ||
      !cacheRetentionSource ||
      !contentSha256 ||
      !validSelection({
        adapterId,
        family,
        modelApi,
        cacheRetention,
        cacheRetentionSource,
      })
    ) {
      return [];
    }
    return [
      {
        eventSeq: event.seq,
        runId: event.runId,
        adapterId,
        family,
        adapterVersion: 1,
        modelApi,
        cacheRetention,
        cacheRetentionSource,
        contentSha256,
      },
    ];
  });
}

function validSelection(
  view: Pick<
    ModelAdapterView,
    | "adapterId"
    | "family"
    | "modelApi"
    | "cacheRetention"
    | "cacheRetentionSource"
  >,
): boolean {
  const adapterMatches =
    view.adapterId === "napier.anthropic-messages.v1"
      ? view.family === "anthropic" && view.modelApi === "anthropic-messages"
      : view.adapterId === "napier.openai-family.v1"
        ? view.family === "openai" && OPENAI_APIS.has(view.modelApi)
        : view.family === "generic" &&
          view.modelApi !== "anthropic-messages" &&
          !OPENAI_APIS.has(view.modelApi);
  if (!adapterMatches) return false;
  if (view.cacheRetentionSource === "caller") {
    return view.cacheRetention !== "provider_default";
  }
  if (view.cacheRetentionSource === "provider_default") {
    return (
      view.adapterId === "napier.generic.v1" &&
      view.cacheRetention === "provider_default"
    );
  }
  if (view.adapterId === "napier.anthropic-messages.v1") {
    return view.cacheRetention === "short" || view.cacheRetention === "long";
  }
  return (
    view.adapterId === "napier.openai-family.v1" &&
    view.cacheRetention === "short"
  );
}

function adapter(value: unknown): ModelAdapterView["adapterId"] | undefined {
  return value === "napier.anthropic-messages.v1" ||
    value === "napier.openai-family.v1" ||
    value === "napier.generic.v1"
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
