import type { ContextCheckpointSnapshot } from "@napier/contracts";

export interface ContextCheckpointPayload extends ContextCheckpointSnapshot {
  continuityProjectionVersion?: 1;
  continuityEventCount?: number;
  continuitySha256?: string;
}

export function contextCheckpointPayload(
  value: unknown,
): ContextCheckpointPayload | undefined {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return undefined;
  }
  const payload = value as Record<string, unknown>;
  const decisions = payload["decisions"];
  const openLoops = payload["openLoops"];
  const artifacts = payload["artifacts"];
  const continuityProjectionVersion = payload["continuityProjectionVersion"];
  const continuityEventCount = payload["continuityEventCount"];
  const continuitySha256 = payload["continuitySha256"];
  const hasContinuityBinding =
    continuityProjectionVersion !== undefined ||
    continuityEventCount !== undefined ||
    continuitySha256 !== undefined;
  if (
    payload["schemaVersion"] !== 1 ||
    typeof payload["checkpointId"] !== "string" ||
    typeof payload["fromSeq"] !== "number" ||
    typeof payload["toSeq"] !== "number" ||
    typeof payload["retainedFromSeq"] !== "number" ||
    typeof payload["sourceEventCount"] !== "number" ||
    typeof payload["sourceSha256"] !== "string" ||
    typeof payload["summarySha256"] !== "string" ||
    typeof payload["summary"] !== "string" ||
    !isStringArray(decisions) ||
    !isStringArray(openLoops) ||
    !isStringArray(artifacts) ||
    (hasContinuityBinding &&
      (continuityProjectionVersion !== 1 ||
        !isNonNegativeInteger(continuityEventCount) ||
        !isSha256(continuitySha256)))
  ) {
    return undefined;
  }
  return {
    schemaVersion: 1,
    checkpointId: payload["checkpointId"],
    ...(typeof payload["parentCheckpointId"] === "string"
      ? { parentCheckpointId: payload["parentCheckpointId"] }
      : {}),
    fromSeq: payload["fromSeq"],
    toSeq: payload["toSeq"],
    retainedFromSeq: payload["retainedFromSeq"],
    sourceEventCount: payload["sourceEventCount"],
    sourceSha256: payload["sourceSha256"],
    summarySha256: payload["summarySha256"],
    summary: payload["summary"],
    decisions,
    openLoops,
    artifacts,
    ...(hasContinuityBinding
      ? {
          continuityProjectionVersion: 1 as const,
          continuityEventCount: Number(continuityEventCount),
          continuitySha256: String(continuitySha256),
        }
      : {}),
  };
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}
