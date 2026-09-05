export interface WebFetchImageType {
  kind: "avif" | "bmp" | "gif" | "ico" | "jpeg" | "png" | "webp";
  mime: string;
  extensions: readonly string[];
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_END = [
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
];

export function detectWebFetchImage(
  body: Buffer,
): WebFetchImageType | undefined {
  if (hasPrefix(body, PNG_SIGNATURE) && hasSuffix(body, PNG_END)) {
    return { kind: "png", mime: "image/png", extensions: [".png"] };
  }
  if (hasPrefix(body, [0xff, 0xd8, 0xff]) && hasSuffix(body, [0xff, 0xd9])) {
    return {
      kind: "jpeg",
      mime: "image/jpeg",
      extensions: [".jpg", ".jpeg"],
    };
  }
  const header = body.subarray(0, 12).toString("ascii");
  if (
    (header.startsWith("GIF87a") || header.startsWith("GIF89a")) &&
    body.at(-1) === 0x3b
  ) {
    return { kind: "gif", mime: "image/gif", extensions: [".gif"] };
  }
  if (validWebp(body, header)) {
    return { kind: "webp", mime: "image/webp", extensions: [".webp"] };
  }
  if (validBmp(body)) {
    return { kind: "bmp", mime: "image/bmp", extensions: [".bmp"] };
  }
  if (validIco(body)) {
    return {
      kind: "ico",
      mime: "image/x-icon",
      extensions: [".ico"],
    };
  }
  if (validAvif(body)) {
    return { kind: "avif", mime: "image/avif", extensions: [".avif"] };
  }
  return undefined;
}

function validWebp(body: Buffer, header: string): boolean {
  return (
    body.length >= 20 &&
    header.startsWith("RIFF") &&
    header.slice(8, 12) === "WEBP" &&
    body.readUInt32LE(4) + 8 === body.length
  );
}

function validBmp(body: Buffer): boolean {
  if (body.length < 26 || !hasPrefix(body, [0x42, 0x4d])) return false;
  const declaredBytes = body.readUInt32LE(2);
  const pixelOffset = body.readUInt32LE(10);
  const dibBytes = body.readUInt32LE(14);
  return (
    declaredBytes === body.length &&
    pixelOffset >= 18 &&
    pixelOffset < body.length &&
    dibBytes >= 12 &&
    dibBytes <= body.length - 14
  );
}

function validIco(body: Buffer): boolean {
  if (body.length < 22 || !hasPrefix(body, [0x00, 0x00, 0x01, 0x00])) {
    return false;
  }
  const count = body.readUInt16LE(4);
  const directoryBytes = 6 + count * 16;
  if (count === 0 || directoryBytes > body.length) return false;
  for (let index = 0; index < count; index += 1) {
    const entry = 6 + index * 16;
    const imageBytes = body.readUInt32LE(entry + 8);
    const imageOffset = body.readUInt32LE(entry + 12);
    if (
      imageBytes === 0 ||
      imageOffset < directoryBytes ||
      imageOffset + imageBytes > body.length
    ) {
      return false;
    }
  }
  return true;
}

function validAvif(body: Buffer): boolean {
  if (body.length < 24 || body.subarray(4, 8).toString("ascii") !== "ftyp") {
    return false;
  }
  const boxBytes = body.readUInt32BE(0);
  if (boxBytes !== 0 && (boxBytes < 16 || boxBytes > body.length)) return false;
  for (let offset = 8; offset + 4 <= Math.min(body.length, 64); offset += 4) {
    const brand = body.subarray(offset, offset + 4).toString("ascii");
    if (brand === "avif" || brand === "avis") return true;
  }
  return false;
}

function hasPrefix(body: Buffer, bytes: readonly number[]): boolean {
  return (
    body.length >= bytes.length &&
    bytes.every((byte, index) => body[index] === byte)
  );
}

function hasSuffix(body: Buffer, bytes: readonly number[]): boolean {
  const offset = body.length - bytes.length;
  return (
    offset >= 0 && bytes.every((byte, index) => body[offset + index] === byte)
  );
}
