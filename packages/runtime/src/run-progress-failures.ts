import type { JsonValue, RunEvent } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";

const INPUT_HASH_FIELDS = [
  "inputSha256",
  "workflowInputSha256",
  "argumentsSha256",
] as const;
const VOLATILE_FIELDS = new Set([
  "callId",
  "status",
  "outputTextBytes",
  "workflowAttempt",
]);

export function runProgressToolInputFingerprint(
  payload: Record<string, JsonValue>,
): string {
  return sha256(canonicalJson(stableProjection(payload)));
}

export function runProgressFailureFingerprint(
  event: RunEvent,
  payload: Record<string, JsonValue> | undefined,
  toolInputs: ReadonlyMap<string, string>,
): string {
  const callId = text(payload?.["callId"]);
  const inputBinding =
    INPUT_HASH_FIELDS.map((field) => text(payload?.[field])).find(hash) ??
    (callId ? toolInputs.get(callId) : undefined) ??
    (payload ? sha256(canonicalJson(stableProjection(payload))) : "");
  const policyReason = text(payload?.["policyReason"]);
  return sha256(
    canonicalJson({
      type: event.type,
      toolName: text(payload?.["toolName"]) ?? "",
      inputBinding,
      errorCode: text(payload?.["errorCode"]) ?? "",
      policyReasonSha256: policyReason ? sha256(policyReason) : "",
    }),
  );
}

function stableProjection(
  payload: Record<string, JsonValue>,
): Record<string, JsonValue> {
  return Object.fromEntries(
    Object.entries(payload).filter(([field]) => !VOLATILE_FIELDS.has(field)),
  );
}

function text(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function hash(value: string | undefined): value is string {
  return Boolean(value && /^[a-f0-9]{64}$/u.test(value));
}
