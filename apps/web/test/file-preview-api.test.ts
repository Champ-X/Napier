import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_TEXT_FILE_PREVIEW_BYTES,
  MAX_WORKSPACE_FILE_PREVIEW_BYTES,
} from "@napier/contracts/file-preview";
import { readFilePreviewResponse } from "../src/workspace-directory-api";
import {
  peekPlanArtifactFile,
  previewPlanArtifactFile,
} from "../src/artifact-file-api";

afterEach(() => vi.unstubAllGlobals());

const digest = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const filePath = "outputs/图表.png";
const binary = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff]);

function workspaceResponse(
  bytes: Uint8Array,
  type = "text/plain",
  overrides: Record<string, string> = {},
) {
  return new Response(new Uint8Array(bytes).buffer, {
    headers: {
      "Content-Type": type,
      "X-Napier-Content-SHA256": digest(bytes),
      "X-Napier-Workspace-File-Size-Bytes": String(bytes.byteLength),
      ...overrides,
    },
  });
}

function artifactResponse(
  overrides: Record<string, string> = {},
  peek = false,
) {
  return new Response(binary, {
    headers: {
      "Content-Type": "image/png",
      "X-Napier-Content-SHA256": digest(binary),
      "X-Napier-Thread-Id": "thread_1",
      "X-Napier-Plan-Id": "plan_1",
      "X-Napier-Plan-Revision": "1",
      "X-Napier-Plan-Artifact-Id": "artifact_1",
      "X-Napier-Plan-Artifact-Kind": "file",
      "X-Napier-Plan-Artifact-Status": "verified",
      "X-Napier-Plan-Artifact-Path": encodeURIComponent(filePath),
      "X-Napier-Plan-Artifact-Path-SHA256": digest(filePath),
      "X-Napier-Plan-Artifact-SHA256": digest(binary),
      "X-Napier-Plan-Artifact-Size-Bytes": String(binary.byteLength),
      ...(peek
        ? { "X-Napier-Read-Mode": "peek" }
        : {
            "X-Napier-Ledger-Event-Id": "event_abc123",
            "X-Napier-Ledger-Event-Seq": "1",
            "X-Napier-Ledger-Event-SHA256": "a".repeat(64),
          }),
      ...overrides,
    },
  });
}

describe("verified file preview decoding", () => {
  it("decodes UTF-16 BOM text while preserving exact bytes and digest for download", async () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x2d, 0x4e, 0x87, 0x65]);
    const preview = await readFilePreviewResponse(
      workspaceResponse(bytes),
      "/fixture",
      "note.txt",
    );
    expect(preview.text).toBe("中文");
    expect(new Uint8Array(await preview.blob.arrayBuffer())).toEqual(bytes);
    expect(preview.sha256).toBe(digest(bytes));
  });

  it("reports invalid text encoding while retaining the original download", async () => {
    const bytes = new Uint8Array([0xc3, 0x28]);
    const preview = await readFilePreviewResponse(
      workspaceResponse(bytes),
      "/fixture",
      "note.txt",
    );
    expect(preview.text).toBeUndefined();
    expect(preview.textError).toMatch(/UTF-8/);
    expect(preview.blob.size).toBe(2);
  });

  it("bounds large text decoding without rejecting a split final UTF-8 character", async () => {
    const bytes = new TextEncoder().encode(
      "a".repeat(MAX_TEXT_FILE_PREVIEW_BYTES - 1) + "中文",
    );
    const preview = await readFilePreviewResponse(
      workspaceResponse(bytes),
      "/fixture",
      "large.txt",
    );
    expect(preview.text).toBe("a".repeat(MAX_TEXT_FILE_PREVIEW_BYTES - 1));
    expect(preview.textTruncated).toBe(true);
    expect(preview.textError).toBeUndefined();
    expect(preview.blob.size).toBe(bytes.byteLength);
  });

  it("rejects oversized or mismatching bytes before displaying them", async () => {
    await expect(
      readFilePreviewResponse(
        workspaceResponse(binary, "image/png", {
          "X-Napier-Workspace-File-Size-Bytes": String(
            MAX_WORKSPACE_FILE_PREVIEW_BYTES + 1,
          ),
        }),
        "/fixture",
        "large.png",
      ),
    ).rejects.toThrow("preview limit");
    await expect(
      readFilePreviewResponse(
        workspaceResponse(binary, "image/png", {
          "X-Napier-Content-SHA256": "0".repeat(64),
        }),
        "/fixture",
        "image.png",
      ),
    ).rejects.toThrow("hash mismatch");
  });

  it("loads binary artifact bytes with identity and ledger evidence", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => artifactResponse()),
    );
    const preview = await previewPlanArtifactFile(
      "thread_1",
      "plan_1",
      "artifact_1",
    );
    expect(preview.path).toBe(filePath);
    expect(preview.contentType).toBe("image/png");
    expect(preview.text).toBeUndefined();
    expect(preview.ledgerEventId).toBe("event_abc123");
    expect(new Uint8Array(await preview.blob.arrayBuffer())).toEqual(binary);
  });

  it.each([
    { "X-Napier-Plan-Artifact-Id": "artifact_other" },
    { "X-Napier-Thread-Id": "thread_other" },
    { "X-Napier-Plan-Artifact-Path": encodeURIComponent("other.png") },
    { "X-Napier-Content-SHA256": "0".repeat(64) },
    { "X-Napier-Plan-Artifact-Size-Bytes": "20" },
    { "X-Napier-Ledger-Event-SHA256": "invalid" },
  ])(
    "rejects corrupted artifact identity, bytes or evidence: %j",
    async (headers) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => artifactResponse(headers)),
      );
      await expect(
        previewPlanArtifactFile("thread_1", "plan_1", "artifact_1"),
      ).rejects.toThrow();
    },
  );

  it("uses explicit readonly file peek without requiring a ledger event", async () => {
    const fetch = vi.fn(async () => artifactResponse({}, true));
    vi.stubGlobal("fetch", fetch);
    const preview = await peekPlanArtifactFile(
      "thread_1",
      "plan_1",
      "artifact_1",
    );
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/preview-file\/peek$/),
    );
    expect(preview).not.toHaveProperty("ledgerEventId");
    expect(preview.sha256).toBe(digest(binary));
  });
});
