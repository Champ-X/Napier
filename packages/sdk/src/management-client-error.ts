import type { NapierManagementClientErrorData } from "@napier/contracts/management-http";

export class NapierManagementClientError extends Error {
  readonly data: NapierManagementClientErrorData;

  constructor(data: NapierManagementClientErrorData) {
    const copy = deepFreeze(structuredClone(data));
    super(errorMessage(copy));
    this.name = "NapierManagementClientError";
    this.data = copy;
  }
}

function errorMessage(data: NapierManagementClientErrorData): string {
  switch (data.kind) {
    case "http":
      return `Napier management request failed (${String(data.status)} ${data.code}): ${data.serverMessage}`;
    case "transport":
      return `Napier management transport failed: ${data.reason}`;
    case "integrity":
      return `Napier management response integrity failed: ${data.reason}`;
    case "protocol":
      return `Napier management response protocol failed: ${data.reason}`;
  }
}

function deepFreeze<Value>(value: Value): Value {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
