export function checkChunk(total, offset, bytes) {
  if (
    !Number.isSafeInteger(total) ||
    total <= 0 ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !(bytes instanceof Uint8Array) ||
    bytes.length === 0 ||
    offset > total - bytes.length
  )
    throw new TypeError("Invalid chunk");
}
