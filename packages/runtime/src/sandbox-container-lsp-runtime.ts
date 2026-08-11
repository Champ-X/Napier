import { canonicalJson, sha256 } from "./ed25519.js";
import {
  probeContainerRuntimeIdentity,
  type ContainerClient,
  type ContainerImageIdentity,
  type ContainerUserIds,
} from "./sandbox-container-runtime.js";
import type { SandboxLspRuntimeBinding } from "./sandbox-types.js";

export async function resolveContainerLspRuntime(
  identity: ContainerImageIdentity,
  client?: ContainerClient,
  injectedUserIds?: ContainerUserIds,
  injectedDaemonEndpoint?: string,
): Promise<SandboxLspRuntimeBinding> {
  const observed = await probeContainerRuntimeIdentity(
    identity,
    client,
    injectedUserIds,
    injectedDaemonEndpoint,
  );
  if (!observed.lsp) {
    throw new Error("OCI image-bound LSP runtime is unavailable");
  }
  const assets = observed.lsp;
  return {
    runtime: "lsp",
    nodeExecutable: observed.node.executable,
    nodeExecutableSha256: observed.node.executableSha256,
    ...(identity.user.mapping === "portable-non-posix"
      ? { protocolWorkspaceRoot: "/workspace" }
      : {}),
    ...assets,
    runtimeIdentitySha256: sha256(
      canonicalJson({
        kind: "napier.oci-lsp-runtime-identity",
        imageIdentitySha256: identity.identitySha256,
        nodeExecutable: observed.node.executable,
        nodeExecutableSha256: observed.node.executableSha256,
        userMapping: identity.user.mapping,
        ...(identity.user.mapping === "portable-non-posix"
          ? { protocolWorkspaceRoot: "/workspace" }
          : {}),
        ...assets,
      }),
    ),
  };
}
