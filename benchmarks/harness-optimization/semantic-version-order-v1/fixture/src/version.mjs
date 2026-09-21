export function parseVersion(text) {
  const [base, prerelease = ""] = text.split("-");
  return {
    core: base.split("."),
    prerelease: prerelease.split(".").filter(Boolean),
    build: [],
  };
}
