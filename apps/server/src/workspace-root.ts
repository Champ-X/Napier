import path from "node:path";

export function inferWorkspaceRoot(cwd: string): string {
  const resolved = path.resolve(cwd);
  return path.basename(resolved) === "server" &&
    path.basename(path.dirname(resolved)) === "apps"
    ? path.resolve(resolved, "../..")
    : resolved;
}
