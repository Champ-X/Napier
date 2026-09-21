export function parseVersion(text) {
  if (typeof text !== "string") throw new TypeError("Version must be a string");
  const match =
    /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(
      text,
    );
  if (!match || match[0] !== text) throw new TypeError("Invalid version");
  const prerelease = match[4]?.split(".") ?? [];
  if (
    prerelease.some(
      (id) => /^[0-9]+$/.test(id) && id.length > 1 && id[0] === "0",
    )
  )
    throw new TypeError("Numeric prerelease has leading zeros");
  return {
    core: match.slice(1, 4),
    prerelease,
    build: match[5]?.split(".") ?? [],
  };
}
