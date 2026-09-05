import type { JsonValue, RunEvent } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import type { StableToolProgress } from "./run-progress-ledger-projection.js";

/**
 * Projects effects proved by the host ledger rather than by a tool result.
 * This is the common path for asynchronous work whose terminal effect may be
 * committed after the initiating tool call has already returned.
 */
export function projectHostProgressEffect(
  event: RunEvent,
  payload: Record<string, JsonValue> | undefined,
): StableToolProgress | undefined {
  if (event.type !== "workspace.process.settled" || !payload) return undefined;
  if (
    payload["status"] !== "succeeded" ||
    payload["workspaceAccess"] !== "scoped_write" ||
    payload["workspaceDeltaStatus"] !== "changed" ||
    payload["workspaceWriteScopeStatus"] !== "within_scope" ||
    payload["workspaceAfterTruncated"] === true ||
    (payload["workspaceCompensationStatus"] !== undefined &&
      payload["workspaceCompensationStatus"] !== "not_needed")
  ) {
    return undefined;
  }
  const stateSha256 = hash(payload["workspaceAfterSha256"]);
  const processId = text(payload["id"]);
  if (!stateSha256 || !processId) return undefined;
  return {
    availability: "declared",
    coverage: "host_observed",
    operation: "mutate",
    scope: "workspace",
    contribution: "product",
    resourceKeySha256: sha256(
      canonicalJson({
        kind: "workspace-process-effect",
        processId,
      }),
    ),
    stateSha256,
  };
}

function text(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function hash(value: JsonValue | undefined): string | undefined {
  const candidate = text(value);
  return candidate && /^[a-f0-9]{64}$/u.test(candidate) ? candidate : undefined;
}
