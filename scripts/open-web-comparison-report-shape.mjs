import { canonicalJson } from "../packages/runtime/dist/index.js";

export function openWebComparisonDigest(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

export function openWebComparisonExactKeys(value, keys) {
  return (
    canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort())
  );
}

export function openWebComparisonIsoDate(value) {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

export function openWebComparisonNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function openWebComparisonNonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function openWebComparisonRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function openWebComparisonSafeText(value, minimum, maximum) {
  return (
    typeof value === "string" &&
    value.length >= minimum &&
    value.length <= maximum &&
    !/[\u0000-\u001f\u007f-\u009f]/u.test(value)
  );
}

export function openWebComparisonSemanticVersion(value) {
  return typeof value === "string" && /^[0-9]+\.[0-9]+\.[0-9]+$/u.test(value);
}
