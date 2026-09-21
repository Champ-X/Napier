export function checksum(bytes) {
  return bytes.reduce((a, b) => a + b, 0);
}
