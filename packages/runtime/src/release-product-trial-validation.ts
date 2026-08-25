import { createHash } from "node:crypto";

import type {
  ReleaseProductTrial,
  ReleaseProductTrialFailureReason,
  ReleaseProductTrialRunStatus,
  ReleaseProductTrialStatus,
} from "@napier/contracts/release-product-trial";

import { RELEASE_PRODUCT_CASEBOOK_TEMPLATE_ID } from "./evaluation-casebook-templates.js";
import { releaseProductVersionRequiresIdentity } from "./release-product-identity-policy.js";

export const STATUSES = new Set<ReleaseProductTrialStatus>([
  "passed",
  "failed",
  "inconclusive",
]);
export const RUN_STATUSES = new Set<ReleaseProductTrialRunStatus>([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);
export const FAILURE_REASONS = new Set<ReleaseProductTrialFailureReason>([
  "task_result",
  "tool_failure",
  "configuration",
  "manual_intervention",
  "recovery_failure",
  "ux_blocker",
]);

export function validProductVersion(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9A-Za-z][0-9A-Za-z._+-]{0,31}$/.test(value)
  );
}

export function validCount(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 100;
}

export function validTrialIdentity(candidate: ReleaseProductTrial): boolean {
  const identityRequired = releaseProductVersionRequiresIdentity(
    candidate.productVersion,
  );
  return (
    /^release_trial_[a-z0-9]{8,80}$/.test(candidate.id) &&
    /^thread_[a-z0-9]{8,80}$/.test(candidate.threadId) &&
    /^casebook_[a-z0-9]{8,80}$/.test(candidate.casebookId) &&
    candidate.templateId === RELEASE_PRODUCT_CASEBOOK_TEMPLATE_ID &&
    Number.isInteger(candidate.templateVersion) &&
    candidate.templateVersion >= 1 &&
    typeof candidate.templateCaseId === "string" &&
    /^run_[a-z0-9]{8,80}$/.test(candidate.runId) &&
    RUN_STATUSES.has(candidate.runStatus) &&
    (identityRequired
      ? /^[a-f0-9]{64}$/.test(candidate.releaseIdentitySha256 ?? "")
      : candidate.releaseIdentitySha256 === undefined)
  );
}

export function validTrialKeys(value: Record<string, unknown>): boolean {
  const allowed = new Set([
    "casebookId",
    "configurationInterventions",
    "contentSha256",
    "failureReason",
    "humanInterventions",
    "id",
    "productVersion",
    "releaseIdentitySha256",
    "recordedAt",
    "recoveryEvents",
    "runFinishedAt",
    "runId",
    "runStartedAt",
    "runStatus",
    "status",
    "templateCaseId",
    "templateId",
    "templateVersion",
    "threadId",
    "uxScore",
  ]);
  return Object.keys(value).every((key) => allowed.has(key));
}

export function validTrialTiming(candidate: ReleaseProductTrial): boolean {
  return (
    Number.isFinite(Date.parse(candidate.runStartedAt)) &&
    Number.isFinite(Date.parse(candidate.runFinishedAt)) &&
    Date.parse(candidate.runFinishedAt) >= Date.parse(candidate.runStartedAt) &&
    Number.isFinite(Date.parse(candidate.recordedAt))
  );
}

export function validTrialOutcome(
  candidate: ReleaseProductTrial,
  failureReason: unknown,
): boolean {
  if (
    !validProductVersion(candidate.productVersion) ||
    !STATUSES.has(candidate.status)
  )
    return false;
  if (candidate.status === "passed")
    return failureReason === undefined && candidate.runStatus === "completed";
  return (
    typeof failureReason === "string" &&
    FAILURE_REASONS.has(failureReason as ReleaseProductTrialFailureReason)
  );
}

export function validTrialMetrics(candidate: ReleaseProductTrial): boolean {
  return (
    validCount(candidate.configurationInterventions) &&
    validCount(candidate.humanInterventions) &&
    validCount(candidate.recoveryEvents) &&
    Number.isInteger(candidate.uxScore) &&
    candidate.uxScore >= 1 &&
    candidate.uxScore <= 5
  );
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
