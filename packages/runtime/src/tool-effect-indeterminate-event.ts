import type {
  JsonValue,
  RunEvent,
  RunLeaseSummary,
  ToolOperationEffectIndeterminatePayloadV1,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import type { LostRunLeaseDisposition } from "./run-lease-loss.js";
import { validToolOperationEventPayload } from "./tool-operation-event-validation.js";

interface RunLeaseRecoveryBinding {
  lease?: RunLeaseSummary;
  leaseTokenSha256?: string;
}

const DESCRIPTOR_KEYS = [
  "kind",
  "schemaVersion",
  "parentCallId",
  "operationId",
  "role",
  "startedTakeover",
  "ordinal",
  "mode",
  "route",
  "operation",
  "scope",
  "contribution",
  "resourceKeySha256",
  "failureBindings",
  "failureDomainKeySha256",
  "descriptorSha256",
] as const;

export function recoveryRunLeaseBindingSha256(
  run: RunLeaseRecoveryBinding,
): string {
  return sha256(
    canonicalJson({
      lease: run.lease
        ? {
            ownerSha256: sha256(run.lease.ownerId),
            acquiredAt: run.lease.acquiredAt,
            heartbeatAt: run.lease.heartbeatAt,
            expiresAt: run.lease.expiresAt,
            revision: run.lease.revision,
          }
        : null,
      leaseTokenSha256: run.leaseTokenSha256 ?? null,
    }),
  );
}

export function effectIndeterminateEventPayload(input: {
  boundary: RunEvent;
  run: RunLeaseRecoveryBinding;
  disposition: LostRunLeaseDisposition;
  recoveredAt: string;
}): ToolOperationEffectIndeterminatePayloadV1 {
  const boundaryPayload = input.boundary.payload;
  if (input.boundary.type !== "tool.operation.lease.renewed") {
    throw new Error(
      "Effect-indeterminate recovery requires an effect boundary",
    );
  }
  if (
    !validToolOperationEventPayload(
      "tool.operation.lease.renewed",
      boundaryPayload,
    ) ||
    boundaryPayload["executionEffectBoundary"] !== true ||
    boundaryPayload["role"] !== "execution_authority"
  ) {
    throw new Error(
      "Effect-indeterminate recovery requires an effect boundary",
    );
  }
  const recoveredAtMs = Date.parse(input.recoveredAt);
  if (!Number.isSafeInteger(recoveredAtMs) || recoveredAtMs < 0) {
    throw new Error("Effect-indeterminate recovery timestamp is invalid");
  }
  const fields: Record<string, JsonValue> = {
    disposition: "effect_indeterminate",
    effectBoundaryEventSeq: input.boundary.seq,
    executionLeaseOwnerSha256: boundaryPayload[
      "executionLeaseOwnerSha256"
    ] as string,
    executionLeaseGeneration: boundaryPayload[
      "executionLeaseGeneration"
    ] as number,
    recoveryRunLeaseBindingSha256: recoveryRunLeaseBindingSha256(input.run),
    recoveryDisposition: input.disposition,
    recoveredAtMs,
  };
  const phaseStateSha256 = sha256(
    canonicalJson({
      descriptorSha256: boundaryPayload["descriptorSha256"],
      phase: "effect_indeterminate",
      ...fields,
    }),
  );
  const payload = Object.fromEntries(
    DESCRIPTOR_KEYS.flatMap((key) => {
      const value = boundaryPayload[key];
      return value === undefined ? [] : [[key, value]];
    }),
  ) as ToolOperationEffectIndeterminatePayloadV1;
  payload["phaseStateSha256"] = phaseStateSha256;
  Object.assign(payload, fields);
  if (
    !validToolOperationEventPayload(
      "tool.operation.effect_indeterminate",
      payload,
    )
  ) {
    throw new Error("Effect-indeterminate recovery payload is invalid");
  }
  return payload;
}
