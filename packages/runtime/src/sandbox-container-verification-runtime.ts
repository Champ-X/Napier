import { canonicalJson, sha256 } from "./ed25519.js";
import {
  probeContainerRuntimeIdentity,
  type ContainerClient,
  type ContainerImageIdentity,
  type ContainerUserIds,
} from "./sandbox-container-runtime.js";
import type { SandboxVerificationRuntimeBinding } from "./sandbox-types.js";

export async function resolveContainerVerificationRuntime(
  identity: ContainerImageIdentity,
  client?: ContainerClient,
  injectedUserIds?: ContainerUserIds,
  injectedDaemonEndpoint?: string,
): Promise<SandboxVerificationRuntimeBinding> {
  const observed = await probeContainerRuntimeIdentity(
    identity,
    client,
    injectedUserIds,
    injectedDaemonEndpoint,
  );
  if (!observed.verification) {
    throw new Error("OCI image-bound verification runtime is unavailable");
  }
  const verification = observed.verification;
  return {
    runtime: "verification",
    nodeExecutable: observed.node.executable,
    nodeExecutableSha256: observed.node.executableSha256,
    toolchainRoot: verification.toolchainRoot,
    packageJsonSha256: verification.packageJsonSha256,
    packageLockSha256: verification.packageLockSha256,
    typecheckPath: verification.typecheck.path,
    typecheckVersion: verification.typecheck.version,
    typecheckSha256: verification.typecheck.sha256,
    testPath: verification.test.path,
    testVersion: verification.test.version,
    testSha256: verification.test.sha256,
    formatPath: verification.format.path,
    formatVersion: verification.format.version,
    formatSha256: verification.format.sha256,
    runtimeIdentitySha256: sha256(
      canonicalJson({
        kind: "napier.oci-verification-runtime-identity",
        imageIdentitySha256: identity.identitySha256,
        nodeExecutable: observed.node.executable,
        nodeExecutableSha256: observed.node.executableSha256,
        ...verification,
      }),
    ),
  };
}
