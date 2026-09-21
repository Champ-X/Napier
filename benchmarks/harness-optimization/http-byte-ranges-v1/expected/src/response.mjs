import { parseRanges } from "./ranges.mjs";
export function rangeResponse(header, size, maxRanges = 16) {
  const ranges = parseRanges(header, size, maxRanges);
  if (ranges === null) return { status: 200, ranges, contentRange: null };
  if (!ranges.length)
    return { status: 416, ranges, contentRange: `bytes */${size}` };
  return {
    status: 206,
    ranges,
    contentRange:
      ranges.length === 1
        ? `bytes ${ranges[0][0]}-${ranges[0][1]}/${size}`
        : null,
  };
}
