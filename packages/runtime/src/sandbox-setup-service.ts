import type {
  ApplySandboxSetupRequest,
  ApplySandboxUninstallRequest,
  SandboxSetupChecks,
  SandboxSetupPreview,
  SandboxSetupResult,
  SandboxUninstallPreview,
  SandboxUninstallResult,
} from "@napier/contracts/sandbox-setup";

import {
  probeDapRuntime,
  probeGitRuntime,
  probeLocalServiceRuntime,
  probeLspRuntime,
  probePythonRuntime,
  probeSandboxResourceRuntime,
  probeSandboxProcessRuntime,
  probeShellRuntime,
} from "./doctor-runtime-probes.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import {
  createSandboxFallbackAdapter,
  createSandboxInstallation,
  inspectSandboxInstallationBinding,
  removeSandboxInstallation,
  saveSandboxInstallation,
  type SandboxInstallationBinding,
  type SandboxInstallation,
} from "./sandbox-installation.js";
import { OciContainerSandboxAdapter } from "./sandbox-oci.js";
import {
  buildOfficialSandboxRuntime,
  inspectOfficialSandboxRuntime,
  type SandboxRuntimeInspection,
  type SandboxRuntimeSetupDependencies,
} from "./sandbox-runtime-setup.js";
import { SwitchableSandboxAdapter } from "./sandbox-switchable.js";
import type { ContainerImageIdentity } from "./sandbox-container-runtime.js";
import type { OsSandboxAdapter } from "./sandbox-types.js";

export interface SandboxSetupServiceDependencies extends SandboxRuntimeSetupDependencies {
  verify?: (input: {
    workspaceRoot: string;
    dataRoot: string;
    imageReference: string;
    identity: ContainerImageIdentity;
    signal: AbortSignal;
  }) => Promise<{
    checks: SandboxSetupChecks;
  }>;
  activate?: (input: {
    installation: SandboxInstallation;
    workspaceRoot: string;
    signal: AbortSignal;
  }) => Promise<OsSandboxAdapter>;
  loadInstallation?: (
    dataRoot: string,
  ) => Promise<SandboxInstallation | undefined>;
  inspectInstallation?: (
    dataRoot: string,
  ) => Promise<SandboxInstallationBinding>;
  removeInstallation?: (
    dataRoot: string,
    expectedBindingSha256: string,
  ) => Promise<void>;
  fallback?: () => OsSandboxAdapter;
}

export class SandboxSetupService {
  private readonly inspect: () => Promise<SandboxRuntimeInspection>;
  private applying = false;

  constructor(
    private readonly workspaceRoot: string,
    private readonly dataRoot: string,
    private readonly sandbox: SwitchableSandboxAdapter,
    private readonly dependencies: SandboxSetupServiceDependencies = {},
  ) {
    this.inspect = dependencies.inspect ?? inspectOfficialSandboxRuntime;
  }

  async preview(): Promise<SandboxSetupPreview> {
    const inspection = await this.inspect();
    return createSandboxSetupPreview(
      inspection,
      Boolean(
        inspection.identity &&
        this.sandbox.setupIdentitySha256 === inspection.identity.identitySha256,
      ),
    );
  }

  async apply(
    request: ApplySandboxSetupRequest,
    signal: AbortSignal,
  ): Promise<SandboxSetupResult> {
    if (this.applying) throw new Error("Sandbox setup is already running");
    this.applying = true;
    try {
      const inspection = await this.inspect();
      const preview = createSandboxSetupPreview(
        inspection,
        Boolean(
          inspection.identity &&
          this.sandbox.setupIdentitySha256 ===
            inspection.identity.identitySha256,
        ),
      );
      if (request.expectedPreviewSha256 !== preview.contentSha256) {
        throw new Error("Sandbox setup preview is stale");
      }
      if (
        inspection.status === "unsupported" ||
        inspection.status === "runtime_unavailable"
      ) {
        throw new Error("Official Sandbox runtime is unavailable on this host");
      }
      const ready =
        inspection.status === "ready" && inspection.identity
          ? {
              ...inspection,
              status: "ready" as const,
              identity: inspection.identity,
            }
          : await buildOfficialSandboxRuntime(
              { signal },
              {
                inspect: this.inspect,
                ...(this.dependencies.runBuild
                  ? { runBuild: this.dependencies.runBuild }
                  : {}),
              },
            );
      const verification = await (
        this.dependencies.verify ?? verifySandboxRuntime
      )({
        workspaceRoot: this.workspaceRoot,
        dataRoot: this.dataRoot,
        imageReference: ready.target.imageReference,
        identity: ready.identity,
        signal,
      });
      const installation = createSandboxInstallation(
        ready.target.imageReference,
        ready.identity,
      );
      const next = await (
        this.dependencies.activate ?? activateInstalledSandbox
      )({
        installation,
        workspaceRoot: this.workspaceRoot,
        signal,
      });
      const persisted = await saveSandboxInstallation(
        this.dataRoot,
        ready.target.imageReference,
        ready.identity,
        new Date(installation.verifiedAt),
      );
      this.sandbox.replace(next);
      return createSandboxSetupResult(
        ready,
        inspection.status === "ready" ? "reused" : "built",
        verification.checks,
        persisted,
      );
    } finally {
      this.applying = false;
    }
  }

  async uninstallPreview(): Promise<SandboxUninstallPreview> {
    const binding = await this.inspectBinding();
    const fallback = (
      this.dependencies.fallback ??
      (() => createSandboxFallbackAdapter())
    )();
    return createSandboxUninstallPreview(
      binding,
      this.sandbox.setupIdentitySha256,
      fallback.id,
    );
  }

  async uninstall(
    request: ApplySandboxUninstallRequest,
  ): Promise<SandboxUninstallResult> {
    if (this.applying) throw new Error("Sandbox setup is already running");
    this.applying = true;
    try {
      const binding = await this.inspectBinding();
      const fallback = (
        this.dependencies.fallback ??
        (() => createSandboxFallbackAdapter())
      )();
      const preview = createSandboxUninstallPreview(
        binding,
        this.sandbox.setupIdentitySha256,
        fallback.id,
      );
      if (request.expectedPreviewSha256 !== preview.contentSha256) {
        throw new Error("Sandbox uninstall preview is stale");
      }
      if (binding.status === "not_installed") {
        throw new Error("Sandbox installation is not configured");
      }
      if (!binding.bindingSha256) {
        throw new Error("Sandbox installation cannot be safely removed");
      }
      await (
        this.dependencies.removeInstallation ?? removeSandboxInstallation
      )(this.dataRoot, binding.bindingSha256);
      this.sandbox.replace(fallback);
      return createSandboxUninstallResult(binding, fallback.id);
    } finally {
      this.applying = false;
    }
  }

  private async inspectBinding(): Promise<SandboxInstallationBinding> {
    if (this.dependencies.inspectInstallation) {
      return this.dependencies.inspectInstallation(this.dataRoot);
    }
    if (this.dependencies.loadInstallation) {
      const installation = await this.dependencies.loadInstallation(
        this.dataRoot,
      );
      return installation
        ? {
            status: "installed",
            bindingSha256: installation.contentSha256,
            installation,
          }
        : { status: "not_installed" };
    }
    return inspectSandboxInstallationBinding(this.dataRoot);
  }
}

async function activateInstalledSandbox(input: {
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

export function createSandboxSetupPreview(
  inspection: SandboxRuntimeInspection,
  active = false,
): SandboxSetupPreview {
  const withoutHash = {
    kind: "napier.sandbox-runtime-setup-preview" as const,
    schemaVersion: 1 as const,
    component: "sandbox" as const,
    status: inspection.status,
    active:
      active && inspection.status === "ready" && Boolean(inspection.identity),
    imageReference: inspection.target.imageReference,
    ...(inspection.identity ? { imageId: inspection.identity.imageId } : {}),
    dockerfileSha256: inspection.target.dockerfileSha256,
    contextSha256: inspection.target.contextSha256,
    platform: inspection.target.platform,
    arch: inspection.target.arch,
  };
  return {
    ...withoutHash,
    contentSha256: sha256(canonicalJson(withoutHash)),
  };
}

export function createSandboxUninstallPreview(
  binding: SandboxInstallationBinding,
  activeIdentitySha256: string | undefined,
  fallbackSandbox: string,
): SandboxUninstallPreview {
  const installation = binding.installation;
  const withoutHash = {
    kind: "napier.sandbox-runtime-uninstall-preview" as const,
    schemaVersion: 1 as const,
    component: "sandbox" as const,
    status: binding.status,
    active: Boolean(
      installation &&
      activeIdentitySha256 === installation.identitySha256,
    ),
    imageRetained: true as const,
    ...(binding.bindingSha256
      ? { bindingSha256: binding.bindingSha256 }
      : {}),
    ...(installation
      ? {
          imageReference: installation.imageReference,
          imageId: installation.imageId,
          identitySha256: installation.identitySha256,
          installationSha256: installation.contentSha256,
        }
      : {}),
    fallbackSandbox,
  };
  return {
    ...withoutHash,
    contentSha256: sha256(canonicalJson(withoutHash)),
  };
}

async function verifySandboxRuntime(input: {
  workspaceRoot: string;
  dataRoot: string;
  imageReference: string;
  identity: ContainerImageIdentity;
  signal: AbortSignal;
}) {
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

function createSandboxSetupResult(
  inspection: SandboxRuntimeInspection & {
    status: "ready";
    identity: ContainerImageIdentity;
  },
  action: SandboxSetupResult["action"],
  checks: SandboxSetupChecks,
  installation: SandboxInstallation,
): SandboxSetupResult {
  const withoutHash = {
    kind: "napier.sandbox-runtime-setup-result" as const,
    schemaVersion: 1 as const,
    component: "sandbox" as const,
    action,
    status: "ready" as const,
    imageReference: inspection.target.imageReference,
    imageId: inspection.identity.imageId,
    dockerfileSha256: inspection.target.dockerfileSha256,
    contextSha256: inspection.target.contextSha256,
    identitySha256: inspection.identity.identitySha256,
    installationSha256: installation.contentSha256,
    checks,
  };
  return {
    ...withoutHash,
    contentSha256: sha256(canonicalJson(withoutHash)),
  };
}

function createSandboxUninstallResult(
  binding: SandboxInstallationBinding,
  fallbackSandbox: string,
): SandboxUninstallResult {
  const installation = binding.installation;
  const withoutHash = {
    kind: "napier.sandbox-runtime-uninstall-result" as const,
    schemaVersion: 1 as const,
    component: "sandbox" as const,
    action: "uninstalled" as const,
    status: "removed" as const,
    imageRetained: true as const,
    bindingSha256: binding.bindingSha256!,
    ...(installation
      ? {
          imageReference: installation.imageReference,
          imageId: installation.imageId,
          identitySha256: installation.identitySha256,
          installationSha256: installation.contentSha256,
        }
      : {}),
    fallbackSandbox,
  };
  return {
    ...withoutHash,
    contentSha256: sha256(canonicalJson(withoutHash)),
  };
}
