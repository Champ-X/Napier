const valid = (x) => typeof x === "number" && Number.isFinite(x) && x >= 0;
export function validateTime(now, lastNow) {
  if (!valid(now) || !valid(lastNow) || now < lastNow)
    throw new TypeError("Invalid logical time");
  return now;
}
export function deadline(now, ttlMs) {
  if (!valid(now) || !valid(ttlMs) || !Number.isFinite(now + ttlMs))
    throw new TypeError("Invalid expiration");
  return now + ttlMs;
}
