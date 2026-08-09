import { lstat, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { canonicalJson, sha256 } from "./ed25519.js";

const MAX_TOOLCHAIN_MANIFEST_BYTES = 4 * 1024 * 1024;

export interface VerificationToolchainBinding {
  workspaceRoot: string;
  root: string;
  verifierPath: string;
  verifierRelativePath: string;
  verifierPathSha256: string;
  verifierSha256: string;
  external: boolean;
  runtimeReadPaths: string[];
  packageJsonSha256: string | null;
  packageLockSha256: string | null;
  contentSha256: string;
}

export async function resolveVerificationToolchain(input: {
  workspaceRoot: string;
  toolchainRoot?: string;
  verifierRelativePath: string;
}): Promise<VerificationToolchainBinding> {
  const workspaceRoot = await realpath(path.resolve(input.workspaceRoot));
  const root = await realpath(
    path.resolve(input.toolchainRoot ?? workspaceRoot),
  );
  if (!(await stat(root)).isDirectory()) {
    throw new Error("verification toolchain root must be a directory");
  }
  const verifierLexical = path.resolve(root, input.verifierRelativePath);
  if (!isPathInside(verifierLexical, root)) {
    throw new Error("verification toolchain path escapes its root");
  }
  const verifierPath = await realpath(verifierLexical);
  if (
    !isPathInside(verifierPath, root) ||
    !(await stat(verifierPath)).isFile()
  ) {
    throw new Error("verification toolchain verifier must be a regular file");
  }
  const external = path.resolve(root) !== path.resolve(workspaceRoot);
  const runtimeReadPaths = external
    ? [await canonicalNodeModulesRoot(root)]
    : [];
  const verifierPathSha256 = sha256(
    path.relative(root, verifierPath).split(path.sep).join("/"),
  );
  const verifierSha256 = sha256(await readFile(verifierPath));
  const packageJsonSha256 = await optionalManifestSha256(
    path.join(root, "package.json"),
  );
  const packageLockSha256 = await optionalManifestSha256(
    path.join(root, "package-lock.json"),
  );
  const content = {
    verifierPathSha256,
    verifierSha256,
    packageJsonSha256,
    packageLockSha256,
  };
  return {
    workspaceRoot,
    root,
    verifierPath,
    verifierRelativePath: input.verifierRelativePath,
    verifierPathSha256,
    verifierSha256,
    external,
    runtimeReadPaths,
    packageJsonSha256,
    packageLockSha256,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export async function assertVerificationToolchainStable(
  binding: VerificationToolchainBinding,
): Promise<void> {
  const observed = await resolveVerificationToolchain({
    workspaceRoot: binding.workspaceRoot,
    ...(binding.external ? { toolchainRoot: binding.root } : {}),
    verifierRelativePath: binding.verifierRelativePath,
  });
  if (observed.contentSha256 !== binding.contentSha256) {
    throw new Error("verification toolchain changed during execution");
  }
}

async function canonicalNodeModulesRoot(root: string): Promise<string> {
  const lexical = path.join(root, "node_modules");
  const resolved = await realpath(lexical);
  if (resolved !== lexical || !(await stat(resolved)).isDirectory()) {
    throw new Error(
      "external verification toolchain requires canonical node_modules",
    );
  }
  return resolved;
}

async function optionalManifestSha256(
  candidate: string,
): Promise<string | null> {
  let info;
  try {
    info = await lstat(candidate);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size > MAX_TOOLCHAIN_MANIFEST_BYTES ||
    (await realpath(candidate)) !== candidate
  ) {
    throw new Error("verification toolchain manifest is unsafe");
  }
  return sha256(await readFile(candidate));
}

function isPathInside(candidate: string, root: string): boolean {
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
    ? String((error as NodeJS.ErrnoException).code)
    : undefined;
}
