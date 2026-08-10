import {
  spawn,
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import type { Readable, Writable } from "node:stream";

import type { SandboxedProcess } from "./sandbox-types.js";
import {
  PROCESS_GUARDIAN_SPEC_ENV,
  PROCESS_GUARDIAN_WORKER_SOURCE,
} from "./process-guardian-worker-source.js";

const GUARDIAN_READY_TIMEOUT_MS = 5_000;
const GUARDIAN_STOP_GRACE_MS = 3_000;
const MAX_GUARDIAN_STATUS_BYTES = 4_096;

export interface ParentGuardedProcessLaunch {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  cleanup?: ParentGuardedOciCleanup;
}

export interface ParentGuardedOciCleanup {
  kind: "oci-container";
  command: string;
  commandSha256: string;
  containerName: string;
  env: Record<string, string>;
}

export interface ParentGuardedProcess extends SandboxedProcess {
  readonly guardianPid: number;
  readonly targetPid: number;
}

interface GuardianSpec extends ParentGuardedProcessLaunch {
  parentPid: number;
  statusFd?: 4;
}

type GuardianStatus =
  | { type: "ready"; pid: number }
  | { type: "exit"; code: number | null; signal: NodeJS.Signals | null }
  | { type: "error"; code: string };

interface GuardianStatusChannel {
  ready: Promise<number>;
  exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

export async function launchParentGuardedProcess(
  request: ParentGuardedProcessLaunch,
  spawnProcess: typeof spawn = spawn,
): Promise<ParentGuardedProcess> {
  const guardian = spawnProcess(
    process.execPath,
    ["--input-type=module", "--eval", PROCESS_GUARDIAN_WORKER_SOURCE],
    {
      cwd: request.cwd,
      env: guardianEnvironment(),
      detached: true,
      shell: false,
      stdio: ["pipe", "pipe", "pipe", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  const streams = guardianStreams(guardian);
  const guardianExit = childExit(guardian);
  const statuses = createGuardianStatusChannel(streams.status, guardianExit);
  try {
    await waitForSpawn(guardian);
    streams.specification.end(
      JSON.stringify(guardianSpec(request, { statusFd: 4 })),
    );
    const targetPid = await withTimeout(
      statuses.ready,
      GUARDIAN_READY_TIMEOUT_MS,
      "Process guardian did not start its sandbox target",
    );
    const guardianPid = guardian.pid;
    if (guardianPid === undefined) {
      throw new Error("Process guardian did not expose its runtime identity");
    }
    const exit = statuses.exit.then(async (result) => {
      await guardianExit;
      return result;
    });
    return {
      guardianPid,
      targetPid,
      stdin: streams.stdin,
      stdout: streams.stdout,
      stderr: streams.stderr,
      exit,
      terminate: () => terminateGuardian(guardian, guardianExit, exit),
    };
  } catch (error) {
    streams.specification.destroy();
    streams.status.destroy();
    await terminateGuardian(guardian, guardianExit).catch(() => undefined);
    throw error;
  }
}

export function createParentGuardedTerminalLaunch(
  request: ParentGuardedProcessLaunch,
): ParentGuardedProcessLaunch {
  const encoded = Buffer.from(
    JSON.stringify(guardianSpec(request)),
    "utf8",
  ).toString("base64");
  return {
    command: process.execPath,
    args: ["--input-type=module", "--eval", PROCESS_GUARDIAN_WORKER_SOURCE],
    cwd: request.cwd,
    env: {
      ...guardianEnvironment(),
      ...(request.env["TERM"] ? { TERM: request.env["TERM"] } : {}),
      [PROCESS_GUARDIAN_SPEC_ENV]: encoded,
    },
  };
}

function guardianSpec(
  request: ParentGuardedProcessLaunch,
  options: { statusFd?: 4 } = {},
): GuardianSpec {
  return {
    parentPid: process.pid,
    command: request.command,
    args: [...request.args],
    cwd: request.cwd,
    env: { ...request.env },
    ...(request.cleanup
      ? {
          cleanup: {
            ...request.cleanup,
            env: { ...request.cleanup.env },
          },
        }
      : {}),
    ...(options.statusFd ? { statusFd: options.statusFd } : {}),
  };
}

function guardianEnvironment(): Record<string, string> {
  return {
    LANG: "C",
    LC_ALL: "C",
    NO_COLOR: "1",
  };
}

function guardianStreams(child: ChildProcess): {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  specification: Writable;
  status: Readable;
} {
  const stdin = child.stdin;
  const stdout = child.stdout;
  const stderr = child.stderr;
  const specification = child.stdio[3];
  const status = child.stdio[4];
  if (
    !stdin ||
    !stdout ||
    !stderr ||
    !specification ||
    typeof (specification as Writable).write !== "function" ||
    !status ||
    typeof (status as Readable).on !== "function"
  ) {
    throw new Error("Process guardian pipes are unavailable");
  }
  return {
    stdin,
    stdout,
    stderr,
    specification: specification as Writable,
    status: status as Readable,
  };
}

function createGuardianStatusChannel(
  stream: Readable,
  guardianExit: Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>,
): GuardianStatusChannel {
  let buffer = "";
  let readySettled = false;
  let exitSettled = false;
  let resolveReady!: (pid: number) => void;
  let rejectReady!: (error: Error) => void;
  let resolveExit!: (value: {
    code: number | null;
    signal: NodeJS.Signals | null;
  }) => void;
  const ready = new Promise<number>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const exit = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve) => {
    resolveExit = resolve;
  });
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    buffer += chunk;
    if (Buffer.byteLength(buffer, "utf8") > MAX_GUARDIAN_STATUS_BYTES) {
      failReady("Process guardian emitted invalid status");
      return;
    }
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      acceptStatus(parseGuardianStatus(line));
      newline = buffer.indexOf("\n");
    }
  });
  stream.once("error", () => failReady("Process guardian status failed"));
  void guardianExit.then((result) => {
    failReady("Process guardian exited before its sandbox target started");
    if (!exitSettled) {
      exitSettled = true;
      resolveExit(result);
    }
  });
  function failReady(message: string): void {
    if (readySettled) return;
    readySettled = true;
    rejectReady(new Error(message));
  }
  function acceptStatus(status: GuardianStatus | undefined): void {
    if (!status) {
      failReady("Process guardian emitted invalid status");
      return;
    }
    if (status.type === "ready") {
      if (readySettled) return;
      readySettled = true;
      resolveReady(status.pid);
      return;
    }
    if (status.type === "error") {
      failReady("Process guardian could not start its sandbox target");
      return;
    }
    if (!exitSettled) {
      exitSettled = true;
      resolveExit({ code: status.code, signal: status.signal });
    }
  }
  return { ready, exit };
}

function parseGuardianStatus(line: string): GuardianStatus | undefined {
  try {
    const value = JSON.parse(line) as Record<string, unknown>;
    if (
      value["type"] === "ready" &&
      Number.isSafeInteger(value["pid"]) &&
      Number(value["pid"]) > 1
    ) {
      return { type: "ready", pid: Number(value["pid"]) };
    }
    if (value["type"] === "error" && typeof value["code"] === "string") {
      return { type: "error", code: value["code"] };
    }
    if (
      value["type"] === "exit" &&
      (value["code"] === null || Number.isInteger(value["code"])) &&
      (value["signal"] === null || typeof value["signal"] === "string")
    ) {
      return {
        type: "exit",
        code: value["code"] === null ? null : Number(value["code"]),
        signal:
          value["signal"] === null ? null : (value["signal"] as NodeJS.Signals),
      };
    }
  } catch {
    return undefined;
  }
  return undefined;
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
    child.once("close", finish);
    child.once("error", () => finish(null, null));
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

async function terminateGuardian(
  guardian: ChildProcessWithoutNullStreams | ChildProcess,
  guardianExit: Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>,
  targetExit?: Promise<unknown>,
): Promise<void> {
  if (guardian.exitCode === null && guardian.signalCode === null) {
    guardian.kill("SIGTERM");
    const stopped = await Promise.race([
      guardianExit.then(() => true),
      new Promise<false>((resolve) =>
        setTimeout(() => resolve(false), GUARDIAN_STOP_GRACE_MS),
      ),
    ]);
    if (!stopped) guardian.kill("SIGKILL");
  }
  await guardianExit;
  await targetExit;
}

function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    void operation.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}
