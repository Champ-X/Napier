import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  artifactEventTraceSummary,
  artifactEventTraceView,
} from "../src/artifact-event-view";

describe("artifact event trace view", () => {
  it("projects exported artifact evidence without paths or file contents", () => {
    const event = artifactEvent("artifact.exported", {
      planId: "plan_1234567890",
      artifactId: "artifact_0987654321",
      planRevision: 4,
      status: "verified",
      kind: "file",
      path: "TOP_SECRET_PATH",
      contents: "TOP_SECRET_CONTENTS",
      pathSha256: "a".repeat(64),
      sha256: "b".repeat(64),
      sizeBytes: 4096,
    });

    expect(artifactEventTraceView(event)).toEqual({
      action: "exported",
      planId: "plan_1234567890",
      artifactId: "artifact_0987654321",
      planRevision: 4,
      status: "verified",
      kind: "file",
      pathSha256: "a".repeat(64),
      sha256: "b".repeat(64),
      sizeBytes: 4096,
    });
    expect(artifactEventTraceSummary(event)).toBe(
      `artifact / exported / plan 1234567890 / artifact 0987654321 / plan-r4 / status verified / kind file / size-bytes 4096 / path ${"a".repeat(12)} / artifact ${"b".repeat(12)}`,
    );
    expect(artifactEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("projects previewed artifact text evidence without text contents", () => {
    const event = artifactEvent("artifact.previewed", {
      planId: "plan_1234567890",
      artifactId: "artifact_0987654321",
      planRevision: 5,
      status: "verified",
      kind: "file",
      path: "TOP_SECRET_PATH",
      text: "TOP_SECRET_TEXT",
      pathSha256: "a".repeat(64),
      sha256: "b".repeat(64),
      textSha256: "c".repeat(64),
      sizeBytes: 128,
      lineCount: 4,
    });

    expect(artifactEventTraceView(event)).toEqual({
      action: "previewed",
      planId: "plan_1234567890",
      artifactId: "artifact_0987654321",
      planRevision: 5,
      status: "verified",
      kind: "file",
      pathSha256: "a".repeat(64),
      sha256: "b".repeat(64),
      textSha256: "c".repeat(64),
      sizeBytes: 128,
      lineCount: 4,
    });
    expect(artifactEventTraceSummary(event)).toBe(
      `artifact / previewed / plan 1234567890 / artifact 0987654321 / plan-r5 / status verified / kind file / size-bytes 128 / lines 4 / path ${"a".repeat(12)} / artifact ${"b".repeat(12)} / text ${"c".repeat(12)}`,
    );
    expect(artifactEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("projects data profiles without columns or sample rows", () => {
    const event = artifactEvent("artifact.data_profiled", {
      planId: "plan_1234567890",
      artifactId: "artifact_0987654321",
      planRevision: 5,
      status: "verified",
      kind: "file",
      format: "markdown_table",
      path: "TOP_SECRET_PATH",
      columns: ["TOP_SECRET_COLUMN"],
      sampleRows: [{ TOP_SECRET_COLUMN: "TOP_SECRET_VALUE" }],
      pathSha256: "a".repeat(64),
      sha256: "b".repeat(64),
      columnSetSha256: "c".repeat(64),
      sampleSha256: "d".repeat(64),
      sizeBytes: 128,
      rowCount: 3,
      columnCount: 2,
      truncated: false,
    });

    expect(artifactEventTraceView(event)).toEqual({
      action: "data_profiled",
      planId: "plan_1234567890",
      artifactId: "artifact_0987654321",
      planRevision: 5,
      status: "verified",
      kind: "file",
      format: "markdown_table",
      pathSha256: "a".repeat(64),
      sha256: "b".repeat(64),
      columnSetSha256: "c".repeat(64),
      sampleSha256: "d".repeat(64),
      sizeBytes: 128,
      rowCount: 3,
      columnCount: 2,
      truncated: false,
    });
    expect(artifactEventTraceSummary(event)).toBe(
      `artifact / data_profiled / plan 1234567890 / artifact 0987654321 / plan-r5 / status verified / kind file / format Markdown table / truncated false / size-bytes 128 / rows 3 / columns 2 / path ${"a".repeat(12)} / artifact ${"b".repeat(12)} / columns ${"c".repeat(12)} / sample ${"d".repeat(12)}`,
    );
    expect(artifactEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("projects data profile verification receipts without diagnostics or samples", () => {
    const event = artifactEvent("artifact.data_profile_verified", {
      planId: "plan_1234567890",
      artifactId: "artifact_0987654321",
      planRevision: 6,
      status: "verified",
      kind: "file",
      verificationStatus: "drifted",
      diagnostics: ["TOP_SECRET_DIAGNOSTIC"],
      columns: ["TOP_SECRET_COLUMN"],
      sampleRows: [{ TOP_SECRET_COLUMN: "TOP_SECRET_VALUE" }],
      pathSha256: "a".repeat(64),
      diagnosticsSha256: "3".repeat(64),
      declaredSha256: "b".repeat(64),
      observedSha256: "c".repeat(64),
      declaredSizeBytes: 128,
      observedSizeBytes: 256,
      declaredFormat: "csv",
      observedFormat: "json",
      declaredRowCount: 3,
      observedRowCount: 4,
      declaredColumnCount: 2,
      observedColumnCount: 3,
      declaredTruncated: false,
      observedTruncated: true,
      declaredColumnSetSha256: "d".repeat(64),
      recomputedDeclaredColumnSetSha256: "e".repeat(64),
      observedColumnSetSha256: "f".repeat(64),
      declaredSampleSha256: "0".repeat(64),
      recomputedDeclaredSampleSha256: "1".repeat(64),
      observedSampleSha256: "2".repeat(64),
      diagnosticCount: 1,
    });

    expect(artifactEventTraceView(event)).toEqual({
      action: "data_profile_verified",
      planId: "plan_1234567890",
      artifactId: "artifact_0987654321",
      planRevision: 6,
      status: "verified",
      kind: "file",
      verificationStatus: "drifted",
      pathSha256: "a".repeat(64),
      diagnosticsSha256: "3".repeat(64),
      declaredSha256: "b".repeat(64),
      observedSha256: "c".repeat(64),
      declaredSizeBytes: 128,
      observedSizeBytes: 256,
      declaredFormat: "csv",
      observedFormat: "json",
      declaredRowCount: 3,
      observedRowCount: 4,
      declaredColumnCount: 2,
      observedColumnCount: 3,
      declaredTruncated: false,
      observedTruncated: true,
      declaredColumnSetSha256: "d".repeat(64),
      recomputedDeclaredColumnSetSha256: "e".repeat(64),
      observedColumnSetSha256: "f".repeat(64),
      declaredSampleSha256: "0".repeat(64),
      recomputedDeclaredSampleSha256: "1".repeat(64),
      observedSampleSha256: "2".repeat(64),
      diagnosticCount: 1,
    });
    expect(artifactEventTraceSummary(event)).toBe(
      `artifact / data_profile_verified / plan 1234567890 / artifact 0987654321 / plan-r6 / status verified / kind file / verification drifted / formats CSV->JSON / truncated false->true / size-bytes 128->256 / rows 3->4 / columns 2->3 / diagnostics 1 / path ${"a".repeat(12)} / declared ${"b".repeat(12)} / observed ${"c".repeat(12)} / declared-columns ${"d".repeat(12)} / declared-columns-self ${"e".repeat(12)} / observed-columns ${"f".repeat(12)} / declared-sample ${"0".repeat(12)} / declared-sample-self ${"1".repeat(12)} / observed-sample ${"2".repeat(12)} / diagnostics ${"3".repeat(12)}`,
    );
    expect(artifactEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("projects artifact drift checks without paths or file contents", () => {
    const event = artifactEvent("artifact.drift_checked", {
      planId: "plan_1234567890",
      artifactId: "artifact_0987654321",
      planRevision: 6,
      status: "verified",
      kind: "file",
      result: "drifted",
      path: "TOP_SECRET_PATH",
      text: "TOP_SECRET_TEXT",
      pathSha256: "a".repeat(64),
      expectedSha256: "b".repeat(64),
      observedSha256: "c".repeat(64),
      sizeBytes: 256,
    });

    expect(artifactEventTraceView(event)).toEqual({
      action: "drift_checked",
      planId: "plan_1234567890",
      artifactId: "artifact_0987654321",
      planRevision: 6,
      status: "verified",
      kind: "file",
      result: "drifted",
      pathSha256: "a".repeat(64),
      expectedSha256: "b".repeat(64),
      observedSha256: "c".repeat(64),
      sizeBytes: 256,
    });
    expect(artifactEventTraceSummary(event)).toBe(
      `artifact / drift_checked / plan 1234567890 / artifact 0987654321 / plan-r6 / status verified / kind file / result drifted / size-bytes 256 / path ${"a".repeat(12)} / expected ${"b".repeat(12)} / observed ${"c".repeat(12)}`,
    );
    expect(artifactEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("projects directory manifests without entry paths", () => {
    const event = artifactEvent("artifact.directory_manifested", {
      planId: "plan_1234567890",
      artifactId: "artifact_0987654321",
      planRevision: 7,
      status: "verified",
      kind: "directory",
      path: "TOP_SECRET_PATH",
      entries: [{ path: "TOP_SECRET_ENTRY.md" }],
      pathSha256: "a".repeat(64),
      sha256: "b".repeat(64),
      sizeBytes: 512,
      entryCount: 3,
      fileCount: 2,
      directoryCount: 1,
    });

    expect(artifactEventTraceView(event)).toEqual({
      action: "directory_manifested",
      planId: "plan_1234567890",
      artifactId: "artifact_0987654321",
      planRevision: 7,
      status: "verified",
      kind: "directory",
      pathSha256: "a".repeat(64),
      sha256: "b".repeat(64),
      sizeBytes: 512,
      entryCount: 3,
      fileCount: 2,
      directoryCount: 1,
    });
    expect(artifactEventTraceSummary(event)).toBe(
      `artifact / directory_manifested / plan 1234567890 / artifact 0987654321 / plan-r7 / status verified / kind directory / size-bytes 512 / entries 3 / files 2 / directories 1 / path ${"a".repeat(12)} / artifact ${"b".repeat(12)}`,
    );
    expect(artifactEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("projects directory manifest verification receipts without entries or diagnostics", () => {
    const event = artifactEvent("artifact.directory_manifest_verified", {
      planId: "plan_1234567890",
      artifactId: "artifact_0987654321",
      planRevision: 8,
      status: "verified",
      kind: "directory",
      verificationStatus: "drifted",
      diagnostics: ["TOP_SECRET_DIAGNOSTIC"],
      entries: [{ path: "TOP_SECRET_ENTRY.md" }],
      pathSha256: "a".repeat(64),
      diagnosticsSha256: "b".repeat(64),
      declaredSha256: "c".repeat(64),
      recomputedDeclaredSha256: "d".repeat(64),
      observedSha256: "e".repeat(64),
      declaredSizeBytes: 512,
      observedSizeBytes: 768,
      declaredEntryCount: 3,
      observedEntryCount: 4,
      declaredFileCount: 2,
      observedFileCount: 3,
      declaredDirectoryCount: 1,
      observedDirectoryCount: 1,
      declaredEntrySetSha256: "f".repeat(64),
      observedEntrySetSha256: "0".repeat(64),
      diagnosticCount: 2,
    });

    expect(artifactEventTraceView(event)).toEqual({
      action: "directory_manifest_verified",
      planId: "plan_1234567890",
      artifactId: "artifact_0987654321",
      planRevision: 8,
      status: "verified",
      kind: "directory",
      verificationStatus: "drifted",
      pathSha256: "a".repeat(64),
      diagnosticsSha256: "b".repeat(64),
      declaredSha256: "c".repeat(64),
      recomputedDeclaredSha256: "d".repeat(64),
      observedSha256: "e".repeat(64),
      declaredSizeBytes: 512,
      observedSizeBytes: 768,
      declaredEntryCount: 3,
      observedEntryCount: 4,
      declaredFileCount: 2,
      observedFileCount: 3,
      declaredDirectoryCount: 1,
      observedDirectoryCount: 1,
      declaredEntrySetSha256: "f".repeat(64),
      observedEntrySetSha256: "0".repeat(64),
      diagnosticCount: 2,
    });
    expect(artifactEventTraceSummary(event)).toBe(
      `artifact / directory_manifest_verified / plan 1234567890 / artifact 0987654321 / plan-r8 / status verified / kind directory / verification drifted / size-bytes 512->768 / diagnostics 2 / entries 3->4 / files 2->3 / directories 1->1 / path ${"a".repeat(12)} / declared ${"c".repeat(12)} / declared-self ${"d".repeat(12)} / observed ${"e".repeat(12)} / declared-entries ${"f".repeat(12)} / observed-entries ${"0".repeat(12)} / diagnostics ${"b".repeat(12)}`,
    );
    expect(artifactEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("falls back for malformed artifact receipts", () => {
    expect(
      artifactEventTraceSummary(artifactEvent("artifact.future", {})),
    ).toBe("artifact");
    expect(
      artifactEventTraceSummary(artifactEvent("artifact.exported", [])),
    ).toBe("artifact receipt");
  });
});

function artifactEvent(type: string, payload: RunEvent["payload"]): RunEvent {
  return {
    id: "event_artifact_1234567890",
    threadId: "thread_1234567890",
    runId: "run_1234567890",
    seq: 1,
    type,
    category: "artifact",
    visibility: "user",
    createdAt: "2026-07-29T00:00:00.000Z",
    payload,
  };
}
