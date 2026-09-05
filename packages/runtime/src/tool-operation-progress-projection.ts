import type {
  JsonValue,
  RunEvent,
  ToolOperationFailureV1,
} from "@napier/contracts";
import type {
  ToolProgressContribution,
  ToolFailureBindingsV1,
  ToolProgressOperation,
  ToolProgressScope,
} from "@napier/contracts/tool-protocol";

import { canonicalJson, sha256 } from "./ed25519.js";
import { failureCircuitKey } from "./run-failure-circuit-resolution.js";
import { progressFailureBinding } from "./run-convergence-tool-progress.js";
import { toolExecutionAuthorityOperationIds } from "./tool-execution-authority-binding.js";
import {
  TOOL_OPERATION_EVENT_TYPES,
  type SettledToolOperationProgressObservation,
  type ToolOperationProgressProjection,
} from "./tool-operation-model.js";

interface ChildProgressCandidate {
  role: "progress" | "execution_authority";
  parentCallId: string;
  operationId: string;
  ordinal: number;
  mode: string;
  route: string;
  operation: ToolProgressOperation;
  scope: ToolProgressScope;
  contribution: ToolProgressContribution;
  resourceKeySha256: string;
  failureBindings?: ToolFailureBindingsV1;
  failureDomainKeySha256: string;
  descriptorSha256: string;
  proposed?: string;
  admission?: "admitted" | "rejected";
  admissionSource?: "caller" | "failure_circuit";
  started?: string;
  outcome?: "succeeded" | "failed" | "skipped";
  stateSha256?: string;
  effectSha256?: string;
  terminalPhaseStateSha256?: string;
  settledEventSeq?: number;
  failure?: ToolOperationFailureV1;
}

type CompleteCandidate = ChildProgressCandidate & {
  admission: "admitted" | "rejected";
  outcome: "succeeded" | "failed" | "skipped";
  effectSha256: string;
  terminalPhaseStateSha256: string;
  settledEventSeq: number;
};

/** Pure first-terminal-wins reduction over durable child-operation events. */
export function projectSettledToolOperationProgress(
  events: readonly RunEvent[],
): ToolOperationProgressProjection {
  const candidates = new Map<string, ChildProgressCandidate>();
  const authorityOperationIds = toolExecutionAuthorityOperationIds(events);
  for (const event of [...events].sort(compareEvents)) {
    ingestOperationEvent(candidates, authorityOperationIds, event);
  }
  const observations = [...candidates.values()]
    .filter((candidate) => candidate.role === "progress")
    .filter(isCompleteCandidate)
    .sort(compareCandidates)
    .map(toSettledProgressObservation);
  const suppressParentSingletonCallIds = [
    ...new Set(observations.map((operation) => operation.parentCallId)),
  ].sort();
  return {
    kind: "napier.tool-operation-progress-projection",
    schemaVersion: 1,
    suppressParentSingletonCallIds,
    observations,
    observationSetSha256: sha256(canonicalJson(observations)),
  };
}

function ingestOperationEvent(
  candidates: Map<string, ChildProgressCandidate>,
  authorityOperationIds: ReadonlySet<string>,
  event: RunEvent,
): void {
  if (!isToolOperationEvent(event.type)) return;
  const payload = object(event.payload);
  const incoming = payload ? childProgressCandidate(payload) : undefined;
  if (!payload || !incoming) return;
  if (authorityOperationIds.has(incoming.operationId)) return;
  const candidate = candidates.get(incoming.operationId);
  if (candidate && !sameDescriptor(candidate, incoming)) return;
  const projected = candidate ?? incoming;
  candidates.set(projected.operationId, projected);
  if (event.type === "tool.operation.proposed") {
    const phaseStateSha256 = hash(payload["phaseStateSha256"]);
    if (!projected.proposed && phaseStateSha256) {
      projected.proposed = phaseStateSha256;
    }
  } else if (event.type === "tool.operation.admitted") {
    applyAdmission(projected, payload);
  } else if (event.type === "tool.operation.started") {
    applyStarted(projected, payload);
  } else if (event.type === "tool.operation.settled") {
    applySettlement(projected, payload, event.seq);
  }
}

function applyAdmission(
  candidate: ChildProgressCandidate,
  payload: Record<string, JsonValue>,
): void {
  if (!candidate.proposed || candidate.admission !== undefined) return;
  const admission = text(payload["admission"]);
  if (admission !== "admitted" && admission !== "rejected") return;
  candidate.admission = admission;
  candidate.admissionSource = exactCircuitRejection(payload, candidate)
    ? "failure_circuit"
    : "caller";
}

function applyStarted(
  candidate: ChildProgressCandidate,
  payload: Record<string, JsonValue>,
): void {
  if (candidate.admission !== "admitted" || candidate.started) return;
  const phaseStateSha256 = hash(payload["phaseStateSha256"]);
  if (phaseStateSha256) candidate.started = phaseStateSha256;
}

function applySettlement(
  candidate: ChildProgressCandidate,
  payload: Record<string, JsonValue>,
  eventSeq: number,
): void {
  if (
    !candidate.proposed ||
    !candidate.admission ||
    candidate.outcome !== undefined
  ) {
    return;
  }
  const outcome = text(payload["outcome"]);
  const effectSha256 = hash(payload["effectSha256"]);
  if (!settledOutcome(outcome) || !effectSha256) return;
  if (
    (candidate.admission === "rejected" && outcome !== "skipped") ||
    (candidate.admission === "admitted" &&
      outcome !== "skipped" &&
      !candidate.started)
  ) {
    return;
  }
  const failure = operationFailure(payload["failure"]);
  if (outcome !== "succeeded" && !failure) return;
  candidate.outcome = outcome;
  candidate.settledEventSeq = eventSeq;
  candidate.effectSha256 = effectSha256;
  const stateSha256 = hash(payload["stateSha256"]);
  const terminalPhaseStateSha256 = hash(payload["phaseStateSha256"]);
  if (stateSha256) candidate.stateSha256 = stateSha256;
  if (terminalPhaseStateSha256) {
    candidate.terminalPhaseStateSha256 = terminalPhaseStateSha256;
  }
  if (failure) candidate.failure = failure;
}

function childProgressCandidate(
  payload: Record<string, JsonValue>,
): ChildProgressCandidate | undefined {
  const parsedFailureBindings = failureBindings(payload["failureBindings"]);
  const candidate = {
    role: operationRole(payload["role"]),
    parentCallId: text(payload["parentCallId"]),
    operationId: text(payload["operationId"]),
    ordinal: positiveInteger(payload["ordinal"]),
    mode: text(payload["mode"]),
    route: text(payload["route"]),
    operation: progressOperation(payload["operation"]),
    scope: progressScope(payload["scope"]),
    contribution: progressContribution(payload["contribution"]),
    resourceKeySha256: hash(payload["resourceKeySha256"]),
    ...(parsedFailureBindings
      ? { failureBindings: parsedFailureBindings }
      : {}),
    failureDomainKeySha256: hash(payload["failureDomainKeySha256"]),
    descriptorSha256: hash(payload["descriptorSha256"]),
  };
  return Object.values(candidate).some((value) => value === undefined)
    ? undefined
    : (candidate as ChildProgressCandidate);
}

function toSettledProgressObservation(
  candidate: CompleteCandidate,
): SettledToolOperationProgressObservation {
  const acquisition = candidate.operation === "acquire";
  const admitted = candidate.admission === "admitted";
  const succeeded = candidate.outcome === "succeeded";
  const inheritedCircuitRejection =
    candidate.admissionSource === "failure_circuit";
  const observationId = sha256(
    canonicalJson({
      parentCallId: candidate.parentCallId,
      operationId: candidate.operationId,
      terminalPhaseStateSha256: candidate.terminalPhaseStateSha256,
    }),
  );
  return {
    kind: "napier.settled-tool-operation-progress",
    schemaVersion: 1,
    observationId,
    parentCallId: candidate.parentCallId,
    operationId: candidate.operationId,
    settledEventSeq: candidate.settledEventSeq,
    ordinal: candidate.ordinal,
    mode: candidate.mode,
    route: candidate.route,
    admission: candidate.admission,
    admissionSource: candidate.admissionSource ?? "caller",
    outcome: candidate.outcome,
    progress: {
      availability: "declared",
      coverage: "trusted_declared",
      operation: candidate.operation,
      scope: candidate.scope,
      contribution: candidate.contribution,
      resourceKeySha256: candidate.resourceKeySha256,
      ...(candidate.failureBindings
        ? { failureBindings: candidate.failureBindings }
        : {}),
      failureDomainKeySha256: candidate.failureDomainKeySha256,
      ...(candidate.stateSha256 ? { stateSha256: candidate.stateSha256 } : {}),
    },
    acquisitionAttempt: admitted && acquisition,
    acquisitionAdvance: succeeded && acquisition,
    failureObserved: !succeeded && !inheritedCircuitRejection,
    acquisitionFailure:
      admitted && acquisition && candidate.outcome === "failed",
    ...(candidate.failure && !inheritedCircuitRejection
      ? { failure: candidate.failure }
      : {}),
    effectSha256: candidate.effectSha256,
  };
}

function exactCircuitRejection(
  payload: Record<string, JsonValue>,
  candidate: ChildProgressCandidate,
): boolean {
  if (payload["admissionSource"] !== "failure_circuit") return false;
  const scope = text(payload["circuitScope"]);
  const keySha256 = hash(payload["circuitKeySha256"]);
  if (!scope || !keySha256 || !failureScope(scope)) return false;
  const bindingSha256 =
    scope === "invocation"
      ? undefined
      : progressFailureBinding(candidate, scope);
  return Boolean(
    bindingSha256 && failureCircuitKey(scope, bindingSha256) === keySha256,
  );
}

function failureBindings(
  value: JsonValue | undefined,
): ToolFailureBindingsV1 | undefined {
  const candidate = object(value);
  if (!candidate) return undefined;
  const bindings = Object.fromEntries(
    (["target", "origin", "route", "capability", "session"] as const).flatMap(
      (scope) => {
        const binding = hash(candidate[scope]);
        return binding ? [[scope, binding] as const] : [];
      },
    ),
  ) as ToolFailureBindingsV1;
  return Object.keys(bindings).length > 0 ? bindings : undefined;
}

function sameDescriptor(
  left: ChildProgressCandidate,
  right: ChildProgressCandidate,
): boolean {
  return (
    left.parentCallId === right.parentCallId &&
    left.descriptorSha256 === right.descriptorSha256
  );
}

function isCompleteCandidate(
  candidate: ChildProgressCandidate,
): candidate is CompleteCandidate {
  return Boolean(
    candidate.admission &&
    candidate.outcome &&
    candidate.effectSha256 &&
    candidate.terminalPhaseStateSha256 &&
    candidate.settledEventSeq !== undefined,
  );
}

function compareEvents(left: RunEvent, right: RunEvent): number {
  return left.seq - right.seq || left.id.localeCompare(right.id);
}

function compareCandidates(
  left: ChildProgressCandidate,
  right: ChildProgressCandidate,
): number {
  return (
    left.parentCallId.localeCompare(right.parentCallId) ||
    left.ordinal - right.ordinal ||
    left.operationId.localeCompare(right.operationId)
  );
}

function operationFailure(
  value: JsonValue | undefined,
): ToolOperationFailureV1 | undefined {
  const failure = object(value);
  return failure ? (failure as unknown as ToolOperationFailureV1) : undefined;
}

function settledOutcome(
  value: string | undefined,
): value is "succeeded" | "failed" | "skipped" {
  return value === "succeeded" || value === "failed" || value === "skipped";
}

function isToolOperationEvent(
  type: string,
): type is (typeof TOOL_OPERATION_EVENT_TYPES)[number] {
  return (TOOL_OPERATION_EVENT_TYPES as readonly string[]).includes(type);
}

function progressOperation(
  value: JsonValue | undefined,
): ToolProgressOperation | undefined {
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

function operationRole(
  value: JsonValue | undefined,
): ChildProgressCandidate["role"] | undefined {
  if (value === undefined || value === "progress") return "progress";
  return value === "execution_authority" ? value : undefined;
}

function progressScope(
  value: JsonValue | undefined,
): ToolProgressScope | undefined {
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
  value: JsonValue | undefined,
): ToolProgressContribution | undefined {
  return typeof value === "string" &&
    ["supporting", "product", "verification", "control", "neutral"].includes(
      value,
    )
    ? (value as ToolProgressContribution)
    : undefined;
}

function failureScope(value: string): value is ToolOperationFailureV1["scope"] {
  return [
    "invocation",
    "target",
    "origin",
    "route",
    "capability",
    "session",
  ].includes(value);
}

function object(value: unknown): Record<string, JsonValue> | undefined {
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

function positiveInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) > 0
    ? Number(value)
    : undefined;
}
