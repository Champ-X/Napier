import { describe, expect, it } from "vitest";

import {
  parseExportOpenTelemetryTraceRequest,
  parseVerifyOpenTelemetryTraceArtifactRequest,
  parseVerifyRunReplaySnapshotRequest,
  parseVerifyThreadReplayBundleRequest,
} from "../src/thread-evidence-http-validation.js";

describe("Thread evidence HTTP validation", () => {
  it("accepts an omitted or exact run-scoped trace request", () => {
    expect(parseExportOpenTelemetryTraceRequest(undefined)).toEqual({});
    expect(
      parseExportOpenTelemetryTraceRequest({
        runId: "run_0123456789abcdef",
      }),
    ).toEqual({ runId: "run_0123456789abcdef" });
  });

  it("rejects malformed or extended trace requests", () => {
    expect(
      parseExportOpenTelemetryTraceRequest({
        runId: "run_short",
      }),
    ).toBeUndefined();
    expect(
      parseExportOpenTelemetryTraceRequest({
        runId: "run_0123456789abcdef",
        unexpected: true,
      }),
    ).toBeUndefined();
  });

  it("accepts exact verification envelopes without trusting their contents", () => {
    const bundle = { kind: "thread-bundle" };
    const snapshot = { kind: "run-snapshot" };
    const artifact = { kind: "otel-trace" };
    expect(parseVerifyThreadReplayBundleRequest({ bundle })).toEqual({
      bundle,
    });
    expect(parseVerifyRunReplaySnapshotRequest({ snapshot })).toEqual({
      snapshot,
    });
    expect(parseVerifyOpenTelemetryTraceArtifactRequest({ artifact })).toEqual({
      artifact,
    });
  });

  it("rejects missing or extended verification envelopes", () => {
    expect(parseVerifyThreadReplayBundleRequest({})).toBeUndefined();
    expect(
      parseVerifyRunReplaySnapshotRequest({
        snapshot: {},
        unexpected: true,
      }),
    ).toBeUndefined();
    expect(
      parseVerifyOpenTelemetryTraceArtifactRequest({
        artifact: undefined,
      }),
    ).toBeUndefined();
  });
});
