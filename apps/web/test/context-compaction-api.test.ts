import { createHash } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyContextCompactionFork,
  previewContextCompaction,
} from "../src/context-compaction-api";
import { canonicalJson } from "../src/stable-digest";

afterEach(() => vi.unstubAllGlobals());

describe("context compaction Web API", () => {
  it("accepts a hash-bound no-store preview", async () => {
    const preview = previewFixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response(preview, preview.previewSha256)),
    );

    await expect(
      previewContextCompaction(preview.sourceThreadId, {
        retainedMessageCount: preview.retainedMessageCount,
        model: preview.model,
      }),
    ).resolves.toEqual(preview);
  });

  it("rejects a preview without no-store semantics", async () => {
    const preview = previewFixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response(preview, preview.previewSha256, false)),
    );

    await expect(
      previewContextCompaction(preview.sourceThreadId, {
        retainedMessageCount: preview.retainedMessageCount,
        model: preview.model,
      }),
    ).rejects.toThrow("preview binding is invalid");
  });

  it("accepts a fork only when preview and checkpoint hashes bind", async () => {
    const result = forkFixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response(result, result.previewSha256)),
    );

    await expect(
      applyContextCompactionFork(result.sourceThreadId, {
        expectedPreviewSha256: result.previewSha256,
      }),
    ).resolves.toEqual(result);
  });

  it("rejects a fork with a mismatched summary hash", async () => {
    const result = forkFixture();
    const drifted = {
      ...result,
      checkpoint: { ...result.checkpoint, summarySha256: "f".repeat(64) },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response(drifted, result.previewSha256)),
    );

    await expect(
      applyContextCompactionFork(result.sourceThreadId, {
        expectedPreviewSha256: result.previewSha256,
      }),
    ).rejects.toThrow("fork response is invalid");
  });
});

function response(
  value: unknown,
  previewSha256: string,
  noStore = true,
): Response {
  const text = JSON.stringify(value);
  return new Response(text, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      ...(noStore ? { "Cache-Control": "no-store" } : {}),
      "X-Napier-Content-SHA256": sha256(text),
      "X-Napier-Content-SHA256-Mode": "body",
      "X-Napier-Context-Compaction-Preview-SHA256": previewSha256,
    },
  });
}

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
  return { ...content, previewSha256: sha256(canonicalJson(content)) };
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
