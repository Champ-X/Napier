import { matchesPath } from "./glob.mjs";
export function selectPaths(paths, rules) {
  for (const list of [paths, rules]) {
    if (!Array.isArray(list)) throw new TypeError("Invalid list");
    for (let i = 0; i < list.length; i++)
      if (!Object.hasOwn(list, i)) throw new TypeError("Sparse list");
  }
  for (const p of paths) matchesPath("**", p);
  for (const r of rules) {
    if (
      !r ||
      typeof r !== "object" ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(r)) ||
      typeof r.include !== "boolean"
    )
      throw new TypeError("Invalid rule");
    matchesPath(r.pattern, "validation");
  }
  const output = [],
    seen = new Set();
  for (const p of paths) {
    let include = false;
    for (const r of rules) if (matchesPath(r.pattern, p)) include = r.include;
    if (include && !seen.has(p)) {
      seen.add(p);
      output.push(p);
    }
  }
  return output;
}
