import { describe, expect, it } from "vitest";

import {
  appendComposerImageFiles,
  ComposerImageError,
  detectPromptImageMimeType,
  promptImagesFromAttachments,
} from "../src/composer-image-attachments";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("Composer image attachments", () => {
  it("detects supported images from their bytes instead of trusting filenames", () => {
    expect(detectPromptImageMimeType(PNG)).toBe("image/png");
    expect(
      detectPromptImageMimeType(
        new TextEncoder().encode("<svg><script /></svg>"),
      ),
    ).toBeUndefined();
  });

  it("encodes a selected image into the bounded prompt contract", async () => {
    const attachments = await appendComposerImageFiles(
      [],
      [new File([PNG], "screenshot.not-really-jpg", { type: "image/jpeg" })],
    );
    expect(attachments).toEqual([
      expect.objectContaining({
        name: "screenshot.not-really-jpg",
        size: PNG.byteLength,
        mimeType: "image/png",
        data: "iVBORw0KGgo=",
      }),
    ]);
    expect(promptImagesFromAttachments(attachments)).toEqual([
      { mimeType: "image/png", data: "iVBORw0KGgo=" },
    ]);
  });

  it("rejects unsupported files and a fifth attachment", async () => {
    await expect(
      appendComposerImageFiles(
        [],
        [new File(["plain text"], "fake.png", { type: "image/png" })],
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ComposerImageError>>({
        code: "unsupported",
      }),
    );
    const existing = Array.from({ length: 4 }, (_, index) => ({
      id: String(index),
      name: `${String(index)}.png`,
      size: PNG.byteLength,
      mimeType: "image/png" as const,
      data: "iVBORw0KGgo=",
    }));
    await expect(
      appendComposerImageFiles(existing, [new File([PNG], "fifth.png")]),
    ).rejects.toEqual(expect.objectContaining({ code: "too_many" }));
  });
});
