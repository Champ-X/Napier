export function decodePointer(path) {
  if (typeof path !== "string" || (path !== "" && !path.startsWith("/")))
    throw new TypeError("Invalid pointer");
  if (path === "") return [];
  return path
    .slice(1)
    .split("/")
    .map((x) => {
      if (/~(?:[^01]|$)/.test(x)) throw new TypeError("Invalid escape");
      return x.replace(/~[01]/g, (x) => (x === "~1" ? "/" : "~"));
    });
}
