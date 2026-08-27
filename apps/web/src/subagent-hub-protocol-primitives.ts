const RESOURCE_ID = /^[a-z][a-z0-9_]{2,80}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

export function exactKeys(
  value: Record<string, unknown>,
  allowed: string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
export function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
export function resourceId(value: unknown): value is string {
  return typeof value === "string" && RESOURCE_ID.test(value);
}
export function optionalResourceId(value: unknown): boolean {
  return value === undefined || resourceId(value);
}
export function hash(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}
export function optionalHash(value: unknown): boolean {
  return value === undefined || hash(value);
}
export function boundedText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}
export function optionalText(value: unknown, max: number): boolean {
  return value === undefined || boundedText(value, max);
}
export function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
export function positiveInteger(value: unknown): value is number {
  return nonNegativeInteger(value) && value >= 1;
}
export function optionalNonNegativeInteger(value: unknown): boolean {
  return value === undefined || nonNegativeInteger(value);
}
export function timestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
export function optionalTimestamp(value: unknown): boolean {
  return value === undefined || timestamp(value);
}
export function jsonValue(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(jsonValue);
  return record(value) && Object.values(value).every(jsonValue);
}
