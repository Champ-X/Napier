import type { ToolInvocationProtocolV2 } from "@napier/contracts/tool-protocol";

import type { OwnedToolRecordV2 } from "./owned-tool-protocol.js";
import { TOOL_INVOCATION_EXPERIMENT_TOOLS } from "./tool-invocation-capsule.js";

const SAFE_PROGRESS_OPERATIONS = new Set([
  "acquire",
  "reuse",
  "observe",
  "verify",
  "neutral",
]);

/**
 * Resolves experiment eligibility from the owned instance, never its name.
 * The historical name set only admits host-bound compatibility readers that
 * predate native declarations; new tools must carry a host-attested protocol.
 */
export function requireToolInvocationExperimentProtocol(
  owned: OwnedToolRecordV2,
  input: unknown,
): ToolInvocationProtocolV2 {
  const invocation = toolInvocationExperimentProtocol(owned, input);
  if (!invocation) {
    throw new Error(
      "Tool invocation experiment requires a host-bound read-only protocol",
    );
  }
  return invocation;
}

export function toolInvocationExperimentProtocol(
  owned: OwnedToolRecordV2,
  input: unknown,
): ToolInvocationProtocolV2 | undefined {
  const invocation = owned.invocation(input);
  const native =
    invocation.compatibilityMode === "native" &&
    owned.definition.compatibility.mode === "native";
  const hostBoundLegacyRead =
    invocation.compatibilityMode === "compatibility" &&
    owned.definition.compatibility.mode === "compatibility" &&
    TOOL_INVOCATION_EXPERIMENT_TOOLS.has(invocation.toolId) &&
    owned.definition.sideEffectMode === "static" &&
    owned.definition.sideEffect === "none";
  const trustedProgress = invocation.progress.coverage === "trusted_declared";
  const neutralFailClosedProgress =
    (native || hostBoundLegacyRead) &&
    invocation.progress.coverage === "opaque" &&
    invocation.progress.operation === "neutral" &&
    invocation.progress.contribution === "neutral" &&
    invocation.progress.classificationErrorSha256 === undefined;
  if (
    invocation.toolId !== owned.tool.name ||
    invocation.definitionSha256 !== owned.definitionSha256 ||
    invocation.sideEffect !== "none" ||
    invocation.approval.mode === "explicit" ||
    invocation.approval.codeBridge !== "allowed" ||
    invocation.progress.availability !== "declared" ||
    !SAFE_PROGRESS_OPERATIONS.has(invocation.progress.operation) ||
    (!native && !hostBoundLegacyRead) ||
    (!trustedProgress && !neutralFailClosedProgress)
  ) {
    return undefined;
  }
  return invocation;
}
