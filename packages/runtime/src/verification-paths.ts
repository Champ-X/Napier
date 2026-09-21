import { realpath } from "node:fs/promises";
import path from "node:path";
export async function resolveExistingPath(
  workspaceRoot: string,
  candidate: string,
  label: string,
): Promise<string> {
  const lexical = path.resolve(workspaceRoot, candidate);
  if (!isPathInside(lexical, workspaceRoot)) {
    throw new Error(`${label} escapes the workspace`);
  }
  let resolved: string;
  try {
    resolved = await realpath(lexical);
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new Error(`${label} does not exist: ${candidate}`);
    }
    throw error;
  }
  if (!isPathInside(resolved, workspaceRoot)) {
    throw new Error(`${label} resolves outside the workspace`);
  }
  return resolved;
}

export function isPathInside(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error
    ? String(error.code)
    : undefined;
}

function isMissingFileError(error: unknown): boolean {
  return errorCode(error) === "ENOENT";
}
