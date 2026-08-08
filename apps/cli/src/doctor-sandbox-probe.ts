import {
  createPlatformSandboxAdapter,
  runSandboxedProcess,
} from "@napier/runtime";
import { sandboxIsolationStrength } from "@napier/runtime/doctor-probes";
import { resolveContainerExecutable } from "@napier/runtime/sandbox-container";

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
): Promise<DoctorCheck> {
  const startedAt = Date.now();
  const sandbox = createPlatformSandboxAdapter();
  const container = sandbox.id === "oci-container";
  const launch = container
    ? {
        command: "/bin/true",
        args: [] as string[],
        env: { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" },
      }
    : {
        command: process.execPath,
        args: ["-e", "process.exit(0)"],
        env: { LANG: "C", LC_ALL: "C", PATH: process.env.PATH ?? "" },
      };
  let result;
  try {
    result = await runSandboxedProcess({
      sandbox,
      launch: {
        command: launch.command,
        args: launch.args,
        cwd: workspaceRoot,
        env: launch.env,
        workspaceRoot,
        approvedCapabilities: ["process.spawn"],
      },
      timeoutMs: container ? 60_000 : 5_000,
      maxOutputChars: 256,
      signal,
      abortedMessage: "Doctor sandbox probe was cancelled",
    });
  } catch (error) {
    if (signal.aborted) throw error;
    return sandboxUnavailableCheck(Date.now() - startedAt);
  }
  const passed =
    result.status === "exited" &&
    result.exitCode === 0 &&
    !result.stdout &&
    !result.stderr;
  if (!passed) return sandboxUnavailableCheck(Date.now() - startedAt);
  const isolation = sandboxIsolationStrength(sandbox.id);
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
    },
  };
}

export function sandboxFailure(_error: unknown, durationMs: number): DoctorCheck {
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
): Promise<DoctorCheck> {
  const isolation = sandboxIsolationStrength(createPlatformSandboxAdapter().id);
  const imageConfigured = Boolean(
    process.env["NAPIER_CONTAINER_SANDBOX_IMAGE"]?.trim(),
  );
  const container = !imageConfigured
    ? await resolveContainerExecutable()
    : undefined;
  if (container) {
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
