export function validateTime(now, lastNow) {
  return Number(now);
}
export function deadline(now, ttlMs) {
  return now + ttlMs;
}
