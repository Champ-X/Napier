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

  it("falls back for malformed artifact receipts", () => {
    expect(artifactEventTraceSummary(artifactEvent("artifact.future", {}))).toBe(
      "artifact",
    );
    expect(artifactEventTraceSummary(artifactEvent("artifact.exported", []))).toBe(
      "artifact receipt",
    );
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
