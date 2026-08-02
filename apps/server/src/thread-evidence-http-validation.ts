import type {
  ExportOpenTelemetryTraceRequest,
  OpenTelemetryTraceArtifact,
  RunReplaySnapshot,
  ThreadReplayBundle,
  VerifyOpenTelemetryTraceArtifactRequest,
  VerifyRunReplaySnapshotRequest,
  VerifyThreadReplayBundleRequest,
} from "@napier/contracts";

import { requestRecord } from "./http-request-validation.js";

export function parseExportOpenTelemetryTraceRequest(
  input: unknown,
): ExportOpenTelemetryTraceRequest | undefined {
  if (input === undefined) return {};
  const record = requestRecord(input, ["runId"]);
  const runId = record?.["runId"];
  if (
    !record ||
    (runId !== undefined &&
      (typeof runId !== "string" || !/^run_[a-z0-9]{8,80}$/u.test(runId)))
  ) {
    return undefined;
  }
  return typeof runId === "string" ? { runId } : {};
}

export function parseVerifyThreadReplayBundleRequest(
  input: unknown,
): VerifyThreadReplayBundleRequest | undefined {
  const record = requestRecord(input, ["bundle"]);
  if (!record || record["bundle"] === undefined) return undefined;
  return {
    bundle: record["bundle"] as ThreadReplayBundle,
  };
}

export function parseVerifyRunReplaySnapshotRequest(
  input: unknown,
): VerifyRunReplaySnapshotRequest | undefined {
  const record = requestRecord(input, ["snapshot"]);
  if (!record || record["snapshot"] === undefined) return undefined;
  return {
    snapshot: record["snapshot"] as RunReplaySnapshot,
  };
}

export function parseVerifyOpenTelemetryTraceArtifactRequest(
  input: unknown,
): VerifyOpenTelemetryTraceArtifactRequest | undefined {
  const record = requestRecord(input, ["artifact"]);
  if (!record || record["artifact"] === undefined) return undefined;
  return {
    artifact: record["artifact"] as OpenTelemetryTraceArtifact,
  };
}
