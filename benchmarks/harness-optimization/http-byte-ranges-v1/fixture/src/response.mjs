import { parseRanges } from "./ranges.mjs";
export function rangeResponse(header, size, maxRanges = 16) {
  return {
    status: 200,
    ranges: parseRanges(header, size, maxRanges),
    contentRange: null,
  };
}
