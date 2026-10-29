import type { JsonObject } from "@napier/contracts";
import { canonicalJson, sha256 } from "./ed25519.js";
import { validateModelAdapterReceipt } from "./model-adapters.js";
import { validateModelContextEnvelopeReceipt } from "./model-context-envelope.js";
import type { SettleSubagentChildInvocationInput } from "./subagent-child-run-types.js";

const BINDING_FIELDS = ["modelContextEnvelopeSha256", "modelContextEnvelopeTurnIndex",
  "modelContextMessageSetSha256", "modelContextToolDefinitionSetSha256"] as const;

/** Canonical request evidence is committed with the response, never left as an orphan envelope. */
export function bindChildInvocationCapture(input: Pick<SettleSubagentChildInvocationInput, "payload" | "capture">, invocationIndex: number) {
  const events: Array<{ type: "context.model_envelope" | "context.model_adapter"; payload: JsonObject }> = [];
  if (!input.capture) {
    if (input.payload["childCaptureSha256"] !== undefined ||
        BINDING_FIELDS.some((field) => input.payload[field] !== undefined))
      throw new Error("Child response context binding requires its captured envelope");
    return { payload: input.payload, events };
  }
  const envelope = validateModelContextEnvelopeReceipt(input.capture.envelope);
  if (envelope.turnIndex !== invocationIndex - 1)
    throw new Error("Child captured envelope turn does not match its reservation");
  const binding: JsonObject = {
    modelContextEnvelopeSha256: envelope.contentSha256,
    modelContextEnvelopeTurnIndex: envelope.turnIndex,
    modelContextMessageSetSha256: envelope.messageSetSha256,
    modelContextToolDefinitionSetSha256: envelope.toolDefinitionSetSha256,
  };
  if (BINDING_FIELDS.some((field) => input.payload[field] !== undefined && input.payload[field] !== binding[field]))
    throw new Error("Child response context binding conflicts with its captured envelope");
  events.push({ type: "context.model_envelope", payload: json(envelope) });
  const adapter = input.capture.adapter ? validateModelAdapterReceipt(input.capture.adapter) : undefined;
  if (adapter) events.push({ type: "context.model_adapter", payload: json(adapter) });
  return { events, payload: { ...input.payload, ...binding,
    childCaptureSha256: sha256(canonicalJson({ envelope, ...(adapter ? { adapter } : {}) })) } };
}

function json(value: object): JsonObject { return JSON.parse(canonicalJson(value)) as JsonObject; }
