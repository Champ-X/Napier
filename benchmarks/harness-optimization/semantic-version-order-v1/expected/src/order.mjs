import { parseVersion } from "./version.mjs";
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const integer = (a, b) => cmp(a.length, b.length) || cmp(a, b);
export function compareVersions(left, right) {
  const a = parseVersion(left),
    b = parseVersion(right);
  for (let i = 0; i < 3; i++) {
    const c = integer(a.core[i], b.core[i]);
    if (c) return c;
  }
  if (!a.prerelease.length || !b.prerelease.length)
    return cmp(a.prerelease.length === 0, b.prerelease.length === 0);
  for (let i = 0; i < Math.min(a.prerelease.length, b.prerelease.length); i++) {
    const x = a.prerelease[i],
      y = b.prerelease[i],
      xn = /^[0-9]+$/.test(x),
      yn = /^[0-9]+$/.test(y);
    const c = xn && yn ? integer(x, y) : xn !== yn ? (xn ? -1 : 1) : cmp(x, y);
    if (c) return c;
  }
  return cmp(a.prerelease.length, b.prerelease.length);
}
export function sortVersions(values) {
  if (!Array.isArray(values)) throw new TypeError("Expected array");
  for (let i = 0; i < values.length; i++) {
    if (!Object.hasOwn(values, i)) throw new TypeError("Sparse array");
    parseVersion(values[i]);
  }
  return [...values].sort(compareVersions);
}
