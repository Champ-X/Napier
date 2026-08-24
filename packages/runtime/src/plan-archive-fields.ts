const SHA256 = /^[a-f0-9]{64}$/;

export function recordField(
  record: Record<string, unknown>,
  field: string,
): Record<string, unknown> {
  const value = record[field];
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`Execution plan archive ${field} is invalid`);
  }
  return value as Record<string, unknown>;
}

export function arrayField(
  record: Record<string, unknown>,
  field: string,
): unknown[] {
  const value = record[field];
  if (!Array.isArray(value)) {
    throw new Error(`Execution plan archive ${field} is invalid`);
  }
  return value;
}

export function stringArrayField(
  record: Record<string, unknown>,
  field: string,
): string[] {
  const values = arrayField(record, field);
  if (
    values.length > 30 ||
    !values.every((value) => typeof value === "string" && value.length > 0)
  ) {
    throw new Error(`Execution plan archive ${field} is invalid`);
  }
  return values as string[];
}

export function stringField(
  record: Record<string, unknown>,
  field: string,
): string {
  const value = record[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Execution plan archive ${field} is invalid`);
  }
  return value;
}

export function assertSha256(value: string, field: string): void {
  if (!isSha256(value)) {
    throw new Error(`Execution plan archive ${field} hash is invalid`);
  }
}

export function isSha256(value: string): boolean {
  return SHA256.test(value);
}

export function assertIsoString(value: unknown, field: string): void {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error(`Execution plan archive ${field} is invalid`);
  }
}

export function boundedString(
  value: unknown,
  minLength: number,
  maxLength: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length >= minLength &&
    value.length <= maxLength
  );
}

export function executionPlanArchiveDiagnostic(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("exceeds")) return "too_large";
  if (message.includes("missing field")) return "missing_field";
  if (message.includes("unsupported field")) return "unsupported_field";
  if (message.includes("kind is invalid")) return "invalid_kind";
  if (message.includes("schemaVersion")) return "unsupported_schema_version";
  if (message.includes("API version")) return "unsupported_api_version";
  if (message.includes("ownership")) return "ownership_mismatch";
  if (message.includes("duplicate")) return "duplicate_resource_id";
  if (message.includes("event stream hash mismatch")) return "hash_mismatch";
  if (message.includes("content hash mismatch")) return "hash_mismatch";
  if (message.includes("event binding mismatch")) {
    return "event_binding_mismatch";
  }
  if (message.includes("invalid")) return "invalid_shape";
  return "invalid_archive";
}
