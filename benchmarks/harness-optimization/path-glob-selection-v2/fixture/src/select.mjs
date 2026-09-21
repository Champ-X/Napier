import { matchesPath } from "./glob.mjs";
export function selectPaths(paths, rules) {
  return paths.filter((p) =>
    rules.some((r) => r.include && matchesPath(r.pattern, p)),
  );
}
