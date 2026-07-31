import type {
  Api,
  Context,
  Model,
  SimpleStreamOptions,
  Tool,
} from "@earendil-works/pi-ai";
import type {
  JsonValue,
  ModelInvocationCapsuleReceipt,
  ModelInvocationPurpose,
  ModelRef,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import { createModelContextEnvelopeReceipt } from "./model-context-envelope.js";

export const MAX_MODEL_INVOCATION_CAPSULE_BYTES = 8 * 1024 * 1024;

const HASH = /^[a-f0-9]{64}$/u;
const THREAD_ID = /^thread_[a-z0-9]{8,80}$/u;
const RUN_ID = /^run_[a-z0-9_-]{8,80}$/u;
const PROVIDER_ID = /^[a-z][a-z0-9_-]{0,63}$/u;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u;
const TOOL_NAME = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u;
const PURPOSES = new Set<ModelInvocationPurpose>([
  "agent_turn",
  "context_compaction",
  "goal_evaluation",
  "memory_extraction",
]);

export interface ModelInvocationReplayOptions {
  reasoning?: SimpleStreamOptions["reasoning"];
  maxTokens?: number;
  temperature?: number;
  cacheRetention?: SimpleStreamOptions["cacheRetention"];
}

export interface ModelInvocationCapsule {
  kind: "napier.model-invocation-capsule";
  schemaVersion: 1;
  sourceThreadId: string;
  sourceRunId: string;
  turnIndex: number;
  purpose: ModelInvocationPurpose;
  model: ModelRef;
  contextEnvelopeSha256: string;
  context: Context;
  contextSha256: string;
  options: ModelInvocationReplayOptions;
  optionsSha256: string;
  contentSha256: string;
}

export interface CreateModelInvocationCapsuleInput {
  sourceThreadId: string;
  sourceRunId: string;
  turnIndex: number;
  purpose: ModelInvocationPurpose;
  model: ModelRef | Model<Api>;
  contextEnvelopeSha256: string;
  context: Context;
  options?: SimpleStreamOptions;
}

export function createModelInvocationCapsule(
  input: CreateModelInvocationCapsuleInput,
): ModelInvocationCapsule {
  const model = normalizeModel(input.model);
  const context = normalizeContext(input.context);
  const options = normalizeOptions(input.options);
  const contextSha256 = sha256(canonicalJson(context));
  const optionsSha256 = sha256(canonicalJson(options));
  const content = {
    kind: "napier.model-invocation-capsule" as const,
    schemaVersion: 1 as const,
    sourceThreadId: input.sourceThreadId,
    sourceRunId: input.sourceRunId,
    turnIndex: input.turnIndex,
    purpose: input.purpose,
    model,
    contextEnvelopeSha256: input.contextEnvelopeSha256,
    context,
    contextSha256,
    options,
    optionsSha256,
  };
  return validateModelInvocationCapsule({
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  });
}

export function validateModelInvocationCapsule(
  input: unknown,
): ModelInvocationCapsule {
  const value = record(input, "Model invocation capsule");
  exactKeys(
    value,
    [
      "kind",
      "schemaVersion",
      "sourceThreadId",
      "sourceRunId",
      "turnIndex",
      "purpose",
      "model",
      "contextEnvelopeSha256",
      "context",
      "contextSha256",
      "options",
      "optionsSha256",
      "contentSha256",
    ],
    new Set(),
    "capsule",
  );
  const model = validateModel(value["model"]);
  const context = normalizeContext(value["context"] as Context);
  const options = normalizeOptions(
    value["options"] as ModelInvocationReplayOptions,
  );
  if (
    value["kind"] !== "napier.model-invocation-capsule" ||
    value["schemaVersion"] !== 1 ||
    typeof value["sourceThreadId"] !== "string" ||
    !THREAD_ID.test(value["sourceThreadId"]) ||
    typeof value["sourceRunId"] !== "string" ||
    !RUN_ID.test(value["sourceRunId"]) ||
    !nonNegativeInteger(value["turnIndex"]) ||
    typeof value["purpose"] !== "string" ||
    !PURPOSES.has(value["purpose"] as ModelInvocationPurpose) ||
    !hash(value["contextEnvelopeSha256"]) ||
    !hash(value["contextSha256"]) ||
    !hash(value["optionsSha256"]) ||
    !hash(value["contentSha256"])
  ) {
    throw new Error("Model invocation capsule is invalid");
  }
  const envelope = createModelContextEnvelopeReceipt({
    turnIndex: Number(value["turnIndex"]),
    systemPrompt: context.systemPrompt ?? "",
    messages: context.messages,
    tools: context.tools ?? [],
  });
  if (
    envelope.contentSha256 !== value["contextEnvelopeSha256"] ||
    sha256(canonicalJson(context)) !== value["contextSha256"] ||
    sha256(canonicalJson(options)) !== value["optionsSha256"]
  ) {
    throw new Error("Model invocation capsule context binding is invalid");
  }
  const normalized = {
    kind: "napier.model-invocation-capsule" as const,
    schemaVersion: 1 as const,
    sourceThreadId: value["sourceThreadId"],
    sourceRunId: value["sourceRunId"],
    turnIndex: Number(value["turnIndex"]),
    purpose: value["purpose"] as ModelInvocationPurpose,
    model,
    contextEnvelopeSha256: value["contextEnvelopeSha256"],
    context,
    contextSha256: value["contextSha256"],
    options,
    optionsSha256: value["optionsSha256"],
  };
  if (sha256(canonicalJson(normalized)) !== value["contentSha256"]) {
    throw new Error("Model invocation capsule hash is invalid");
  }
  return { ...normalized, contentSha256: value["contentSha256"] };
}

export function createModelInvocationCapsuleReceipt(
  capsule: ModelInvocationCapsule,
  capsuleBytes = Buffer.byteLength(canonicalJson(capsule), "utf8"),
): ModelInvocationCapsuleReceipt {
  const content = {
    kind: "napier.model-invocation-capsule-receipt" as const,
    schemaVersion: 1 as const,
    turnIndex: capsule.turnIndex,
    purpose: capsule.purpose,
    model: structuredClone(capsule.model),
    contextEnvelopeSha256: capsule.contextEnvelopeSha256,
    contextSha256: capsule.contextSha256,
    capsuleSha256: capsule.contentSha256,
    capsuleBytes,
    storage: "local_only" as const,
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function validateModelInvocationCapsuleReceipt(
  input: unknown,
): ModelInvocationCapsuleReceipt {
  const value = record(input, "Model invocation capsule receipt");
  exactKeys(
    value,
    [
      "kind",
      "schemaVersion",
      "turnIndex",
      "purpose",
      "model",
      "contextEnvelopeSha256",
      "contextSha256",
      "capsuleSha256",
      "capsuleBytes",
      "storage",
      "contentSha256",
    ],
    new Set(),
    "receipt",
  );
  const model = validateModel(value["model"]);
  if (
    value["kind"] !== "napier.model-invocation-capsule-receipt" ||
    value["schemaVersion"] !== 1 ||
    !nonNegativeInteger(value["turnIndex"]) ||
    typeof value["purpose"] !== "string" ||
    !PURPOSES.has(value["purpose"] as ModelInvocationPurpose) ||
    !hash(value["contextEnvelopeSha256"]) ||
    !hash(value["contextSha256"]) ||
    !hash(value["capsuleSha256"]) ||
    !positiveInteger(value["capsuleBytes"]) ||
    Number(value["capsuleBytes"]) > MAX_MODEL_INVOCATION_CAPSULE_BYTES ||
    value["storage"] !== "local_only" ||
    !hash(value["contentSha256"])
  ) {
    throw new Error("Model invocation capsule receipt is invalid");
  }
  const content = {
    kind: "napier.model-invocation-capsule-receipt" as const,
    schemaVersion: 1 as const,
    turnIndex: Number(value["turnIndex"]),
    purpose: value["purpose"] as ModelInvocationPurpose,
    model,
    contextEnvelopeSha256: value["contextEnvelopeSha256"],
    contextSha256: value["contextSha256"],
    capsuleSha256: value["capsuleSha256"],
    capsuleBytes: Number(value["capsuleBytes"]),
    storage: "local_only" as const,
  };
  if (sha256(canonicalJson(content)) !== value["contentSha256"]) {
    throw new Error("Model invocation capsule receipt hash is invalid");
  }
  return { ...content, contentSha256: value["contentSha256"] };
}

function normalizeContext(input: Context): Context {
  const value = record(input, "Model invocation context");
  if (
    (value["systemPrompt"] !== undefined &&
      typeof value["systemPrompt"] !== "string") ||
    !Array.isArray(value["messages"]) ||
    value["messages"].length > 512 ||
    (value["tools"] !== undefined &&
      (!Array.isArray(value["tools"]) || value["tools"].length > 256))
  ) {
    throw new Error("Model invocation context is invalid");
  }
  const tools = (value["tools"] as Tool[] | undefined)?.map((tool) =>
    normalizeTool(tool),
  );
  const context = JSON.parse(
    canonicalJson({
      ...(value["systemPrompt"] !== undefined
        ? { systemPrompt: value["systemPrompt"] }
        : {}),
      messages: value["messages"],
      ...(tools ? { tools } : {}),
    }),
  ) as Context;
  if (
    Buffer.byteLength(canonicalJson(context), "utf8") >
    MAX_MODEL_INVOCATION_CAPSULE_BYTES
  ) {
    throw new Error("Model invocation context exceeds its byte limit");
  }
  return context;
}

function normalizeTool(input: Tool): Tool {
  const value = record(input, "Model invocation tool");
  let parameters: JsonValue;
  let constrainedSampling: JsonValue | false | undefined;
  try {
    parameters = JSON.parse(canonicalJson(value["parameters"])) as JsonValue;
    constrainedSampling =
      value["constrainedSampling"] === false
        ? false
        : value["constrainedSampling"] === undefined
          ? undefined
          : (JSON.parse(
              canonicalJson(value["constrainedSampling"]),
            ) as JsonValue);
  } catch {
    throw new Error("Model invocation tool is not JSON serializable");
  }
  if (
    typeof value["name"] !== "string" ||
    !TOOL_NAME.test(value["name"]) ||
    typeof value["description"] !== "string" ||
    !jsonValue(parameters) ||
    (constrainedSampling !== undefined &&
      constrainedSampling !== false &&
      !jsonValue(constrainedSampling))
  ) {
    throw new Error("Model invocation tool is invalid");
  }
  return JSON.parse(
    canonicalJson({
      name: value["name"],
      description: value["description"],
      parameters,
      ...(constrainedSampling !== undefined ? { constrainedSampling } : {}),
    }),
  ) as Tool;
}

function normalizeOptions(
  input: SimpleStreamOptions | ModelInvocationReplayOptions | undefined,
): ModelInvocationReplayOptions {
  const value = input ?? {};
  const options: ModelInvocationReplayOptions = {
    ...(value.reasoning !== undefined ? { reasoning: value.reasoning } : {}),
    ...(value.maxTokens !== undefined ? { maxTokens: value.maxTokens } : {}),
    ...(value.temperature !== undefined
      ? { temperature: value.temperature }
      : {}),
    ...(value.cacheRetention !== undefined
      ? { cacheRetention: value.cacheRetention }
      : {}),
  };
  if (
    (options.reasoning !== undefined &&
      !["minimal", "low", "medium", "high", "xhigh", "max"].includes(
        options.reasoning,
      )) ||
    (options.maxTokens !== undefined &&
      (!positiveInteger(options.maxTokens) || options.maxTokens > 1_000_000)) ||
    (options.temperature !== undefined &&
      (!Number.isFinite(options.temperature) ||
        options.temperature < 0 ||
        options.temperature > 2)) ||
    (options.cacheRetention !== undefined &&
      !["none", "short", "long"].includes(options.cacheRetention))
  ) {
    throw new Error("Model invocation replay options are invalid");
  }
  return options;
}

function normalizeModel(input: ModelRef | Model<Api>): ModelRef {
  return validateModel({ provider: input.provider, id: input.id });
}

function validateModel(input: unknown): ModelRef {
  const value = record(input, "Model invocation model");
  exactKeys(value, ["provider", "id"], new Set(), "model");
  if (
    typeof value["provider"] !== "string" ||
    !PROVIDER_ID.test(value["provider"]) ||
    typeof value["id"] !== "string" ||
    !MODEL_ID.test(value["id"])
  ) {
    throw new Error("Model invocation model is invalid");
  }
  return { provider: value["provider"], id: value["id"] };
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: ReadonlySet<string> = new Set(),
  label = "object",
): void {
  const allowed = new Set(required);
  for (const key of optional) allowed.add(key);
  if (
    Object.keys(value).some((key) => !allowed.has(key)) ||
    required.some((key) => !Object.hasOwn(value, key))
  ) {
    throw new Error(`Model invocation ${label} fields are invalid`);
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function jsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => jsonValue(item));
  if (value && typeof value === "object") {
    return Object.values(value).every(
      (item) => item !== undefined && jsonValue(item),
    );
  }
  return false;
}

function hash(value: unknown): value is string {
  return typeof value === "string" && HASH.test(value);
}

function nonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function positiveInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) > 0;
}
