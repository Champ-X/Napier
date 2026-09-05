import type { AssistantMessage } from "@earendil-works/pi-ai";

import type { ModelTurnWatchdogEvidence } from "./model-turn-deadline.js";

export type HostModelAbortProvenance =
  | {
      readonly owner: "watchdog";
      readonly evidence: ModelTurnWatchdogEvidence;
    }
  | { readonly owner: "caller" };

const HOST_MODEL_ABORTS = new WeakMap<
  AssistantMessage,
  HostModelAbortProvenance
>();

/**
 * Carries trusted abort ownership across the provider-stream and route layers.
 * A WeakMap is intentional: provider-controlled message fields cannot forge a
 * host cancellation and the metadata never leaks into persisted model output.
 */
export function attestHostModelAbort(
  message: AssistantMessage,
  provenance: HostModelAbortProvenance,
): AssistantMessage {
  HOST_MODEL_ABORTS.set(
    message,
    provenance.owner === "watchdog"
      ? Object.freeze({
          owner: "watchdog",
          evidence: Object.freeze({ ...provenance.evidence }),
        })
      : Object.freeze({ owner: "caller" }),
  );
  return message;
}

export function hostModelAbortProvenance(
  value: unknown,
): HostModelAbortProvenance | undefined {
  if (!value || typeof value !== "object") return undefined;
  return HOST_MODEL_ABORTS.get(value as AssistantMessage);
}
