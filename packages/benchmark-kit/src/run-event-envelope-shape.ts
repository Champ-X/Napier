const LEGACY_RUN_EVENT_KEYS = [
  "id",
  "threadId",
  "runId",
  "seq",
  "type",
  "category",
  "visibility",
  "createdAt",
  "payload",
] as const;

const VERSIONED_RUN_EVENT_KEYS = [
  ...LEGACY_RUN_EVENT_KEYS,
  "schemaVersion",
] as const;

export function hasExactRunEventEnvelope(
  value: unknown,
): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const expected =
    record["schemaVersion"] === undefined
      ? LEGACY_RUN_EVENT_KEYS
      : VERSIONED_RUN_EVENT_KEYS;
  return (
    (record["schemaVersion"] === undefined || record["schemaVersion"] === 1) &&
    JSON.stringify(Object.keys(record).sort()) ===
      JSON.stringify([...expected].sort())
  );
}
