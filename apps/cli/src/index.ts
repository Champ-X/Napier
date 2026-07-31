#!/usr/bin/env node

import { runCli } from "./cli.js";

const controller = new AbortController();
const interruptListeners = new Set<() => void>();
const interrupt = (): void => {
  if (interruptListeners.size === 0) {
    controller.abort();
    return;
  }
  for (const listener of [...interruptListeners]) listener();
};
const terminate = (): void => controller.abort();
process.on("SIGINT", interrupt);
process.once("SIGTERM", terminate);

try {
  process.exitCode = await runCli(
    process.argv.slice(2),
    {
      cwd: process.cwd(),
      env: process.env,
      stdin: process.stdin,
      stdout: process.stdout,
      stderr: process.stderr,
      subscribeInterrupt(listener) {
        interruptListeners.add(listener);
        return () => interruptListeners.delete(listener);
      },
    },
    undefined,
    controller.signal,
  );
} finally {
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", terminate);
}
