import { createHash } from "node:crypto";
import { mkdir, mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ExecutionPlan } from "@napier/contracts";
import { MAX_TEXT_FILE_PREVIEW_BYTES } from "@napier/contracts/file-preview";
import { afterEach, describe, expect, it } from "vitest";

import {
  exportWorkspaceFileArtifact,
  previewWorkspaceTextArtifact,
} from "../src/plan-tools.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function artifact(): ExecutionPlan["artifacts"][number] {
  return {
    id: "text",
    path: "text.txt",
    kind: "file",
    description: "Text preview fixture",
    status: "produced",
    evidence: "Fixture written to workspace",
    createdAt: "2026-09-26T00:00:00.000Z",
    updatedAt: "2026-09-26T00:00:00.000Z",
  };
}

async function fixture(contents: Uint8Array): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-text-preview-"));
  roots.push(root);
  await writeFile(path.join(root, "text.txt"), contents);
  return root;
}

describe("plan artifact text decoding", () => {
  it("previews only bounded valid text workspace file artifacts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-plan-tools-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(path.join(workspaceRoot, "artifacts"), { recursive: true });
    const contents = "line one\nline two\n";
    await writeFile(
      path.join(workspaceRoot, "artifacts", "preview.txt"),
      contents,
      "utf8",
    );
    const preview = await previewWorkspaceTextArtifact(workspaceRoot, {
      id: "preview",
      path: "artifacts/preview.txt",
      kind: "file",
      description: "Preview file.",
      status: "produced",
      evidence: "The file was produced.",
      createdAt: "2026-07-27T00:00:00.000Z",
      updatedAt: "2026-07-27T00:00:00.000Z",
    });
    expect(preview).toEqual({
      text: contents,
      sha256: createHash("sha256").update(contents).digest("hex"),
      sizeBytes: Buffer.byteLength(contents),
      lineCount: 3,
    });

    await writeFile(
      path.join(workspaceRoot, "artifacts", "binary.bin"),
      Buffer.from([0xff, 0xfe, 0xfd]),
    );
    await expect(
      previewWorkspaceTextArtifact(workspaceRoot, {
        id: "binary",
        path: "artifacts/binary.bin",
        kind: "file",
        description: "Binary file.",
        status: "produced",
        evidence: "The binary file was produced.",
        createdAt: "2026-07-27T00:00:00.000Z",
        updatedAt: "2026-07-27T00:00:00.000Z",
      }),
    ).rejects.toThrow("valid UTF-8 or BOM-marked UTF-16 text");

    const largeContents = "x".repeat(MAX_TEXT_FILE_PREVIEW_BYTES + 1);
    await writeFile(
      path.join(workspaceRoot, "artifacts", "large.txt"),
      largeContents,
      "utf8",
    );
    await expect(
      previewWorkspaceTextArtifact(workspaceRoot, {
        id: "large",
        path: "artifacts/large.txt",
        kind: "file",
        description: "Large file.",
        status: "produced",
        evidence: "The large file was produced.",
        createdAt: "2026-07-27T00:00:00.000Z",
        updatedAt: "2026-07-27T00:00:00.000Z",
      }),
    ).rejects.toThrow("Artifact preview exceeds");

    await writeFile(
      path.join(workspaceRoot, "artifacts", "preview.txt"),
      "drifted\n",
      "utf8",
    );
    await expect(
      previewWorkspaceTextArtifact(workspaceRoot, {
        id: "preview",
        path: "artifacts/preview.txt",
        kind: "file",
        description: "Verified preview file.",
        status: "verified",
        evidence: "The file was verified.",
        sha256: createHash("sha256").update(contents).digest("hex"),
        sizeBytes: Buffer.byteLength(contents),
        createdAt: "2026-07-27T00:00:00.000Z",
        updatedAt: "2026-07-27T00:00:00.000Z",
      }),
    ).rejects.toThrow("Verified artifact digest drifted");
  });

  it("preserves the runtime file export default when callers do not opt into a larger limit", async () => {
    const root = await fixture(Buffer.from("file"));
    const file = await open(path.join(root, "text.txt"), "r+");
    try {
      await file.truncate(32 * 1024 * 1024 + 1);
    } finally {
      await file.close();
    }
    await expect(exportWorkspaceFileArtifact(root, artifact())).rejects.toThrow(
      "32 MiB file limit",
    );
  });

  it.each([
    [
      "UTF-8 BOM",
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("中文\n")]),
    ],
    [
      "UTF-16 LE BOM",
      Buffer.concat([
        Buffer.from([0xff, 0xfe]),
        Buffer.from("中文\n", "utf16le"),
      ]),
    ],
    [
      "UTF-16 BE BOM",
      Buffer.concat([
        Buffer.from([0xfe, 0xff]),
        Buffer.from("中文\n", "utf16le").swap16(),
      ]),
    ],
  ])(
    "decodes %s while keeping evidence bound to the original bytes",
    async (_name, bytes) => {
      const root = await fixture(bytes);
      const preview = await previewWorkspaceTextArtifact(root, artifact());
      expect(preview).toEqual({
        text: "中文\n",
        lineCount: 2,
        sizeBytes: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    },
  );

  it.each([
    ["invalid UTF-8", Buffer.from([0x61, 0xc3, 0x28])],
    ["unmarked UTF-16", Buffer.from("hello", "utf16le")],
    ["odd UTF-16 length", Buffer.from([0xff, 0xfe, 0x41])],
  ])(
    "rejects %s without replacing bytes with silent corruption",
    async (_name, bytes) => {
      const root = await fixture(bytes);
      await expect(
        previewWorkspaceTextArtifact(root, artifact()),
      ).rejects.toThrow("valid UTF-8 or BOM-marked UTF-16 text");
    },
  );

  it("previews text above the old 64 KiB cap through the new limit", async () => {
    const bytes = Buffer.alloc(MAX_TEXT_FILE_PREVIEW_BYTES, "a");
    const root = await fixture(bytes);
    const preview = await previewWorkspaceTextArtifact(root, artifact());
    expect(preview.text.length).toBe(MAX_TEXT_FILE_PREVIEW_BYTES);
    expect(preview.sizeBytes).toBe(MAX_TEXT_FILE_PREVIEW_BYTES);
  });
});
