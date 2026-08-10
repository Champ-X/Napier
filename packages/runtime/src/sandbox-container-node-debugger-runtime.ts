import { canonicalJson, sha256 } from "./ed25519.js";
import {
  probeContainerRuntimeIdentity,
  type ContainerClient,
  type ContainerImageIdentity,
  type ContainerUserIds,
} from "./sandbox-container-runtime.js";
import type { SandboxNodeDebuggerRuntimeBinding } from "./sandbox-types.js";

export async function resolveContainerNodeDebuggerRuntime(
  identity: ContainerImageIdentity,
  client?: ContainerClient,
  injectedUserIds?: ContainerUserIds,
  injectedDaemonEndpoint?: string,
): Promise<SandboxNodeDebuggerRuntimeBinding> {
  const observed = await probeContainerRuntimeIdentity(
    identity,
    client,
    injectedUserIds,
    injectedDaemonEndpoint,
  );
  if (!observed.debugger) {
    throw new Error("OCI image-bound Node debugger runtime is unavailable");
  }
  return {
    runtime: "node-debugger",
    nodeExecutable: observed.node.executable,
    nodeExecutableSha256: observed.node.executableSha256,
    nodeVersion: observed.debugger.nodeVersion,
    runtimeIdentitySha256: sha256(
      canonicalJson({
        kind: "napier.oci-node-debugger-runtime-identity",
        imageIdentitySha256: identity.identitySha256,
        nodeExecutable: observed.node.executable,
        nodeExecutableSha256: observed.node.executableSha256,
        nodeVersion: observed.debugger.nodeVersion,
        inspectorWorkerProbe: true,
      }),
    ),
  };
}
