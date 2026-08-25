import { spawn } from "node:child_process";
import path from "node:path";

import type {
  OsSandboxAdapter,
  SandboxedProcess,
  SandboxLaunchRequest,
} from "@napier/runtime/code";

export const TRUSTED_OUTER_PROCESS_BENCHMARK_SANDBOX_ID =
  "trusted-outer-process-benchmark";

export function createTrustedOuterProcessBenchmarkSandbox(): OsSandboxAdapter {
  return {
    id: TRUSTED_OUTER_PROCESS_BENCHMARK_SANDBOX_ID,
    async launch(request) {
      assertTrustedOuterRequest(request);
      const child = spawn(request.command, request.args, {
        cwd: request.cwd,
        env: { ...request.env },
        detached: true,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const exit = new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve) =>
        child.once("exit", (code, signal) => resolve({ code, signal })),
      );
      return {
        stdin: child.stdin,
        stdout: child.stdout,
        stderr: child.stderr,
        exit,
        async terminate() {
          if (
            child.exitCode === null &&
            child.signalCode === null &&
            child.pid !== undefined
          ) {
            try {
              process.kill(-child.pid, "SIGTERM");
            } catch {
              child.kill("SIGTERM");
            }
          }
          await exit;
        },
      } satisfies SandboxedProcess;
    },
  };
}

function assertTrustedOuterRequest(request: SandboxLaunchRequest): void {
  const workspaceRoot = path.resolve(request.workspaceRoot);
  const cwd = path.resolve(request.cwd);
  const expectedCapabilities = [
    "process.spawn",
    "workspace.read",
    "workspace.write",
  ];
  if (
    request.terminal ||
    request.command !== process.execPath ||
    !inside(cwd, workspaceRoot) ||
    JSON.stringify(request.approvedCapabilities) !==
      JSON.stringify(expectedCapabilities) ||
    !Array.isArray(request.workspaceWritePaths) ||
    request.workspaceWritePaths.length < 1 ||
    request.workspaceWritePaths.length > 8 ||
    request.workspaceWritePaths.some(
      (target) => !inside(path.resolve(target), workspaceRoot),
    )
  ) {
    throw new Error("Trusted outer Process benchmark request is invalid");
  }
}

function inside(target: string, root: string): boolean {
  return target === root || target.startsWith(`${root}${path.sep}`);
}
