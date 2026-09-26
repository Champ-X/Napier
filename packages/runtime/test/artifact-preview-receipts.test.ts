import { describe, expect, it } from "vitest";

import { assertArtifactReceiptEventBoundary } from "../src/artifact-receipts.js";

const identity = {
  planId: "plan_preview",
  artifactId: "image",
  planRevision: 1,
  status: "produced",
  kind: "file",
  pathSha256: "a".repeat(64),
  sha256: "b".repeat(64),
  sizeBytes: 42,
};
const filePreview = {
  ...identity,
  previewKind: "file",
  contentType: "image/png",
};
const textPreview = { ...identity, lineCount: 2, textSha256: "c".repeat(64) };
function validate(payload: Record<string, unknown>) {
  assertArtifactReceiptEventBoundary(
    { type: "artifact.previewed", category: "artifact", payload },
    "Preview",
  );
}

describe("artifact preview receipt variants", () => {
  it("accepts file previews and preserves the legacy text receipt contract", () => {
    expect(() => validate(filePreview)).not.toThrow();
    expect(() =>
      validate({
        ...filePreview,
        contentType: "application/x-ndjson; charset=utf-8",
      }),
    ).not.toThrow();
    expect(() => validate(textPreview)).not.toThrow();
  });

  it.each([
    { ...filePreview, contentType: undefined },
    { ...filePreview, contentType: "image/png\nprivate bytes" },
    { ...filePreview, contentType: "image/png; arbitrary=private" },
    { ...filePreview, contentType: "text/" + "x".repeat(65) },
    { ...filePreview, previewKind: "arbitrary" },
    { ...filePreview, kind: "directory" },
    { ...filePreview, status: "expected" },
    { ...filePreview, sha256: "not-a-digest" },
    { ...filePreview, sizeBytes: -1 },
    { ...filePreview, text: "PRIVATE_FILE_CONTENTS" },
    { ...filePreview, lineCount: 2, textSha256: "c".repeat(64) },
    { ...textPreview, lineCount: undefined },
    { ...textPreview, textSha256: undefined },
    { ...textPreview, contentType: "text/plain" },
  ])("rejects malformed or mixed receipt variants %#", (payload) => {
    expect(() => validate(payload)).toThrow(
      "hash-only artifact receipt is invalid",
    );
  });
});
