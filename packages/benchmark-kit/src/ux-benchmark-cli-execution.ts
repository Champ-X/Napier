import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { Writable } from "node:stream";

import type {
  LocalAgentRuntimeOptions,
  LocalAgentRuntimeServices,
} from "@napier/runtime";

import { compiledCliEntry, runCli } from "@napier/cli/runner";

export interface UxBenchmarkCliRequest {
  args: string[];
  cwd: string;
  env: Readonly<Record<string, string | undefined>>;
  signal: AbortSignal;
}

export interface UxBenchmarkCliExecution {
  exitCode: number;
  stdout: string;
  stderr: string;
  firstEventMs: number;
  totalDurationMs: number;
}

export type UxBenchmarkRuntimeFactory = (
  options: LocalAgentRuntimeOptions,
) => Promise<LocalAgentRuntimeServices>;

export async function executeUxBenchmarkCliSubprocess(
  request: UxBenchmarkCliRequest,
): Promise<UxBenchmarkCliExecution> {
  const startedAt = performance.now();
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let firstWriteAt: number | undefined;
    const child = spawn(
      process.execPath,
      [compiledCliEntry(), ...request.args],
      {
        cwd: request.cwd,
        env: { ...request.env },
        signal: request.signal,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.stdout.on("data", (chunk: Buffer) => {
      firstWriteAt ??= performance.now();
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === null) {
        reject(
          new Error(`UX benchmark CLI terminated by ${signal ?? "signal"}`),
        );
        return;
      }
      const totalDurationMs = elapsedMs(startedAt);
      resolve({
        exitCode: code,
        stdout,
        stderr,
        firstEventMs: firstWriteAt
          ? Math.max(0, Math.round(firstWriteAt - startedAt))
          : totalDurationMs,
        totalDurationMs,
      });
    });
  });
}

export async function executeUxBenchmarkCliInProcess(
  request: UxBenchmarkCliRequest,
  createRuntime: UxBenchmarkRuntimeFactory,
): Promise<UxBenchmarkCliExecution> {
  const stdout = new BenchmarkCaptureWritable();
  const stderr = new BenchmarkCaptureWritable();
  const startedAt = performance.now();
  const exitCode = await runCli(
    request.args,
    {
      cwd: request.cwd,
      env: request.env,
      stdout,
      stderr,
    },
    { createRuntime },
    request.signal,
  );
  const totalDurationMs = elapsedMs(startedAt);
  return {
    exitCode,
    stdout: stdout.text(),
    stderr: stderr.text(),
    firstEventMs: stdout.firstWriteAt
      ? Math.max(0, Math.round(stdout.firstWriteAt - startedAt))
      : totalDurationMs,
    totalDurationMs,
  };
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

class BenchmarkCaptureWritable extends Writable {
  readonly chunks: string[] = [];
  firstWriteAt?: number;

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.firstWriteAt ??= performance.now();
    this.chunks.push(chunk.toString("utf8"));
    callback();
  }

  text(): string {
    return this.chunks.join("");
  }
}
