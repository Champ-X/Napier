#!/usr/bin/env node

import { runCli } from "./cli.js";

const controller = new AbortController();
const abort = (): void => controller.abort();
process.once("SIGINT", abort);
process.once("SIGTERM", abort);

try {
  process.exitCode = await runCli(
    process.argv.slice(2),
    {
      cwd: process.cwd(),
      env: process.env,
      stdin: process.stdin,
      stdout: process.stdout,
      stderr: process.stderr,
    },
    undefined,
    controller.signal,
  );
} finally {
  process.removeListener("SIGINT", abort);
  process.removeListener("SIGTERM", abort);
}
