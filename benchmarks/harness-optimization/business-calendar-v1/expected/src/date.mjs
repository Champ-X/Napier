const day = 86400000;
export function parseDate(text) {
  if (
    typeof text !== "string" ||
    !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(text) ||
    text.length !== 10
  )
    throw new TypeError("Invalid date");
  const [year, month, date] = text.split("-").map(Number);
  if (year < 1 || year > 9999) throw new TypeError("Invalid year");
  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, date);
  d.setUTCHours(0, 0, 0, 0);
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== date
  )
    throw new TypeError("Impossible date");
  return d.getTime();
}
export function formatDate(ms) {
  if (
    typeof ms !== "number" ||
    !Number.isFinite(ms) ||
    !Number.isInteger(ms) ||
    ms % day !== 0
  )
    throw new TypeError("Invalid timestamp");
  const d = new Date(ms);
  if (
    !Number.isFinite(d.getTime()) ||
    d.getUTCFullYear() < 1 ||
    d.getUTCFullYear() > 9999
  )
    throw new TypeError("Out of range");
  return d.toISOString().slice(0, 10);
}
