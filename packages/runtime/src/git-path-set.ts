import { canonicalJson, sha256 } from "./ed25519.js";
import { normalizeGitPath } from "./git-repository.js";

export function normalizeGitPathSet(values: readonly string[]): string[] {
  const normalized = values.map((value) => normalizeGitPath(value));
  const identities = new Set<string>();
  for (const targetPath of normalized) {
    const identity = gitPathIdentity(targetPath);
    if (identities.has(identity)) {
      throw new Error("Git target paths collide");
    }
    identities.add(identity);
  }
  return normalized.sort(compareCodePoints);
}

export function gitPathSetSha256(paths: readonly string[]): string {
  return paths.length === 1
    ? sha256(paths[0]!)
    : sha256(
        canonicalJson(
          paths.map((targetPath) => ({
            pathSha256: sha256(targetPath),
          })),
        ),
      );
}

function gitPathIdentity(value: string): string {
  const normalized = value.normalize("NFC");
  return process.platform === "darwin" || process.platform === "win32"
    ? normalized.toLowerCase()
    : normalized;
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
