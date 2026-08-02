import {
  spawn,
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { rm } from "node:fs/promises";

import { launchParentGuardedProcess } from "./process-guardian.js";
import type { SandboxedProcess } from "./sandbox-types.js";

const PROCESS_STOP_GRACE_MS = 2_000;

export async function launchSandboxProcess(input: {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  sandboxHome: string;
  parentDeathGuard: boolean;
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
          },
          input.spawnProcess,
        )
      : await launchDetachedProcess(input);
  } catch (error) {
    await rm(input.sandboxHome, { recursive: true, force: true });
    throw error;
  }
  const exit = child.exit.finally(async () => {
    await rm(input.sandboxHome, { recursive: true, force: true });
  });
  return {
    ...child,
    exit,
    terminate: async () => {
      await child.terminate();
      await exit;
    },
  };
}

async function launchDetachedProcess(input: {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  spawnProcess?: typeof spawn;
}): Promise<SandboxedProcess> {
  const spawnProcess = input.spawnProcess ?? spawn;
  const child = spawnProcess(input.command, input.args, {
    cwd: input.cwd,
    env: input.env,
    detached: true,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  await waitForSpawn(child);
  const exit = childExit(child).finally(() => {
    signalProcessGroup(child, "SIGTERM");
  });
  return {
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,
    exit,
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
