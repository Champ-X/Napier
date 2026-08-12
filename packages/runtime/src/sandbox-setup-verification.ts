import type { SandboxSetupChecks } from "@napier/contracts/sandbox-setup";

import {
  probeDapRuntime,
  probeGitRuntime,
  probeLocalServiceRuntime,
  probeLspRuntime,
  probePythonRuntime,
  probeSandboxResourceRuntime,
  probeSandboxProcessRuntime,
  probeShellRuntime,
  probeVerificationRuntime,
} from "./doctor-runtime-probes.js";
import type { SandboxInstallation } from "./sandbox-installation.js";
import { OciContainerSandboxAdapter } from "./sandbox-oci.js";
import type { ContainerImageIdentity } from "./sandbox-container-runtime.js";
import type { OsSandboxAdapter } from "./sandbox-types.js";

export async function activateInstalledSandbox(input: {
  installation: SandboxInstallation;
  workspaceRoot: string;
  signal: AbortSignal;
}): Promise<OsSandboxAdapter> {
  const next = installedSandboxAdapter(input.installation);
  const probe = await probeShellRuntime(
    input.workspaceRoot,
    input.signal,
    next,
  );
  if (probe.status !== "ready") {
    throw new Error("Persisted Sandbox activation verification failed");
  }
  return next;
}

export async function verifySandboxRuntime(input: {
  workspaceRoot: string;
  dataRoot: string;
  imageReference: string;
  identity: ContainerImageIdentity;
  signal: AbortSignal;
}): Promise<{ checks: SandboxSetupChecks }> {
  const sandbox = new OciContainerSandboxAdapter(input.identity.imageId);
  const probes = {
    node: await probeSandboxProcessRuntime(
      input.workspaceRoot,
      input.signal,
      sandbox,
    ),
    resources: await probeSandboxResourceRuntime(
      input.workspaceRoot,
      input.signal,
      sandbox,
    ),
    verification: await probeVerificationRuntime(
      input.workspaceRoot,
      input.signal,
      sandbox,
    ),
    shell: await probeShellRuntime(input.workspaceRoot, input.signal, sandbox),
    python: await probePythonRuntime(
      input.workspaceRoot,
      input.signal,
      sandbox,
    ),
    git: await probeGitRuntime(input.workspaceRoot, input.signal, sandbox),
    lsp: await probeLspRuntime(input.workspaceRoot, input.signal, sandbox),
    dap: await probeDapRuntime(input.workspaceRoot, input.signal, sandbox),
    service: await probeLocalServiceRuntime(
      input.workspaceRoot,
      input.signal,
      sandbox,
    ),
  };
  for (const [name, probe] of Object.entries(probes)) {
    if (probe.status !== "ready") {
      throw new Error(`Official Sandbox ${name} verification failed`);
    }
  }
  return {
    checks: Object.fromEntries(
      Object.entries(probes).map(([name, probe]) => [name, probe.code]),
    ) as unknown as SandboxSetupChecks,
  };
}

function installedSandboxAdapter(
  installation: SandboxInstallation,
): OciContainerSandboxAdapter {
  return new OciContainerSandboxAdapter(installation.imageId, {
    expectedIdentity: {
      clientExecutableSha256: installation.clientExecutableSha256,
      daemonEndpointSha256: installation.daemonEndpointSha256,
      userIdentitySha256: installation.userIdentitySha256,
      identitySha256: installation.identitySha256,
    },
  });
}
