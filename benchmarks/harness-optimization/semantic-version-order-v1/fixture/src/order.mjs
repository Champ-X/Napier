import { parseVersion } from "./version.mjs";
export function compareVersions(a, b) {
  const x = parseVersion(a).core.map(Number),
    y = parseVersion(b).core.map(Number);
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  }
  return 0;
}
export function sortVersions(values) {
  return values.sort(compareVersions);
}
