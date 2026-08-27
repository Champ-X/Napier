import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  validateApplyContextCompactionForkRequest,
  validateContextCompactionForkResult,
  validateContextCompactionPreview,
  validatePreviewContextCompactionRequest,
} from "../src/context-compaction-v1.js";
import { canonical } from "../src/skill-load-validation.js";

describe("context compaction contract", () => {
  it("validates bounded requests", () => {
    expect(
      validatePreviewContextCompactionRequest({
        retainedMessageCount: 10,
        model: { provider: "openai", id: "gpt-5.2" },
      }),
    ).toEqual({
      retainedMessageCount: 10,
      model: { provider: "openai", id: "gpt-5.2" },
    });
    expect(
      validateApplyContextCompactionForkRequest({
        expectedPreviewSha256: "a".repeat(64),
        title: "  Compacted   fork  ",
      }),
    ).toEqual({
      expectedPreviewSha256: "a".repeat(64),
      title: "Compacted fork",
    });
  });

  it("binds preview content and rejects extra fields", () => {
    const preview = previewFixture();
    expect(validateContextCompactionPreview(preview)).toEqual(preview);
    expect(() =>
      validateContextCompactionPreview({ ...preview, injected: true }),
    ).toThrow("object shape");
    expect(() =>
      validateContextCompactionPreview({ ...preview, summary: "drifted" }),
    ).toThrow("hash is invalid");
  });

  it("validates the continuity-bound fork checkpoint", () => {
    const result = forkFixture();
    expect(validateContextCompactionForkResult(result)).toEqual(result);
    expect(() =>
      validateContextCompactionForkResult({
        ...result,
        targetThreadId: result.sourceThreadId,
      }),
    ).toThrow("fork result is invalid");
    expect(() =>
      validateContextCompactionForkResult({
        ...result,
        checkpoint: { ...result.checkpoint, sourceEventCount: 0 },
      }),
    ).toThrow("checkpoint is invalid");
  });
});

function previewFixture() {
  const content = {
    kind: "napier.context-compaction-preview" as const,
    schemaVersion: 1 as const,
    previewRunId: "run_preview_12345678",
    sourceThreadId: "thread_source12345678",
    sourceEventCount: 24,
    sourceEventSetSha256: "1".repeat(64),
    fromSeq: 2,
    toSeq: 12,
    retainedFromSeq: 14,
    sourceMessageCount: 8,
    sourceMessageSha256: "2".repeat(64),
    continuityEventCount: 2,
    continuitySha256: "3".repeat(64),
    retainedMessageCount: 4,
    model: { provider: "openai", id: "gpt-5.2" },
    summary: "The task is ready for validation.",
    decisions: ["Keep the source Ledger immutable."],
    openLoops: ["Run browser QA."],
    artifacts: ["apps/web/src/App.tsx"],
  };
  return { ...content, previewSha256: sha256(canonical(content)) };
}

function forkFixture() {
  const checkpointContent = {
    summary: "The task is ready for validation.",
    decisions: ["Keep the source Ledger immutable."],
    openLoops: ["Run browser QA."],
    artifacts: ["apps/web/src/App.tsx"],
  };
  return {
    kind: "napier.context-compaction-fork-result" as const,
    schemaVersion: 1 as const,
    sourceThreadId: "thread_source12345678",
    targetThreadId: "thread_target12345678",
    previewSha256: "4".repeat(64),
    checkpoint: {
      schemaVersion: 1 as const,
      checkpointId: "checkpoint_12345678",
      fromSeq: 2,
      toSeq: 9,
      retainedFromSeq: 11,
      sourceEventCount: 8,
      sourceSha256: "5".repeat(64),
      summarySha256: sha256(JSON.stringify(checkpointContent)),
      continuityProjectionVersion: 1 as const,
      continuityEventCount: 2,
      continuitySha256: "6".repeat(64),
      ...checkpointContent,
    },
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
