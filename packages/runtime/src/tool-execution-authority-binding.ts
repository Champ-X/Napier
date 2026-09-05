import type { JsonValue, RunEvent } from "@napier/contracts";
import type {
  ToolInvocationProtocolV2,
  ToolProgressContribution,
  ToolProgressOperation,
  ToolProgressScope,
} from "@napier/contracts/tool-protocol";

import { bindToolOperationDescriptor } from "./tool-operation-binding.js";
import type { ToolOperationDescriptor } from "./tool-operation-model.js";

/**
 * Builds the infrastructure operation which fences one top-level tool call.
 * It deliberately shares the domain binding but carries a distinct role so
 * projections never mistake execution ownership for a provider/source attempt.
 */
export function toolExecutionAuthorityDescriptor(
  toolName: string,
  invocation: Pick<
    ToolInvocationProtocolV2,
    "toolId" | "progress" | "retry" | "sideEffect" | "failureDefinitionSha256"
  >,
): ToolOperationDescriptor {
  return {
    ...legacyToolExecutionAuthorityDescriptor(toolName, invocation),
    failureDefinitionSha256: invocation.failureDefinitionSha256,
    role: "execution_authority",
    startedTakeover:
      invocation.sideEffect === "none" &&
      invocation.retry.strategy === "terminal_failure"
        ? "idempotent"
        : "never",
  };
}

export function legacyToolExecutionAuthorityDescriptor(
  toolName: string,
  invocation: Pick<ToolInvocationProtocolV2, "toolId" | "progress">,
): ToolOperationDescriptor {
  const progress = invocation.progress;
  return {
    ordinal: 1,
    mode: progress.modeId ?? "invocation",
    route: toolName,
    operation: progress.operation,
    scope: progress.scope,
    contribution: progress.contribution,
    resourceKey:
      progress.resourceKeySha256 ?? fallbackBinding("resource", invocation),
    ...(progress.failureBindings
      ? { failureBindings: progress.failureBindings }
      : {}),
    failureDomainKey:
      progress.failureDomainKeySha256 ??
      fallbackBinding("failure-domain", invocation),
  };
}

/**
 * Projects both explicit authorities and the exact role-less envelope emitted
 * by pre-role Napier builds. Matching uses the complete descriptor binding,
 * not a route or mode heuristic.
 */
export function toolExecutionAuthorityOperationIds(
  events: readonly RunEvent[],
): ReadonlySet<string> {
  const operationIds = new Set<string>();
  for (const event of events) {
    const payload = record(event.payload);
    if (payload?.["role"] !== "execution_authority") continue;
    const operationId = text(payload["operationId"]);
    if (operationId) operationIds.add(operationId);
  }
  for (const event of events) {
    if (event.type !== "tool.admitted") continue;
    const descriptor = legacyDescriptorFromAdmission(event.payload);
    const payload = record(event.payload);
    const callId = text(payload?.["callId"]);
    if (!descriptor || !callId) continue;
    operationIds.add(
      bindToolOperationDescriptor(callId, descriptor).operationId,
    );
  }
  return operationIds;
}

function legacyDescriptorFromAdmission(
  payloadValue: JsonValue,
): ToolOperationDescriptor | undefined {
  const payload = record(payloadValue);
  const callId = text(payload?.["callId"]);
  const toolName = text(payload?.["toolName"]);
  const protocol = record(payload?.["toolProtocol"]);
  const progress = record(protocol?.["progress"]);
  const toolId = text(protocol?.["toolId"]);
  const operation = progressOperation(progress?.["operation"]);
  const scope = progressScope(progress?.["scope"]);
  const contribution = progressContribution(progress?.["contribution"]);
  const modeId = text(progress?.["modeId"]);
  const resourceKeySha256 = hash(progress?.["resourceKeySha256"]);
  const failureBindings = progressFailureBindings(
    progress?.["failureBindings"],
  );
  const failureDomainKeySha256 = hash(progress?.["failureDomainKeySha256"]);
  if (
    !callId ||
    !toolName ||
    !toolId ||
    toolId !== toolName ||
    !operation ||
    !scope ||
    !contribution
  ) {
    return undefined;
  }
  return legacyToolExecutionAuthorityDescriptor(toolName, {
    toolId,
    progress: {
      kind: "napier.tool-progress-semantics",
      schemaVersion: 1,
      availability:
        progress?.["availability"] === "declared" ? "declared" : "unavailable",
      coverage:
        progress?.["coverage"] === "trusted_declared"
          ? "trusted_declared"
          : "opaque",
      operation,
      scope,
      contribution,
      ...(modeId ? { modeId } : {}),
      ...(resourceKeySha256 ? { resourceKeySha256 } : {}),
      ...(failureBindings ? { failureBindings } : {}),
      ...(failureDomainKeySha256 ? { failureDomainKeySha256 } : {}),
    },
  });
}

function progressFailureBindings(
  value: JsonValue | undefined,
): ToolInvocationProtocolV2["progress"]["failureBindings"] | undefined {
  const candidate = record(value);
  if (!candidate) return undefined;
  const bindings = Object.fromEntries(
    (["target", "origin", "route", "capability", "session"] as const).flatMap(
      (scope) => {
        const binding = hash(candidate[scope]);
        return binding ? [[scope, binding] as const] : [];
      },
    ),
  );
  return Object.keys(bindings).length > 0 ? bindings : undefined;
}

function fallbackBinding(
  kind: "resource" | "failure-domain",
  invocation: Pick<ToolInvocationProtocolV2, "toolId" | "progress">,
): Record<string, JsonValue> {
  return {
    kind: `napier.tool-execution-${kind}`,
    schemaVersion: 1,
    toolId: invocation.toolId,
    scope: invocation.progress.scope,
  };
}

function record(value: unknown): Record<string, JsonValue> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function hash(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)
    ? value
    : undefined;
}

function progressOperation(value: unknown): ToolProgressOperation | undefined {
  return typeof value === "string" &&
    [
      "acquire",
      "reuse",
      "observe",
      "mutate",
      "verify",
      "coordinate",
      "neutral",
    ].includes(value)
    ? (value as ToolProgressOperation)
    : undefined;
}

function progressScope(value: unknown): ToolProgressScope | undefined {
  return typeof value === "string" &&
    [
      "external",
      "run_source",
      "workspace",
      "session",
      "remote",
      "control",
      "neutral",
    ].includes(value)
    ? (value as ToolProgressScope)
    : undefined;
}

function progressContribution(
  value: unknown,
): ToolProgressContribution | undefined {
  return typeof value === "string" &&
    ["supporting", "product", "verification", "control", "neutral"].includes(
      value,
    )
    ? (value as ToolProgressContribution)
    : undefined;
}
