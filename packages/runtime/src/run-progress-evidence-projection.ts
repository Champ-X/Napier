import type { JsonValue, RunEvent } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";

export interface StableToolProgress {
  availability: "declared" | "unavailable";
  coverage: "trusted_declared" | "host_observed" | "opaque";
  operation: string;
  scope: string;
  contribution: "support" | "product" | "acceptance" | "neutral";
  resourceKeySha256?: string;
  stateSha256?: string;
}

const STABLE_STATE_FIELDS = [
  "resultSetSha256",
  "sourceContentSha256",
  "sourceBodySha256",
  "fileSha256",
  "afterSha256",
  "snapshotSha256",
  "viewportTextSha256",
  "contentSha256",
  "outputSha256",
  "outputTextSha256",
] as const;

export function stableToolProgress(
  payload: Record<string, JsonValue> | undefined,
): StableToolProgress | undefined {
  const protocol = progressRecord(payload?.["toolProtocol"]);
  const progress = progressRecord(protocol?.["progress"]);
  const rawContribution = progressText(progress?.["contribution"]);
  const contribution = normalizeContribution(rawContribution);
  const operation = progressText(progress?.["operation"]) ?? "neutral";
  const scope = progressText(progress?.["scope"]) ?? "neutral";
  const availability = progressAvailability(
    progress?.["availability"],
    operation,
    contribution,
  );
  const coverage = progressCoverage(progress?.["coverage"], availability);
  if (contribution !== "neutral") {
    const resourceKeySha256 = progressHash(progress?.["resourceKeySha256"]);
    const stateSha256 = progressHash(progress?.["stateSha256"]);
    return {
      operation,
      scope,
      contribution,
      availability,
      coverage,
      ...(resourceKeySha256 ? { resourceKeySha256 } : {}),
      ...(stateSha256 ? { stateSha256 } : {}),
    };
  }
  if (progress) {
    return {
      operation,
      scope,
      contribution: "neutral",
      availability,
      coverage,
    };
  }
  // Replay compatibility for ledgers written before Tool Progress Protocol v1.
  // New invocations always use the Registry receipt above.
  const harnessAction = progressText(payload?.["harnessAction"]);
  if (harnessAction === "write") {
    return {
      operation: "mutate",
      scope: "workspace",
      contribution: "product",
      availability: "declared",
      coverage: "host_observed",
    };
  }
  if (harnessAction === "verify") {
    return {
      operation: "verify",
      scope: "workspace",
      contribution: "acceptance",
      availability: "declared",
      coverage: "host_observed",
    };
  }
  return undefined;
}

export function stableStateHash(
  payload: Record<string, JsonValue> | undefined,
): string | undefined {
  const details = progressRecord(payload?.["details"]);
  for (const field of STABLE_STATE_FIELDS) {
    const candidate =
      progressHash(details?.[field]) ?? progressHash(payload?.[field]);
    if (candidate) return candidate;
  }
  return undefined;
}

export function isAcquisitionFailure(
  event: Pick<RunEvent, "type">,
  payload: Record<string, JsonValue> | undefined,
): boolean {
  if (event.type !== "tool.failed") return false;
  if (stableToolProgress(payload)?.operation !== "acquire") return false;
  const failure = progressRecord(payload?.["toolFailure"]);
  const disposition = progressText(failure?.["disposition"]);
  const failureClass = progressText(failure?.["class"]);
  if (!disposition || !failureClass) return false;
  return (
    disposition !== "correct_input" &&
    failureClass !== "cancelled" &&
    failureClass !== "policy"
  );
}

export function stableEventEvidence(event: RunEvent): string | undefined {
  const payload = progressRecord(event.payload);
  const state = stableStateHash(payload);
  return state ? sha256(canonicalJson({ type: event.type, state })) : undefined;
}

export function assistantEvidence(
  payload: Record<string, JsonValue> | undefined,
): string | undefined {
  const value = progressText(payload?.["text"]);
  return value ? sha256(value) : progressHash(payload?.["contentSha256"]);
}

export function isApprovalResolution(event: RunEvent): boolean {
  return (
    event.type.startsWith("operator.decision.resolved") ||
    event.type.startsWith("browser.interaction_confirmation.resolved") ||
    event.type.startsWith("workflow.approval.resolved")
  );
}

export function isCapabilityEvent(event: RunEvent): boolean {
  return (
    event.category === "extension" ||
    event.category === "credential" ||
    event.type.startsWith("sandbox.")
  );
}

export function progressRecord(
  value: JsonValue | undefined,
): Record<string, JsonValue> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : undefined;
}

export function progressText(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function progressHash(value: JsonValue | undefined): string | undefined {
  const candidate = progressText(value);
  return candidate && /^[a-f0-9]{64}$/u.test(candidate) ? candidate : undefined;
}

export function progressInteger(
  value: JsonValue | undefined,
): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

export function progressElapsedMs(
  startedAt: string,
  observedAt: string,
): number {
  return Math.max(0, Date.parse(observedAt) - Date.parse(startedAt));
}

function normalizeContribution(
  value: string | undefined,
): StableToolProgress["contribution"] {
  if (value === "support" || value === "supporting") return "support";
  if (value === "product") return "product";
  if (value === "acceptance" || value === "verification") {
    return "acceptance";
  }
  return "neutral";
}

function progressAvailability(
  value: JsonValue | undefined,
  operation: string,
  contribution: StableToolProgress["contribution"],
): StableToolProgress["availability"] {
  if (value === "declared" || value === "unavailable") return value;
  return operation === "neutral" && contribution === "neutral"
    ? "unavailable"
    : "declared";
}

function progressCoverage(
  value: JsonValue | undefined,
  availability: StableToolProgress["availability"],
): StableToolProgress["coverage"] {
  if (
    value === "trusted_declared" ||
    value === "host_observed" ||
    value === "opaque"
  ) {
    return value;
  }
  return availability === "unavailable" ? "opaque" : "trusted_declared";
}
