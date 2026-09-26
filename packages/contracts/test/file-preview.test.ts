import { describe, expect, it } from "vitest";
import {
  decodeFilePreviewText,
  filePreviewContentType,
  isTextPreviewContentType,
} from "../src/file-preview.js";

describe("file preview format contract", () => {
  it.each([
    "markdown",
    "jsonl",
    "ndjson",
    "tsv",
    "py",
    "go",
    "sh",
    "tsx",
    "svg",
  ])("recognizes %s in either file preview path", (extension) => {
    expect(
      isTextPreviewContentType(
        filePreviewContentType(
          `folder.with.dots/file.${extension.toUpperCase()}`,
        ),
      ),
    ).toBe(true);
  });
  it("keeps binary and unknown types out of the text decoder", () => {
    for (const name of [
      "image.PNG",
      "file.pdf",
      "archive.zip",
      "file",
      "dir.md/file",
    ]) {
      expect(isTextPreviewContentType(filePreviewContentType(name))).toBe(
        false,
      );
    }
  });
  it.each(["constructor", "CONSTRUCTOR", "__proto__", "toString"])(
    "treats prototype-like extension %s as an unknown binary format",
    (extension) => {
      const contentType = filePreviewContentType(`file.${extension}`);
      expect(contentType).toBe("application/octet-stream");
      expect(isTextPreviewContentType(contentType)).toBe(false);
    },
  );
  it("decodes UTF-8 and BOM-marked UTF-16 without changing content", () => {
    expect(decodeFilePreviewText(new TextEncoder().encode("\ufeff中文"))).toBe(
      "中文",
    );
    expect(
      decodeFilePreviewText(
        new Uint8Array([0xff, 0xfe, 0x2d, 0x4e, 0x87, 0x65]),
      ),
    ).toBe("中文");
    expect(
      decodeFilePreviewText(
        new Uint8Array([0xfe, 0xff, 0x4e, 0x2d, 0x65, 0x87]),
      ),
    ).toBe("中文");
  });
  it("rejects malformed encodings and binary NUL without silent replacement", () => {
    for (const bytes of [
      [0xc3, 0x28],
      [0xff, 0xfe, 0x2d],
      [0x61, 0],
    ]) {
      expect(() => decodeFilePreviewText(new Uint8Array(bytes))).toThrow(
        "valid UTF-8 or BOM-marked UTF-16",
      );
    }
  });
});
