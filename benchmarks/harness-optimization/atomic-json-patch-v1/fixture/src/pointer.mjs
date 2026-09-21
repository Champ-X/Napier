export function decodePointer(path) {
  return path
    .split("/")
    .slice(1)
    .map((x) => x.replaceAll("~1", "/"));
}
