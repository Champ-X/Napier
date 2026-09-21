export function parseRanges(header, size, maxRanges = 16) {
  if (
    typeof size !== "bigint" ||
    size < 0n ||
    !Number.isSafeInteger(maxRanges) ||
    maxRanges <= 0
  )
    throw new TypeError("Invalid bounds");
  if (header == null) return null;
  if (typeof header !== "string") throw new TypeError("Invalid header");
  const trim = (x) => x.replace(/^[ \t]+|[ \t]+$/g, "");
  header = trim(header);
  if (!header.startsWith("bytes=")) return null;
  const parts = header.slice(6).split(",");
  if (parts.length > maxRanges) return null;
  const ranges = [];
  for (const raw of parts) {
    const item = trim(raw),
      m = /^([0-9]*)-([0-9]*)$/.exec(item);
    if (!m || m[0] !== item || (!m[1] && !m[2])) return null;
    if (m[1]) {
      const start = BigInt(m[1]),
        end = m[2] ? BigInt(m[2]) : size - 1n;
      if (m[2] && start > end) return null;
      if (size > 0n && start < size)
        ranges.push([start, end < size ? end : size - 1n]);
    } else {
      const suffix = BigInt(m[2]);
      if (size > 0n && suffix > 0n)
        ranges.push([suffix >= size ? 0n : size - suffix, size - 1n]);
    }
  }
  ranges.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const merged = [];
  for (const [start, end] of ranges) {
    const last = merged.at(-1);
    if (last && start <= last[1] + 1n) {
      if (end > last[1]) last[1] = end;
    } else merged.push([start, end]);
  }
  return merged;
}
