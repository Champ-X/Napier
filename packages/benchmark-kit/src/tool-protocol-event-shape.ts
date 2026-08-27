const TOOL_PROTOCOL_KEYS = [
  "kind",
  "schemaVersion",
  "toolId",
  "semanticVersion",
  "definitionSha256",
  "implementationSha256",
  "status",
  "sideEffect",
  "concurrency",
  "compatibilityMode",
] as const;

export function validCompletedToolProtocolProjection(
  value: unknown,
  toolId: string,
): boolean {
  if (!record(value)) return false;
  return (
    exactKeys(value, TOOL_PROTOCOL_KEYS) &&
    value["kind"] === "napier.tool-ui-projection" &&
    value["schemaVersion"] === 2 &&
    value["toolId"] === toolId &&
    typeof value["semanticVersion"] === "string" &&
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(value["semanticVersion"]) &&
    digest(value["definitionSha256"]) &&
    digest(value["implementationSha256"]) &&
    value["status"] === "completed" &&
    ["none", "reversible", "irreversible", "unknown"].includes(
      String(value["sideEffect"]),
    ) &&
    ["safe", "serialized", "exclusive"].includes(
      String(value["concurrency"]),
    ) &&
    (value["compatibilityMode"] === "native" ||
      value["compatibilityMode"] === "compatibility")
  );
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return (
    JSON.stringify(Object.keys(value).sort()) ===
    JSON.stringify([...keys].sort())
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function digest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}
