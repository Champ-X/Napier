import path from "node:path";

import { canonicalJson, sha256 } from "./ed25519.js";
import type { OsSandboxAdapter } from "./sandbox-types.js";
import {
  assertVerificationToolchainStable,
  resolveVerificationToolchain,
  type VerificationToolchainBinding,
} from "./verification-toolchain.js";
import type { SandboxVerificationRuntimeBinding } from "./sandbox-types.js";
import type { VerificationKind } from "./verification-types.js";

const HOST_VERIFICATION_PATHS = {
  typecheck: "node_modules/typescript/bin/tsc",
  test: "node_modules/vitest/vitest.mjs",
  format: "node_modules/prettier/bin/prettier.cjs",
} as const satisfies Record<VerificationKind, string>;

export interface VerificationRuntime {
  location: "host" | "provider";
  nodeExecutable: string;
  nodeExecutableSha256?: string;
  verifierPath: string;
  verifierPathSha256: string;
  verifierSha256: string;
  verifierVersion?: string;
  toolchainExternal: boolean;
  toolchainSha256: string;
  runtimeReadPaths: string[];
  runtimeIdentitySha256?: string;
  hostBinding?: VerificationToolchainBinding;
}

export async function resolveVerificationRuntime(input: {
  workspaceRoot: string;
  sandbox: OsSandboxAdapter;
  kind: VerificationKind;
  nodeExecutable: string;
  nodeExecutableExplicit: boolean;
  toolchainRoot?: string;
}): Promise<VerificationRuntime> {
  const provider = await input.sandbox.resolveVerificationRuntime?.();
  if (provider) {
    validateProviderBinding(provider);
    if (input.nodeExecutableExplicit || input.toolchainRoot !== undefined) {
      throw new Error(
        "Image-bound verification runtime does not accept host runtime overrides",
      );
    }
    const selected = providerVerifier(provider, input.kind);
    return {
      location: "provider",
      nodeExecutable: provider.nodeExecutable,
      nodeExecutableSha256: provider.nodeExecutableSha256,
      verifierPath: selected.path,
      verifierPathSha256: sha256(
        path.posix.relative(provider.toolchainRoot, selected.path),
      ),
      verifierSha256: selected.sha256,
      verifierVersion: selected.version,
      toolchainExternal: false,
      toolchainSha256: sha256(
        canonicalJson({
          packageJsonSha256: provider.packageJsonSha256,
          packageLockSha256: provider.packageLockSha256,
        }),
      ),
      runtimeReadPaths: [],
      runtimeIdentitySha256: provider.runtimeIdentitySha256,
    };
  }
  if (input.sandbox.id === "oci-container") {
    throw new Error("OCI image-bound verification runtime is unavailable");
  }
  const hostBinding = await resolveVerificationToolchain({
    workspaceRoot: input.workspaceRoot,
    ...(input.toolchainRoot ? { toolchainRoot: input.toolchainRoot } : {}),
    verifierRelativePath: HOST_VERIFICATION_PATHS[input.kind],
  });
  return {
    location: "host",
    nodeExecutable: input.nodeExecutable,
    verifierPath: hostBinding.verifierPath,
    verifierPathSha256: hostBinding.verifierPathSha256,
    verifierSha256: hostBinding.verifierSha256,
    toolchainExternal: hostBinding.external,
    toolchainSha256: hostBinding.contentSha256,
    runtimeReadPaths: hostBinding.runtimeReadPaths,
    hostBinding,
  };
}

export async function assertVerificationRuntimeStable(
  runtime: VerificationRuntime,
  sandbox: OsSandboxAdapter,
): Promise<void> {
  if (runtime.location === "host") {
    await assertVerificationToolchainStable(runtime.hostBinding!);
    return;
  }
  const current = await sandbox.resolveVerificationRuntime?.();
  if (
    !current ||
    current.runtimeIdentitySha256 !== runtime.runtimeIdentitySha256
  ) {
    throw new Error("verification provider runtime identity changed");
  }
}

function providerVerifier(
  binding: SandboxVerificationRuntimeBinding,
  kind: VerificationKind,
): { path: string; version: string; sha256: string } {
  if (kind === "typecheck") {
    return {
      path: binding.typecheckPath,
      version: binding.typecheckVersion,
      sha256: binding.typecheckSha256,
    };
  }
  if (kind === "test") {
    return {
      path: binding.testPath,
      version: binding.testVersion,
      sha256: binding.testSha256,
    };
  }
  return {
    path: binding.formatPath,
    version: binding.formatVersion,
    sha256: binding.formatSha256,
  };
}

function validateProviderBinding(
  binding: SandboxVerificationRuntimeBinding,
): void {
  const paths = [
    binding.nodeExecutable,
    binding.toolchainRoot,
    binding.typecheckPath,
    binding.testPath,
    binding.formatPath,
  ];
  const hashes = [
    binding.nodeExecutableSha256,
    binding.packageJsonSha256,
    binding.packageLockSha256,
    binding.typecheckSha256,
    binding.testSha256,
    binding.formatSha256,
    binding.runtimeIdentitySha256,
  ];
  const versions = [
    binding.typecheckVersion,
    binding.testVersion,
    binding.formatVersion,
  ];
  if (
    binding.runtime !== "verification" ||
    paths.some(
      (candidate) =>
        !path.posix.isAbsolute(candidate) ||
        /[\u0000-\u001f\u007f]/u.test(candidate),
    ) ||
    [binding.typecheckPath, binding.testPath, binding.formatPath].some(
      (candidate) => !inside(candidate, binding.toolchainRoot),
    ) ||
    hashes.some((candidate) => !/^[a-f0-9]{64}$/u.test(candidate)) ||
    versions.some(
      (candidate) => !/^[A-Za-z0-9][A-Za-z0-9.+_-]{0,79}$/u.test(candidate),
    )
  ) {
    throw new Error("Provider verification runtime identity is invalid");
  }
}

function inside(candidate: string, root: string): boolean {
  const relative = path.posix.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("../") &&
      relative !== ".." &&
      !path.posix.isAbsolute(relative))
  );
}
