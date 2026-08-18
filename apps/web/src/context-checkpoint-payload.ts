import type { ContextCheckpointSnapshot } from "@napier/contracts";

export function contextCheckpointPayload(
  value: unknown,
): ContextCheckpointSnapshot | undefined {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return undefined;
  }
  const payload = value as Record<string, unknown>;
  const decisions = payload["decisions"];
  const openLoops = payload["openLoops"];
  const artifacts = payload["artifacts"];
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
    !isStringArray(artifacts)
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
  };
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}
