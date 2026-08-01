import { realpath } from "node:fs/promises";
import path from "node:path";

const MAX_ADDITIONAL_LSP_RUNTIME_READ_PATHS = 6;

export async function resolveLspRuntimeReadPaths(
  requiredPaths: string[],
  additionalPaths: string[] | undefined,
): Promise<string[]> {
  if (
    additionalPaths !== undefined &&
    (additionalPaths.length > MAX_ADDITIONAL_LSP_RUNTIME_READ_PATHS ||
      additionalPaths.some((candidate) => !path.isAbsolute(candidate)))
  ) {
    throw new Error("LSP runtime read paths are invalid");
  }
  const resolvedAdditionalPaths = await Promise.all(
    (additionalPaths ?? []).map((candidate) =>
      realpath(path.resolve(candidate)),
    ),
  );
  return [...new Set([...requiredPaths, ...resolvedAdditionalPaths])];
}
