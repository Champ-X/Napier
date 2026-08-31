import type { PromptImageInput, PromptImageMimeType } from "@napier/contracts";

export const MAX_COMPOSER_IMAGES = 4;
export const MAX_COMPOSER_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_COMPOSER_IMAGE_TOTAL_BYTES = 16 * 1024 * 1024;

export type ComposerImageErrorCode =
  | "unsupported"
  | "too_many"
  | "too_large"
  | "total_too_large";

export class ComposerImageError extends Error {
  constructor(readonly code: ComposerImageErrorCode) {
    super(code);
  }
}

export interface ComposerImageAttachment extends PromptImageInput {
  id: string;
  name: string;
  size: number;
}

export async function appendComposerImageFiles(
  current: readonly ComposerImageAttachment[],
  files: Iterable<File>,
): Promise<ComposerImageAttachment[]> {
  const incoming = [...files];
  if (current.length + incoming.length > MAX_COMPOSER_IMAGES) {
    throw new ComposerImageError("too_many");
  }
  const attachments: ComposerImageAttachment[] = [];
  let totalBytes = current.reduce((total, image) => total + image.size, 0);
  for (const file of incoming) {
    if (file.size > MAX_COMPOSER_IMAGE_BYTES) {
      throw new ComposerImageError("too_large");
    }
    totalBytes += file.size;
    if (totalBytes > MAX_COMPOSER_IMAGE_TOTAL_BYTES) {
      throw new ComposerImageError("total_too_large");
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mimeType = detectPromptImageMimeType(bytes);
    if (!mimeType) throw new ComposerImageError("unsupported");
    attachments.push({
      id: crypto.randomUUID(),
      name: file.name,
      size: bytes.byteLength,
      mimeType,
      data: bytesToBase64(bytes),
    });
  }
  return [...current, ...attachments];
}

export function promptImagesFromAttachments(
  attachments: readonly ComposerImageAttachment[],
): PromptImageInput[] | undefined {
  return attachments.length
    ? attachments.map(({ data, mimeType }) => ({ data, mimeType }))
    : undefined;
}

export function composerImageDataUrl(
  attachment: Pick<ComposerImageAttachment, "data" | "mimeType">,
): string {
  return `data:${attachment.mimeType};base64,${attachment.data}`;
}

export function detectPromptImageMimeType(
  bytes: Uint8Array,
): PromptImageMimeType | undefined {
  if (matches(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (matches(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  const prefix = ascii(bytes, 0, 6);
  if (prefix === "GIF87a" || prefix === "GIF89a") return "image/gif";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") {
    return "image/webp";
  }
  return undefined;
}

function matches(bytes: Uint8Array, signature: readonly number[]): boolean {
  return (
    bytes.length >= signature.length &&
    signature.every((value, index) => bytes[index] === value)
  );
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  if (bytes.length < end) return "";
  return String.fromCharCode(...bytes.subarray(start, end));
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    chunks.push(
      String.fromCharCode(...bytes.subarray(offset, offset + 32_768)),
    );
  }
  return btoa(chunks.join(""));
}
