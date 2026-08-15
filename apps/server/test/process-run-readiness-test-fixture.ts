import { PassThrough } from "node:stream";

import type {
  OsSandboxAdapter,
  SandboxedProcess,
} from "@napier/runtime";

export function processReadySandbox(id: string): OsSandboxAdapter {
  return {
    id,
    launch(request) {
      return request.args.some((argument) =>
        argument.includes("napier_shell_probe_v1"),
      )
        ? Promise.resolve(settledProcess())
        : Promise.reject(
            new Error("Fixture does not execute non-readiness commands"),
          );
    },
  };
}

function settledProcess(): SandboxedProcess {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  queueMicrotask(() => {
    stdout.end("napier_shell_probe_v1");
    stderr.end();
  });
  return {
    stdin,
    stdout,
    stderr,
    exit: Promise.resolve({ code: 0, signal: null }),
    terminate: async () => undefined,
  };
}
