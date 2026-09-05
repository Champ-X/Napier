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
const EVENT_IDEMPOTENCY_KEYS = ["namespace", "key"] as const;

export function hasExactRunEventEnvelope(
  value: unknown,
): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const baseKeys =
    record["schemaVersion"] === undefined
      ? LEGACY_RUN_EVENT_KEYS
      : VERSIONED_RUN_EVENT_KEYS;
  const expected =
    record["idempotency"] === undefined
      ? baseKeys
      : [...baseKeys, "idempotency"];
  return (
    (record["schemaVersion"] === undefined || record["schemaVersion"] === 1) &&
    validIdempotency(record["idempotency"]) &&
    JSON.stringify(Object.keys(record).sort()) ===
      JSON.stringify([...expected].sort())
  );
}

function validIdempotency(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    JSON.stringify(Object.keys(record).sort()) ===
      JSON.stringify([...EVENT_IDEMPOTENCY_KEYS].sort()) &&
    typeof record["namespace"] === "string" &&
    /^[a-z][a-z0-9_.:-]{0,127}$/u.test(record["namespace"]) &&
    typeof record["key"] === "string" &&
    record["key"].length >= 1 &&
    record["key"].length <= 512 &&
    record["key"].trim() === record["key"] &&
    !/[\u0000-\u001f\u007f]/u.test(record["key"])
  );
}
