import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";

const SANDBOX_EXEC = "/usr/bin/sandbox-exec";
const AVAILABILITY_TIMEOUT_MS = 1_000;

export async function probeMacOsSandboxAvailability(
  executable = SANDBOX_EXEC,
  spawnProcess = spawn,
  timeoutMs = AVAILABILITY_TIMEOUT_MS,
): Promise<void> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 1_000) {
    throw new Error("macOS process sandbox availability timeout is invalid");
  }
  const command = "/usr/bin/true";
  const profile = [
    "(version 1)",
    "(deny default)",
    "(allow process-fork)",
    `(allow process-exec (literal ${sandboxLiteral(command)}))`,
    "(allow file-read*",
    '  (subpath "/System")',
    '  (subpath "/usr/lib")',
    `  (literal ${sandboxLiteral(command)})`,
    ")",
  ].join("\n");
  const child = spawnProcess(executable, ["-p", profile, "--", command], {
    cwd: "/",
    env: {},
    detached: false,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  await waitForSpawn(child);
  const exit = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  const result = await boundedExit(exit, timeoutMs);
  if (!result) {
    child.kill("SIGKILL");
    await boundedExit(exit, timeoutMs);
  }
  if (!result || result.code !== 0 || result.signal !== null) {
    throw new Error(
      "macOS process sandbox is unavailable in this host environment",
    );
  }
}

async function boundedExit(
  exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>,
  timeoutMs: number,
) {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      exit,
      new Promise<undefined>((resolve) => {
        timeout = setTimeout(() => resolve(undefined), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function waitForSpawn(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSpawn = () => {
      child.off("error", onError);
      resolve();
    };
    const onError = (error: Error) => {
      child.off("spawn", onSpawn);
      reject(error);
    };
    child.once("spawn", onSpawn);
    child.once("error", onError);
  });
}

function sandboxLiteral(value: string): string {
  return JSON.stringify(path.resolve(value));
}
