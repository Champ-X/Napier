import type { PromptImageInput, PromptImageMimeType } from "@napier/contracts";

export const MAX_PROMPT_IMAGES = 4;
export const MAX_PROMPT_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_PROMPT_IMAGE_TOTAL_BYTES = 16 * 1024 * 1024;
export const MAX_PROMPT_REQUEST_BYTES = 24 * 1024 * 1024;

const SUPPORTED_MIME_TYPES = new Set<PromptImageMimeType>([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);
const BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

export function parsePromptImages(
  input: unknown,
): PromptImageInput[] | undefined {
  if (
    !Array.isArray(input) ||
    input.length < 1 ||
    input.length > MAX_PROMPT_IMAGES
  ) {
    return undefined;
  }
  const images: PromptImageInput[] = [];
  let totalBytes = 0;
  for (const candidate of input) {
    const image = parsePromptImage(candidate);
    if (!image) return undefined;
    const bytes = Buffer.from(image.data, "base64").byteLength;
    totalBytes += bytes;
    if (totalBytes > MAX_PROMPT_IMAGE_TOTAL_BYTES) return undefined;
    images.push(image);
  }
  return images;
}

function parsePromptImage(input: unknown): PromptImageInput | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const record = input as Record<string, unknown>;
  if (
    Object.keys(record).some((key) => key !== "data" && key !== "mimeType") ||
    typeof record["data"] !== "string" ||
    typeof record["mimeType"] !== "string" ||
    !SUPPORTED_MIME_TYPES.has(record["mimeType"] as PromptImageMimeType) ||
    !BASE64.test(record["data"])
  ) {
    return undefined;
  }
  const bytes = Buffer.from(record["data"], "base64");
  if (
    bytes.byteLength < 1 ||
    bytes.byteLength > MAX_PROMPT_IMAGE_BYTES ||
    bytes.toString("base64") !== record["data"] ||
    detectImageMimeType(bytes) !== record["mimeType"]
  ) {
    return undefined;
  }
  return {
    data: record["data"],
    mimeType: record["mimeType"] as PromptImageMimeType,
  };
}

function detectImageMimeType(bytes: Buffer): PromptImageMimeType | undefined {
  if (
    bytes.length >= 8 &&
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  const prefix = bytes.subarray(0, 6).toString("ascii");
  if (prefix === "GIF87a" || prefix === "GIF89a") return "image/gif";
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return undefined;
}
