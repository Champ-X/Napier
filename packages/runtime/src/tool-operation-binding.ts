import type { JsonValue, ToolOperationFailureV1 } from "@napier/contracts";
import type {
  ToolFailureBindingScope,
  ToolFailureBindingsV1,
} from "@napier/contracts/tool-protocol";

import { canonicalJson, sha256 } from "./ed25519.js";
import type { ResolvedRunFailureCircuit } from "./run-failure-circuit-model.js";
import {
  normalizeToolFailureReceipt,
  toolFailureLedgerProjection,
} from "./tool-failure-semantics.js";
import type { ToolOperationDescriptor } from "./tool-operation-model.js";
import {
  toolOperationDescriptorSha256,
  toolOperationId,
} from "./tool-operation-identity.js";

export interface BoundToolOperationDescriptor {
  parentCallId: string;
  operationId: string;
  descriptor: ToolOperationDescriptor;
  resourceKeySha256: string;
  failureBindings?: ToolFailureBindingsV1;
  failureDefinitionSha256?: string;
  failureDomainKeySha256: string;
  descriptorSha256: string;
}

export function bindToolOperationDescriptor(
  parentCallId: string,
  descriptor: ToolOperationDescriptor,
): BoundToolOperationDescriptor {
  const resourceKeySha256 = requiredStableBinding(
    descriptor.resourceKey,
    "resourceKey",
  );
  const failureDomainKeySha256 = requiredStableBinding(
    descriptor.failureDomainKey,
    "failureDomainKey",
  );
  const failureBindings = bindFailureBindings(descriptor.failureBindings);
  const failureDefinitionSha256 = descriptor.failureDefinitionSha256;
  if (
    failureDefinitionSha256 !== undefined &&
    !/^[a-f0-9]{64}$/u.test(failureDefinitionSha256)
  ) {
    throw new Error("Tool operation failure definition hash is invalid");
  }
  const stableDescriptor = {
    ...(descriptor.role ? { role: descriptor.role } : {}),
    ...(descriptor.startedTakeover
      ? { startedTakeover: descriptor.startedTakeover }
      : {}),
    ordinal: descriptor.ordinal,
    mode: descriptor.mode,
    route: descriptor.route,
    operation: descriptor.operation,
    scope: descriptor.scope,
    contribution: descriptor.contribution,
    resourceKeySha256,
    ...(failureBindings ? { failureBindings } : {}),
    ...(failureDefinitionSha256 ? { failureDefinitionSha256 } : {}),
    failureDomainKeySha256,
  };
  const descriptorSha256 = toolOperationDescriptorSha256(stableDescriptor);
  return {
    parentCallId,
    operationId: toolOperationId(parentCallId, stableDescriptor),
    descriptor,
    resourceKeySha256,
    ...(failureBindings ? { failureBindings } : {}),
    ...(failureDefinitionSha256 ? { failureDefinitionSha256 } : {}),
    failureDomainKeySha256,
    descriptorSha256,
  };
}

const FAILURE_BINDING_SCOPES = [
  "target",
  "origin",
  "route",
  "capability",
  "session",
] as const satisfies readonly ToolFailureBindingScope[];

function bindFailureBindings(
  values: ToolOperationDescriptor["failureBindings"],
): ToolFailureBindingsV1 | undefined {
  if (!values) return undefined;
  const bindings = Object.fromEntries(
    FAILURE_BINDING_SCOPES.flatMap((scope) => {
      const binding = stableOperationBinding(values[scope]);
      return binding ? [[scope, binding] as const] : [];
    }),
  ) as ToolFailureBindingsV1;
  return Object.keys(bindings).length > 0 ? Object.freeze(bindings) : undefined;
}

export function normalizeToolOperationDescriptor(
  descriptor: ToolOperationDescriptor,
): ToolOperationDescriptor {
  if (!Number.isSafeInteger(descriptor.ordinal) || descriptor.ordinal < 1) {
    throw new Error("Tool operation ordinal must be a positive safe integer");
  }
  assertOperationText(descriptor.mode, "mode");
  assertOperationText(descriptor.route, "route");
  if (
    descriptor.role !== undefined &&
    descriptor.role !== "progress" &&
    descriptor.role !== "execution_authority"
  ) {
    throw new Error("Tool operation role is invalid");
  }
  if (
    descriptor.startedTakeover !== undefined &&
    descriptor.startedTakeover !== "never" &&
    descriptor.startedTakeover !== "idempotent"
  ) {
    throw new Error("Tool operation startedTakeover is invalid");
  }
  return Object.freeze({ ...descriptor });
}

export function stableOperationBinding(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)) return value;
  try {
    return sha256(canonicalJson(normalizeJson(value)));
  } catch {
    return undefined;
  }
}

export function operationFailure(
  diagnostic: unknown,
  details: unknown,
  failure?: unknown,
): ToolOperationFailureV1 {
  if (failure !== undefined) {
    return normalizeToolFailureReceipt(failure, {
      diagnostic: diagnosticText(diagnostic),
      details,
    }) as unknown as ToolOperationFailureV1;
  }
  const text = diagnosticText(diagnostic);
  return toolFailureLedgerProjection(text, details)
    .toolFailure as unknown as ToolOperationFailureV1;
}

function diagnosticText(diagnostic: unknown): string {
  return diagnostic instanceof Error
    ? `${diagnostic.name}: ${diagnostic.message}`
    : String(diagnostic ?? "operation did not execute");
}

export function operationFailureFromPayload(
  value: JsonValue | undefined,
): ToolOperationFailureV1 | undefined {
  const failure = operationObject(value);
  return failure ? (failure as unknown as ToolOperationFailureV1) : undefined;
}

export function circuitRejectionEffectSha256(circuitKeySha256: string): string {
  return sha256(
    canonicalJson({
      outcome: "skipped",
      admissionSource: "failure_circuit",
      circuitKeySha256,
    }),
  );
}

export function operationAdmissionTimestamp(value: number | string): number {
  const timestamp = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new Error(
      "Tool operation circuit clock returned an invalid timestamp",
    );
  }
  return timestamp;
}

export function assertOperationText(value: string, label: string): void {
  if (!value.trim() || value.length > 256) {
    throw new Error(`Tool operation ${label} must contain 1-256 characters`);
  }
}

export function operationObject(
  value: unknown,
): Record<string, JsonValue> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : undefined;
}

export function operationText(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

export function operationHash(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)
    ? value
    : undefined;
}

export function operationNonNegativeInteger(
  value: unknown,
): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Number(value)
    : undefined;
}

export function isOperationFailureCircuitScope(
  value: string,
): value is ResolvedRunFailureCircuit["scope"] {
  return [
    "invocation",
    "target",
    "origin",
    "route",
    "capability",
    "session",
  ].includes(value);
}

function requiredStableBinding(value: unknown, label: string): string {
  const binding = stableOperationBinding(value);
  if (!binding) throw new Error(`Tool operation ${label} is not serializable`);
  return binding;
}

function normalizeJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}
