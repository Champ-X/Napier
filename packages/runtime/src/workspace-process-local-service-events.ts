import type { WorkspaceProcessStatus } from "@napier/contracts";

const SHA256 = /^[a-f0-9]{64}$/u;
const SERVICE_KEYS = new Set([
  "protocol",
  "containerPort",
  "host",
  "hostPort",
  "url",
  "healthPathSha256",
  "identitySha256",
  "status",
  "readyAt",
]);

export function validWorkspaceProcessLocalServiceFields(
  value: Record<string, unknown>,
  status: WorkspaceProcessStatus,
): boolean {
  if (value["schemaVersion"] !== 8) {
    return (
      value["networkAccess"] === "denied" && value["localService"] === undefined
    );
  }
  const service = value["localService"];
  if (
    value["workspaceAccess"] !== "read_only" ||
    value["networkAccess"] !== "outbound_denied_loopback_service" ||
    !record(service) ||
    Object.keys(service).some((key) => !SERVICE_KEYS.has(key)) ||
    service["protocol"] !== "http" ||
    !port(service["containerPort"]) ||
    service["host"] !== "127.0.0.1" ||
    !port(service["hostPort"]) ||
    service["url"] !== `http://127.0.0.1:${String(service["hostPort"])}/` ||
    !hash(service["healthPathSha256"]) ||
    !hash(service["identitySha256"]) ||
    !isoDate(service["readyAt"])
  ) {
    return false;
  }
  return status === "running"
    ? service["status"] === "ready"
    : service["status"] === "closed";
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hash(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}

function port(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    Number(value) >= 1_024 &&
    Number(value) <= 65_535
  );
}

function isoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
