import type { Readable } from "node:stream";

import type { OsSandboxAdapter, SandboxLaunchRequest } from "./sandbox.js";

export type SandboxedProcessStatus = "exited" | "timed_out" | "output_capped";

export interface SandboxedProcessResult {
  status: SandboxedProcessStatus;
  durationMs: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

export interface RunSandboxedProcessOptions {
  sandbox: OsSandboxAdapter;
  launch: SandboxLaunchRequest;
  timeoutMs: number;
  maxOutputChars: number;
  signal?: AbortSignal;
  abortedMessage: string;
}

interface OutputCollector {
  readonly completion: Promise<void>;
  readonly text: string;
  readonly truncated: boolean;
}

export async function runSandboxedProcess(
  options: RunSandboxedProcessOptions,
): Promise<SandboxedProcessResult> {
  const startedAt = Date.now();
  const child = await options.sandbox.launch(options.launch);
  child.stdin.end();

  let forcedStatus: Exclude<SandboxedProcessStatus, "exited"> | undefined;
  let termination: Promise<void> | undefined;
  const forceStop = (
    status: Exclude<SandboxedProcessStatus, "exited">,
  ): void => {
    if (forcedStatus) return;
    forcedStatus = status;
    termination = child.terminate();
  };
  const stdout = collectOutput(child.stdout, options.maxOutputChars, () =>
    forceStop("output_capped"),
  );
  const stderr = collectOutput(child.stderr, options.maxOutputChars, () =>
    forceStop("output_capped"),
  );
  const timeout = setTimeout(() => forceStop("timed_out"), options.timeoutMs);
  const abort = (): void => {
    if (!termination) termination = child.terminate();
  };
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();

  try {
    const exit = await child.exit;
    await termination;
    await Promise.all([stdout.completion, stderr.completion]);
    if (options.signal?.aborted) {
      throw new Error(options.abortedMessage);
    }
    return {
      status: forcedStatus ?? "exited",
      durationMs: Math.max(0, Date.now() - startedAt),
      exitCode: exit.code,
      signal: exit.signal,
      stdout: stdout.text,
      stderr: stderr.text,
      stdoutTruncated: stdout.truncated,
      stderrTruncated: stderr.truncated,
    };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
    if (options.signal?.aborted && !termination) {
      await child.terminate();
    }
  }
}

function collectOutput(
  stream: Readable,
  maxOutputChars: number,
  onLimit: () => void,
): OutputCollector {
  let text = "";
  let truncated = false;
  const completion = new Promise<void>((resolve) => {
    const finish = (): void => resolve();
    stream.once("end", finish);
    stream.once("close", finish);
    stream.once("error", finish);
    stream.on("data", (chunk: Buffer | string) => {
      if (truncated) return;
      const value = chunk.toString();
      const remaining = maxOutputChars - text.length;
      if (value.length <= remaining) {
        text += value;
        return;
      }
      text += value.slice(0, Math.max(0, remaining));
      truncated = true;
      onLimit();
    });
  });
  return {
    completion,
    get text() {
      return text;
    },
    get truncated() {
      return truncated;
    },
  };
}
