import type { JsonValue } from "@napier/contracts";

import { sha256 } from "./ed25519.js";
import { decodeRunPlanProgressSnapshot } from "./run-progress-plan-state.js";

export const PLAN_ARTIFACT_EVENT_PROJECTION_KEYS = [
  "criticalPathStepIds",
  "readyStepIds",
  "blockedStepIds",
  "activePhaseIndex",
  "parallelReadyStepIds",
  "phaseWaveCount",
  "phaseProjectionSha256",
  "runProgressSnapshot",
] as const;

export function isPlanArtifactProjectionPayloadValid(
  payload: Record<string, unknown>,
  maxPlanSteps: number,
): boolean {
  const snapshotValue = payload["runProgressSnapshot"];
  const snapshot =
    snapshotValue === undefined
      ? undefined
      : decodeRunPlanProgressSnapshot(snapshotValue as JsonValue);
  const planId = stringValue(payload["planId"]);
  return (
    optionalStringArray(payload["criticalPathStepIds"], maxPlanSteps) &&
    optionalStringArray(payload["readyStepIds"], maxPlanSteps) &&
    optionalStringArray(payload["blockedStepIds"], maxPlanSteps) &&
    optionalStringArray(payload["parallelReadyStepIds"], maxPlanSteps) &&
    optionalNonNegativeIntegerOrNull(payload["activePhaseIndex"]) &&
    optionalNonNegativeInteger(payload["phaseWaveCount"]) &&
    optionalSha256(payload["phaseProjectionSha256"]) &&
    (snapshotValue === undefined ||
      (snapshot !== undefined &&
        planId !== undefined &&
        snapshot.planIdSha256 === sha256(planId)))
  );
}

function optionalStringArray(value: unknown, maxItems: number): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.length <= maxItems &&
      value.every((entry) => typeof entry === "string"))
  );
}

function optionalNonNegativeInteger(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "number" && Number.isInteger(value) && value >= 0)
  );
}

function optionalNonNegativeIntegerOrNull(value: unknown): boolean {
  return value === null || optionalNonNegativeInteger(value);
}

function optionalSha256(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && isSha256(value));
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/u.test(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
