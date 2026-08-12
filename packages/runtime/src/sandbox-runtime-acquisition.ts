import type { SandboxSetupResult } from "@napier/contracts/sandbox-setup";

import type { ContainerImageIdentity } from "./sandbox-container-runtime.js";
import type { SandboxInstallationProvenance } from "./sandbox-installation.js";
import {
  buildOfficialSandboxRuntime,
  pullOfficialSandboxRuntime,
  type SandboxRuntimeInspection,
  type SandboxRuntimeSetupDependencies,
} from "./sandbox-runtime-setup.js";

export type ReadySandboxRuntime = SandboxRuntimeInspection & {
  status: "ready";
  identity: ContainerImageIdentity;
};

export interface SandboxRuntimeAcquisitionDependencies
  extends SandboxRuntimeSetupDependencies {
  buildRuntime?: typeof buildOfficialSandboxRuntime;
  pullRuntime?: typeof pullOfficialSandboxRuntime;
}

export async function acquireOfficialSandboxRuntime(
  inspection: SandboxRuntimeInspection,
  signal: AbortSignal,
  dependencies: SandboxRuntimeAcquisitionDependencies,
): Promise<{
  ready: ReadySandboxRuntime;
  action: SandboxSetupResult["action"];
}> {
  if (inspection.status === "ready" && inspection.identity) {
    return {
      ready: inspection as ReadySandboxRuntime,
      action: "reused",
    };
  }
  if (inspection.status === "pullable") {
    const pulled = await (
      dependencies.pullRuntime ?? pullOfficialSandboxRuntime
    )(
      { signal },
      {
        ...(dependencies.inspect ? { inspect: dependencies.inspect } : {}),
        ...(dependencies.pullRelease
          ? { pullRelease: dependencies.pullRelease }
          : {}),
        ...(dependencies.releasePull
          ? { releasePull: dependencies.releasePull }
          : {}),
      },
    );
    if (pulled) return { ready: pulled, action: "pulled" };
  }
  return {
    ready: await buildOfficialSandboxRuntimeFromSource(
      signal,
      dependencies,
    ),
    action: "built",
  };
}

export function buildOfficialSandboxRuntimeFromSource(
  signal: AbortSignal,
  dependencies: SandboxRuntimeAcquisitionDependencies,
  force = false,
): Promise<ReadySandboxRuntime> {
  return (dependencies.buildRuntime ?? buildOfficialSandboxRuntime)(
    { signal, ...(force ? { force: true } : {}) },
    {
      ...(dependencies.inspect ? { inspect: dependencies.inspect } : {}),
      ...(dependencies.runBuild
        ? { runBuild: dependencies.runBuild }
        : {}),
    },
  );
}

export function sandboxRuntimeInstallationProvenance(
  target: SandboxRuntimeInspection["target"],
): SandboxInstallationProvenance {
  return {
    acquisition: target.acquisition,
    ...(target.release
      ? {
          releaseDigest: target.release.digest,
          releaseSourceSha: target.release.sourceSha,
          releaseReceiptSha256: target.release.receiptSha256,
        }
      : {}),
  };
}
