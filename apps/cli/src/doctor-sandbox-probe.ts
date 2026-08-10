import { createPlatformSandboxAdapter } from "@napier/runtime";
import {
  probeGitRuntime,
  probeSandboxProcessRuntime,
  sandboxIsolationStrength,
} from "@napier/runtime/doctor-probes";
import { probeContainerRuntimeAvailability } from "@napier/runtime/sandbox-container";

import type { DoctorCheck } from "./doctor-report.js";

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
): Promise<DoctorCheck> {
  const startedAt = Date.now();
  const sandbox = configuredSandbox;
  let result;
  try {
    result = await probeSandboxProcessRuntime(workspaceRoot, signal, sandbox);
  } catch (error) {
    if (signal.aborted) throw error;
    return sandboxUnavailableCheck(Date.now() - startedAt, signal, sandbox.id);
  }
  if (result.status !== "ready") {
    return sandboxUnavailableCheck(Date.now() - startedAt, signal, sandbox.id);
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
): Promise<DoctorCheck> {
  signal.throwIfAborted();
  const isolation = sandboxIsolationStrength(adapterId);
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
    ? await probeContainerRuntimeAvailability({ signal })
    : false;
  signal.throwIfAborted();
  if (containerReady) {
    return {
      id: "sandbox",
      status: "warning",
      required: false,
      code: "sandbox_container_available",
      message:
        "OS process sandbox is unavailable, but a container runtime was found. Set NAPIER_CONTAINER_SANDBOX_IMAGE to enable a container sandbox for coding/process tasks.",
      durationMs,
      evidence: { isolationLevel: isolation.level, containerRuntime: true },
    };
  }
  return sandboxFailure(undefined, durationMs);
}
