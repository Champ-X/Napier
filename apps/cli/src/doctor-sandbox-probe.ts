import { createPlatformSandboxAdapter } from "@napier/runtime";
import {
  probeGitRuntime,
  probeSandboxResourceRuntime,
  probeSandboxProcessRuntime,
  sandboxIsolationStrength,
} from "@napier/runtime/doctor-probes";
import { probeContainerRuntimeAvailability } from "@napier/runtime/sandbox-container";

import type { DoctorCheck } from "./doctor-report.js";

interface DoctorSandboxProbeDependencies {
  containerRuntimeAvailable?: (signal: AbortSignal) => Promise<boolean>;
}

/**
 * Launches a bounded, network-denied probe through the active OS sandbox. When
 * the sandbox cannot run, reports whether a container runtime is available so
 * Doctor can guide the user to enable the container fallback instead of only
 * stating that process tasks fail closed.
 */
export async function defaultSandboxProbe(
  workspaceRoot: string,
  signal: AbortSignal,
  configuredSandbox = createPlatformSandboxAdapter(),
  dependencies: DoctorSandboxProbeDependencies = {},
): Promise<DoctorCheck> {
  const startedAt = Date.now();
  const sandbox = configuredSandbox;
  let result;
  try {
    result = await probeSandboxProcessRuntime(workspaceRoot, signal, sandbox);
  } catch (error) {
    if (signal.aborted) throw error;
    return sandboxUnavailableCheck(
      Date.now() - startedAt,
      signal,
      sandbox.id,
      dependencies,
    );
  }
  if (result.status !== "ready") {
    return sandboxUnavailableCheck(
      Date.now() - startedAt,
      signal,
      sandbox.id,
      dependencies,
    );
  }
  const isolation = sandboxIsolationStrength(sandbox.id);
  const git = await probeGitRuntime(workspaceRoot, signal, sandbox);
  if (git.status !== "ready") {
    return {
      id: "sandbox",
      status: "warning",
      required: false,
      code: "sandbox_git_unavailable",
      message: `${git.message} (${isolation.summary})`,
      durationMs: Date.now() - startedAt,
      evidence: {
        adapter: sandbox.id,
        isolationLevel: isolation.level,
        networkDeniedByDefault: isolation.networkDeniedByDefault,
        resourceLimited: isolation.resourceLimited,
        productionCall: false,
      },
    };
  }
  if (sandbox.id === "host-direct") {
    return {
      id: "sandbox",
      status: "warning",
      required: false,
      code: "sandbox_host_direct",
      message: `Direct host execution is enabled with NO OS isolation (${isolation.summary}). Process tasks run under your own authority.`,
      durationMs: Date.now() - startedAt,
      evidence: {
        adapter: sandbox.id,
        isolationLevel: isolation.level,
        networkDeniedByDefault: isolation.networkDeniedByDefault,
        resourceLimited: isolation.resourceLimited,
        productionCall: true,
        gitProductionCall: true,
      },
    };
  }
  if (sandbox.id === "oci-container") {
    const resources = await probeSandboxResourceRuntime(
      workspaceRoot,
      signal,
      sandbox,
    );
    if (resources.status !== "ready") {
      return {
        id: "sandbox",
        status: "warning",
        required: false,
        code: resources.code,
        message: resources.message,
        durationMs: Date.now() - startedAt,
        evidence: {
          adapter: sandbox.id,
          isolationLevel: isolation.level,
          networkDeniedByDefault: isolation.networkDeniedByDefault,
          resourceLimited: false,
          productionCall: true,
          gitProductionCall: true,
          resourceProductionCall: false,
        },
      };
    }
    return {
      id: "sandbox",
      status: "passed",
      required: false,
      code: "sandbox_ready",
      message: `The OCI process sandbox dynamically proved its network, filesystem, privilege, process, memory, CPU, and temporary-storage boundaries (${isolation.summary})`,
      durationMs: Date.now() - startedAt,
      evidence: {
        adapter: sandbox.id,
        isolationLevel: isolation.level,
        networkDeniedByDefault: isolation.networkDeniedByDefault,
        resourceLimited: true,
        productionCall: true,
        gitProductionCall: true,
        resourceProductionCall: true,
        ...resources.evidence,
      },
    };
  }
  return {
    id: "sandbox",
    status: "passed",
    required: false,
    code: "sandbox_ready",
    message: `The OS process sandbox launched a network-denied probe (${isolation.summary})`,
    durationMs: Date.now() - startedAt,
    evidence: {
      adapter: sandbox.id,
      isolationLevel: isolation.level,
      networkDeniedByDefault: isolation.networkDeniedByDefault,
      resourceLimited: isolation.resourceLimited,
      productionCall: true,
      gitProductionCall: true,
    },
  };
}

export function sandboxFailure(
  _error: unknown,
  durationMs: number,
): DoctorCheck {
  const isolation = sandboxIsolationStrength(createPlatformSandboxAdapter().id);
  return {
    id: "sandbox",
    status: "warning",
    required: false,
    code: "sandbox_unavailable",
    message:
      "OS process sandbox is unavailable; coding/process tasks (run, build, test, LSP, git) will fail closed. Read-only file tools still work.",
    durationMs,
    evidence: { isolationLevel: isolation.level },
  };
}

async function sandboxUnavailableCheck(
  durationMs: number,
  signal: AbortSignal,
  adapterId = createPlatformSandboxAdapter().id,
  dependencies: DoctorSandboxProbeDependencies = {},
): Promise<DoctorCheck> {
  signal.throwIfAborted();
  const isolation = sandboxIsolationStrength(adapterId);
  if (adapterId === "configured-sandbox-invalid") {
    return {
      id: "sandbox",
      status: "warning",
      required: false,
      code: "sandbox_configured_invalid",
      message:
        "The persisted Sandbox binding is invalid. Process tasks fail closed until exact-preview uninstall removes it or Setup replaces it.",
      durationMs,
      evidence: {
        adapter: adapterId,
        isolationLevel: isolation.level,
        configured: true,
      },
    };
  }
  if (adapterId === "oci-container") {
    return {
      id: "sandbox",
      status: "warning",
      required: false,
      code: "sandbox_configured_unavailable",
      message:
        "The configured OCI Sandbox could not complete its production probe. Start the same local Docker daemon or rerun Sandbox setup to repair the verified image.",
      durationMs,
      evidence: {
        adapter: adapterId,
        isolationLevel: isolation.level,
        configured: true,
      },
    };
  }
  const imageConfigured = Boolean(
    process.env["NAPIER_CONTAINER_SANDBOX_IMAGE"]?.trim(),
  );
  const containerReady = !imageConfigured
    ? await (
        dependencies.containerRuntimeAvailable ??
        ((probeSignal) =>
          probeContainerRuntimeAvailability({ signal: probeSignal }))
      )(signal)
    : false;
  signal.throwIfAborted();
  if (containerReady) {
    return {
      id: "sandbox",
      status: "warning",
      required: false,
      code: "sandbox_container_available",
      message:
        "OS process sandbox is unavailable, but a local container runtime is ready. Run napier setup --workspace 'WORKSPACE_PATH' --component sandbox, inspect the preview, and exact-apply Napier's locked toolchain before coding or process tasks.",
      durationMs,
      evidence: { isolationLevel: isolation.level, containerRuntime: true },
    };
  }
  return sandboxFailure(undefined, durationMs);
}
