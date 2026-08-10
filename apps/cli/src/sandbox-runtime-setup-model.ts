import type { SandboxRuntimeSetupDependencies } from "@napier/runtime/sandbox-runtime-setup";
import type { SandboxInstallation } from "@napier/runtime/sandbox-installation";

export interface SandboxRuntimeVerification {
  checks: {
    node: string;
    shell: string;
    python: string;
    git: string;
    lsp: string;
    dap: string;
    service: string;
  };
  installation: SandboxInstallation;
}

export interface CliSandboxRuntimeSetupDependencies extends SandboxRuntimeSetupDependencies {
  verify?: (input: {
    workspaceRoot: string;
    dataRoot: string;
    imageReference: string;
    identity: SandboxInstallationIdentity;
    signal: AbortSignal;
  }) => Promise<SandboxRuntimeVerification>;
}

export interface SandboxInstallationIdentity {
  imageId: string;
  clientExecutable: string;
  clientExecutableSha256: string;
  daemon: { location: "local"; endpointSha256: string };
  user: {
    userId: number;
    groupId: number;
    identitySha256: string;
  };
  identitySha256: string;
}
