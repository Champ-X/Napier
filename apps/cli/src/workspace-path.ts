import { realpath, stat } from "node:fs/promises";
import path from "node:path";

export async function canonicalWorkspace(
  candidate: string,
  cwd: string,
): Promise<string> {
  const workspaceRoot = await realpath(path.resolve(cwd, candidate));
  const info = await stat(workspaceRoot);
  if (!info.isDirectory()) throw new Error("CLI workspace must be a directory");
  return workspaceRoot;
}
