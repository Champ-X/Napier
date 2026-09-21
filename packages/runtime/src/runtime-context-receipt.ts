import type { Context } from "@earendil-works/pi-ai";
import { canonicalJson, sha256 } from "./ed25519.js";
import type { RuntimeContextDelivery } from "./runtime-context-delivery.js";
import { RUNTIME_CONTEXT_SOURCE_IDS } from "./runtime-context-delivery.js";
import { modelContextMessageSetSha256 } from "./token-meter-content.js";

export const RUNTIME_CONTEXT_EVENT = "context.runtime_context.delivered";

export function createRuntimeContextReceipt(input: {
  runId: string;
  modelAttempt: number;
  recoveryAttempt: 0 | 1;
  systemPromptSha256: string;
  tokenPressureReceiptSha256: string;
  delivery: RuntimeContextDelivery;
  prepared: Context;
  active: Context;
}) {
  const { delivery, prepared, active, ...identity } = input;
  const tailSha256 = sha256(canonicalJson(delivery.message));
  for (const context of [prepared, active]) {
    if (sha256(canonicalJson(context.messages.at(-1))) !== tailSha256)
      throw new Error(
        "Runtime context was changed or removed during projection",
      );
  }
  const content = {
    kind: "napier.runtime-context-delivery" as const,
    schemaVersion: 1 as const,
    ...identity,
    tailSha256,
    tailBytes: Buffer.byteLength(canonicalJson(delivery.message)),
    sources: delivery.sources.map(
      ({ content: _content, ...metadata }) => metadata,
    ),
    preparedBaseMessageCount: prepared.messages.length - 1,
    preparedBaseMessageSetSha256: modelContextMessageSetSha256(
      prepared.messages.slice(0, -1),
    ),
    activeBaseMessageCount: active.messages.length - 1,
    activeBaseMessageSetSha256: modelContextMessageSetSha256(
      active.messages.slice(0, -1),
    ),
    preparedMessageCount: prepared.messages.length,
    preparedMessageSetSha256: modelContextMessageSetSha256(prepared.messages),
    activeMessageCount: active.messages.length,
    activeMessageSetSha256: modelContextMessageSetSha256(active.messages),
  };
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}

export type RuntimeContextReceipt = ReturnType<
  typeof createRuntimeContextReceipt
>;

export function validateRuntimeContextReceipt(
  value: unknown,
): RuntimeContextReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw invalid();
  const receipt = value as RuntimeContextReceipt;
  const { contentSha256, ...content } = receipt;
  const numbers = [
    "modelAttempt",
    "recoveryAttempt",
    "tailBytes",
    "preparedBaseMessageCount",
    "activeBaseMessageCount",
    "preparedMessageCount",
    "activeMessageCount",
  ] as const;
  const hashes = [
    "systemPromptSha256",
    "tokenPressureReceiptSha256",
    "tailSha256",
    "preparedBaseMessageSetSha256",
    "activeBaseMessageSetSha256",
    "preparedMessageSetSha256",
    "activeMessageSetSha256",
    "contentSha256",
  ] as const;
  const keys = [
    "kind",
    "schemaVersion",
    "runId",
    "sources",
    ...numbers,
    ...hashes,
  ];
  if (
    Object.keys(receipt).sort().join() !== keys.sort().join() ||
    receipt.kind !== "napier.runtime-context-delivery" ||
    receipt.schemaVersion !== 1 ||
    typeof receipt.runId !== "string" ||
    receipt.runId.length === 0 ||
    receipt.runId.length > 256 ||
    numbers.some(
      (key) => !Number.isSafeInteger(receipt[key]) || receipt[key] < 0,
    ) ||
    hashes.some((key) => !hash(receipt[key])) ||
    receipt.modelAttempt < 1 ||
    receipt.recoveryAttempt > 1 ||
    receipt.tailBytes < 1 ||
    receipt.tailBytes > 256 * 1024 ||
    receipt.preparedBaseMessageCount + 1 !== receipt.preparedMessageCount ||
    receipt.activeBaseMessageCount + 1 !== receipt.activeMessageCount ||
    receipt.activeMessageCount > receipt.preparedMessageCount ||
    !Array.isArray(receipt.sources) ||
    receipt.sources.length > RUNTIME_CONTEXT_SOURCE_IDS.length ||
    new Set(receipt.sources.map((source) => source.sourceId)).size !==
      receipt.sources.length ||
    receipt.sources.some(
      (source) =>
        !source ||
        Object.keys(source).sort().join() !==
          "inputBytes,inputContentSha256,sourceId" ||
        !(RUNTIME_CONTEXT_SOURCE_IDS as readonly string[]).includes(
          source.sourceId,
        ) ||
        !hash(source.inputContentSha256) ||
        !Number.isSafeInteger(source.inputBytes) ||
        source.inputBytes < 1 ||
        source.inputBytes > receipt.tailBytes,
    ) ||
    contentSha256 !== sha256(canonicalJson(content))
  )
    throw invalid();
  return structuredClone(receipt);
}

/** For a hash-validated private invocation capsule: reconstruct actual tail and base. */
export function assertRuntimeContextCapsule(
  receipt: RuntimeContextReceipt,
  context: Context,
): void {
  const message = context.messages.at(-1);
  if (
    !message ||
    message.role !== "user" ||
    typeof message.content !== "string"
  )
    throw invalid();
  const data = JSON.parse(message.content) as {
    kind: string;
    schemaVersion: number;
    sources: RuntimeContextDelivery["sources"];
  };
  if (
    data.kind !== "napier.runtime-context" ||
    data.schemaVersion !== 1 ||
    !Array.isArray(data.sources)
  )
    throw invalid();
  const sources = data.sources.map(({ content, ...metadata }) => {
    if (
      typeof content !== "string" ||
      sha256(content) !== metadata.inputContentSha256 ||
      Buffer.byteLength(content) !== metadata.inputBytes
    )
      throw invalid();
    return metadata;
  });
  if (
    canonicalJson(sources) !== canonicalJson(receipt.sources) ||
    sha256(canonicalJson(message)) !== receipt.tailSha256 ||
    Buffer.byteLength(canonicalJson(message)) !== receipt.tailBytes ||
    context.messages.length !== receipt.activeMessageCount ||
    modelContextMessageSetSha256(context.messages) !==
      receipt.activeMessageSetSha256 ||
    modelContextMessageSetSha256(context.messages.slice(0, -1)) !==
      receipt.activeBaseMessageSetSha256 ||
    sha256(context.systemPrompt ?? "") !== receipt.systemPromptSha256
  )
    throw invalid();
}

function hash(value: unknown): boolean {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}
function invalid(): Error {
  return new Error("Runtime context delivery receipt is invalid");
}
