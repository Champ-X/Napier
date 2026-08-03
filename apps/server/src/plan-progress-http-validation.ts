import type {
  TransitionPlanStepRequest,
  UpdateArtifactManifestRequest,
} from "@napier/contracts";

import { requestRecord } from "./http-request-validation.js";

export function parseTransitionPlanStepRequest(
  input: unknown,
): TransitionPlanStepRequest | undefined {
  const record = requestRecord(input, [
    "action",
    "runId",
    "evidence",
    "blocker",
  ]);
  const action = record?.["action"];
  const runId = record?.["runId"];
  const evidence = record?.["evidence"];
  const blocker = record?.["blocker"];
  if (
    !record ||
    (action !== "start" &&
      action !== "complete" &&
      action !== "block" &&
      action !== "skip" &&
      action !== "reopen") ||
    (runId !== undefined &&
      (typeof runId !== "string" || !/^run_[a-z0-9]{8,80}$/u.test(runId))) ||
    (evidence !== undefined && !boundedString(evidence, 0, 2_000)) ||
    (blocker !== undefined && !boundedString(blocker, 0, 1_000))
  ) {
    return undefined;
  }
  return {
    action,
    ...(typeof runId === "string" ? { runId } : {}),
    ...(typeof evidence === "string" ? { evidence } : {}),
    ...(typeof blocker === "string" ? { blocker } : {}),
  };
}

export function parseUpdateArtifactManifestRequest(
  input: unknown,
): UpdateArtifactManifestRequest | undefined {
  const record = requestRecord(input, [
    "status",
    "sha256",
    "sizeBytes",
    "sourceRunId",
    "evidence",
    "observeWorkspace",
  ]);
  const status = record?.["status"];
  const sha256 = record?.["sha256"];
  const sizeBytes = record?.["sizeBytes"];
  const sourceRunId = record?.["sourceRunId"];
  const evidence = record?.["evidence"];
  const observeWorkspace = record?.["observeWorkspace"];
  if (
    !record ||
    !validArtifactStatus(status) ||
    !validOptionalSha256(sha256) ||
    !validOptionalSize(sizeBytes) ||
    !validOptionalRunId(sourceRunId) ||
    (evidence !== undefined && !boundedString(evidence, 0, 2_000)) ||
    !validWorkspaceObservation(status, observeWorkspace, sha256, sizeBytes)
  ) {
    return undefined;
  }
  return {
    status,
    ...(typeof sha256 === "string" ? { sha256 } : {}),
    ...(typeof sizeBytes === "number" ? { sizeBytes } : {}),
    ...(typeof sourceRunId === "string" ? { sourceRunId } : {}),
    ...(typeof evidence === "string" ? { evidence } : {}),
    ...(observeWorkspace === true ? { observeWorkspace } : {}),
  };
}

function validArtifactStatus(
  value: unknown,
): value is UpdateArtifactManifestRequest["status"] {
  return (
    value === "expected" ||
    value === "produced" ||
    value === "verified" ||
    value === "missing" ||
    value === "superseded"
  );
}

function validOptionalSha256(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "string" && /^[a-f0-9]{64}$/u.test(value))
  );
}

function validOptionalSize(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
  );
}

function validOptionalRunId(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "string" && /^run_[a-z0-9]{8,80}$/u.test(value))
  );
}

function validWorkspaceObservation(
  status: UpdateArtifactManifestRequest["status"],
  observeWorkspace: unknown,
  sha256: unknown,
  sizeBytes: unknown,
): boolean {
  if (observeWorkspace !== undefined && typeof observeWorkspace !== "boolean") {
    return false;
  }
  return (
    observeWorkspace !== true ||
    ((status === "verified" || status === "missing") &&
      sha256 === undefined &&
      sizeBytes === undefined)
  );
}

function boundedString(
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
