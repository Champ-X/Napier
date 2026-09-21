export function matchesPath(pattern, path) {
  return path.includes(pattern.replaceAll("*", ""));
}
