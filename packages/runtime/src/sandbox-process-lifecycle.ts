import {
  spawn,
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { rm } from "node:fs/promises";

import { launchParentGuardedProcess } from "./process-guardian.js";
import type { ParentGuardedOciCleanup } from "./process-guardian.js";
import type { SandboxedProcess } from "./sandbox-types.js";
import {
  failedLaunchCleanup,
  sandboxCleanup,
  sandboxExecutionIdentity,
  sandboxLaunchFailure,
} from "./sandbox-execution-evidence.js";
import {
  finalizeSandboxProcess,
  observeSandboxGroupCleanup,
} from "./sandbox-process-cleanup.js";

const PROCESS_STOP_GRACE_MS = 2_000;

export async function launchSandboxProcess(input: {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  sandboxHome: string;
  parentDeathGuard: boolean;
  guardianCleanup?: ParentGuardedOciCleanup;
  beforeCleanup?: () => Promise<void>;
  spawnProcess?: typeof spawn;
}): Promise<SandboxedProcess> {
  let child: SandboxedProcess;
  try {
    child = input.parentDeathGuard
      ? await launchParentGuardedProcess(
          {
            command: input.command,
            args: input.args,
            cwd: input.cwd,
            env: input.env,
            ...(input.guardianCleanup
              ? { cleanup: input.guardianCleanup }
              : {}),
          },
          input.spawnProcess,
        )
      : await launchDetachedProcess(input);
  } catch (error) {
    try {
      await cleanupSandbox(input);
    } catch (cleanupError) {
      throw sandboxLaunchFailure(
        cleanupError,
        sandboxCleanup("unknown", "sandbox_cleanup_failed"),
      );
    }
    throw sandboxLaunchFailure(error, failedLaunchCleanup(error));
  }
  return finalizeSandboxProcess(child, () => cleanupSandbox(input));
}

async function cleanupSandbox(input: {
  sandboxHome: string;
  beforeCleanup?: () => Promise<void>;
}): Promise<void> {
  try {
    await input.beforeCleanup?.();
  } finally {
    await rm(input.sandboxHome, { recursive: true, force: true });
  }
}

async function launchDetachedProcess(input: {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  spawnProcess?: typeof spawn;
}): Promise<SandboxedProcess> {
  const spawnProcess = input.spawnProcess ?? spawn;
  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawnProcess(input.command, input.args, {
      cwd: input.cwd,
      env: input.env,
      detached: true,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (error) {
    throw sandboxLaunchFailure(
      error,
      sandboxCleanup(
        spawnProcess === spawn ? "not_started" : "unknown",
        "process_spawn_rejected",
      ),
    );
  }
  const resourceIdentity = sandboxExecutionIdentity("process", child.pid);
  const exit = childExit(child).finally(() => {
    signalProcessGroup(child, "SIGTERM");
  });
  try {
    await waitForSpawn(child);
  } catch (error) {
    const noStart = spawnProcess === spawn && child.pid === undefined;
    if (!noStart) await compensateUnconfirmedSpawn(child, exit);
    throw sandboxLaunchFailure(
      error,
      sandboxCleanup(
        noStart ? "not_started" : "unknown",
        "process_spawn_failed",
      ),
      resourceIdentity,
    );
  }
  const cleanup = exit.then(() => observeSandboxGroupCleanup(child.pid));
  return {
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,
    exit,
    cleanup,
    resourceIdentity,
    terminate: async () => {
      if (child.exitCode !== null || child.signalCode !== null) {
        await exit;
        return;
      }
      signalProcessGroup(child, "SIGTERM");
      const stopped = await Promise.race([
        exit.then(() => true),
        new Promise<false>((resolve) =>
          setTimeout(() => resolve(false), PROCESS_STOP_GRACE_MS),
        ),
      ]);
      if (!stopped) signalProcessGroup(child, "SIGKILL");
      await exit;
    },
  };
}

async function compensateUnconfirmedSpawn(
  child: ChildProcess,
  exit: Promise<unknown>,
): Promise<void> {
  if (
    child.pid === undefined ||
    child.exitCode !== null ||
    child.signalCode !== null
  )
    return;
  for (const signal of ["SIGTERM", "SIGKILL"] as const) {
    try {
      signalProcessGroup(child, signal);
    } catch {
      /* The slot remains unknown. */
    }
    const stopped = await Promise.race([
      exit.then(
        () => true,
        () => true,
      ),
      new Promise<false>((resolve) =>
        setTimeout(() => resolve(false), PROCESS_STOP_GRACE_MS),
      ),
    ]);
    if (stopped) return;
  }
}

function childExit(child: ChildProcess): Promise<{
  code: number | null;
  signal: NodeJS.Signals | null;
}> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (
      code: number | null,
      signal: NodeJS.Signals | null,
    ): void => {
      if (settled) return;
      settled = true;
      resolve({ code, signal });
    };
    child.once("exit", finish);
    child.once("close", finish);
  });
}

function waitForSpawn(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSpawn = (): void => {
      child.off("error", onError);
      resolve();
    };
    const onError = (error: Error): void => {
      child.off("spawn", onSpawn);
      reject(error);
    };
    child.once("spawn", onSpawn);
    child.once("error", onError);
  });
}

function signalProcessGroup(
  child: ChildProcessWithoutNullStreams | ChildProcess,
  signal: NodeJS.Signals,
): void {
  if (child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch (error) {
      if (errorCode(error) === "ESRCH") return;
    }
  }
  child.kill(signal);
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error
    ? String(error.code)
    : undefined;
}
