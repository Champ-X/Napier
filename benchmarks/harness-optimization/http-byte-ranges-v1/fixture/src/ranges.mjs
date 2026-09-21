export function parseRanges(header, size, maxRanges = 16) {
  if (!header) return null;
  return header
    .slice(6)
    .split(",")
    .map((item) => item.split("-").map((x) => BigInt(x || 0)));
}
