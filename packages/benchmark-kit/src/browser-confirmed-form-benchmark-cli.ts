import { performance } from "node:perf_hooks";

import type { BrowserInteractionAction } from "@napier/contracts/browser-interaction-confirmation";
import { sha256 } from "@napier/runtime/core";
import { compiledCliEntry } from "@napier/cli/runner";
import { spawn } from "@lydell/node-pty";

import type { BrowserConfirmedFormBenchmarkExecution } from "./browser-confirmed-form-benchmark-types.js";

export interface BrowserConfirmedFormCliRequest {
  args: string[];
  cwd: string;
  env: Readonly<Record<string, string | undefined>>;
  expectedActions: BrowserInteractionAction[];
  signal: AbortSignal;
}

export interface BrowserConfirmedFormCliExecution extends BrowserConfirmedFormBenchmarkExecution {
  output: string;
}

export async function executeBrowserConfirmedFormCliPty(
  request: BrowserConfirmedFormCliRequest,
): Promise<BrowserConfirmedFormCliExecution> {
  request.signal.throwIfAborted();
  const startedAt = performance.now();
  let output = "";
  let settled = false;
  let confirmationIndex = 0;
  let firstConfirmationMs: number | undefined;
  let unexpectedConfirmationAction = false;
  const terminal = spawn(
    process.execPath,
    [compiledCliEntry(), ...request.args],
    {
      name: "xterm-256color",
      cols: 120,
      rows: 40,
      cwd: request.cwd,
      env: stringEnvironment(request.env),
    },
  );
  const onAbort = (): void => terminal.kill("SIGTERM");
  request.signal.addEventListener("abort", onAbort, { once: true });
  try {
    const exit = new Promise<number>((resolve, reject) => {
      terminal.onData((chunk) => {
        output += chunk;
        if (Buffer.byteLength(output, "utf8") > 4 * 1024 * 1024) {
          terminal.kill();
          reject(
            new Error("Browser confirmed form terminal output exceeded limit"),
          );
          return;
        }
        const observed = pendingConfirmationActions(output);
        if (observed.length <= confirmationIndex) return;
        const action = observed[confirmationIndex]!;
        const expected = request.expectedActions[confirmationIndex];
        if (!expected || action !== expected) {
          unexpectedConfirmationAction = true;
          terminal.kill();
          reject(
            new Error("Browser confirmed form confirmation action changed"),
          );
          return;
        }
        firstConfirmationMs ??= elapsedMs(startedAt);
        confirmationIndex += 1;
        terminal.write("approve\r");
      });
      terminal.onExit(({ exitCode, signal }) => {
        settled = true;
        if (request.signal.aborted) {
          resolve(exitCode === 0 ? 1 : exitCode);
          return;
        }
        if (signal) {
          reject(
            new Error(
              `Browser confirmed form CLI terminated by signal ${String(signal)}`,
            ),
          );
          return;
        }
        resolve(exitCode);
      });
    });
    const exitCode = await exit;
    const totalDurationMs = elapsedMs(startedAt);
    return {
      entry: "cli_one_shot_pty",
      cliExitCode: exitCode,
      confirmationPromptCount: pendingConfirmationActions(output).length,
      approvalInputCount: confirmationIndex,
      unexpectedConfirmationAction,
      firstConfirmationMs: firstConfirmationMs ?? totalDurationMs,
      totalDurationMs,
      terminalOutputSha256: sha256(output),
      terminalOutputBytes: Buffer.byteLength(output, "utf8"),
      output,
    };
  } finally {
    request.signal.removeEventListener("abort", onAbort);
    if (!settled) terminal.kill();
  }
}

function pendingConfirmationActions(
  output: string,
): BrowserInteractionAction[] {
  const actions: BrowserInteractionAction[] = [];
  const expression =
    /\[confirm\] Browser (click|type|select|upload|download|save_screenshot) paused before execution/gu;
  for (const match of stripAnsi(output).matchAll(expression)) {
    actions.push(match[1] as BrowserInteractionAction);
  }
  return actions;
}

function stringEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

function stripAnsi(value: string): string {
  return value.replace(
    // eslint-disable-next-line no-control-regex
    /[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/gu,
    "",
  );
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}
