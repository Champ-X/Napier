const alphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export function decodeVlq(text) {
  if (typeof text !== "string") throw new TypeError("Invalid VLQ");
  const out = [];
  let value = 0n,
    shift = 0n,
    digits = 0;
  for (const char of text) {
    const digit = alphabet.indexOf(char);
    if (digit < 0) throw new TypeError("Invalid digit");
    const payload = digit & 31;
    value |= BigInt(payload) << shift;
    digits++;
    if (value > 4294967295n || digits > 7) throw new TypeError("VLQ overflow");
    if (digit & 32) {
      shift += 5n;
      continue;
    }
    if (digits > 1 && payload === 0) throw new TypeError("Noncanonical VLQ");
    if (value === 1n) throw new TypeError("Negative zero");
    const magnitude = Number(value >> 1n);
    out.push(value & 1n ? -magnitude : magnitude);
    value = 0n;
    shift = 0n;
    digits = 0;
  }
  if (digits) throw new TypeError("Truncated VLQ");
  return out;
}
