import type { ExecutionResourceCleanup } from "./execution-resource-admission.js";
import { sandboxCleanup } from "./sandbox-execution-evidence.js";
import type { SandboxedProcess } from "./sandbox-types.js";

/** No process census is claimed: observe the launched group, never escaped groups. */
export async function observeSandboxGroupCleanup(
  pid: number | undefined,
): Promise<ExecutionResourceCleanup> {
  if (pid === undefined)
    return sandboxCleanup("unknown", "process_identity_missing");
  if (process.platform === "win32")
    return sandboxCleanup("unknown", "process_group_observation_unavailable");
  const deadline = Date.now() + 2_000;
  do {
    try {
      process.kill(-pid, 0);
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ESRCH"
      )
        return sandboxCleanup("released", "owned_process_group_absent");
      return sandboxCleanup("unknown", "process_group_observation_failed");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  } while (Date.now() < deadline);
  return sandboxCleanup("unknown", "owned_process_group_still_present");
}

/** Cleanup belongs to the execution lifetime, even when target exit is zero. */
export function finalizeSandboxProcess(
  child: SandboxedProcess,
  cleanupResources: () => Promise<void>,
): SandboxedProcess {
  const settled = child.exit.then(
    async (result) => {
      try {
        const evidence =
          (await child.cleanup) ??
          sandboxCleanup("unknown", "backend_cleanup_missing");
        await cleanupResources();
        return { result, evidence, failed: false, error: undefined };
      } catch (error) {
        return {
          result,
          evidence: sandboxCleanup("unknown", "sandbox_cleanup_failed"),
          failed: true,
          error,
        };
      }
    },
    async (error: unknown) => {
      try {
        await cleanupResources();
      } catch {
        /* Keep the original target failure. */
      }
      return {
        result: undefined,
        evidence: sandboxCleanup("unknown", "process_exit_failed"),
        failed: true,
        error,
      };
    },
  );
  const exit = settled.then(({ result, error, failed }) => {
    if (!result) throw error;
    if (failed) throw error;
    return result;
  });
  return {
    ...child,
    exit,
    cleanup: settled.then(({ evidence }) => evidence),
    terminate: async () => {
      await child.terminate();
      await exit;
    },
  };
}
