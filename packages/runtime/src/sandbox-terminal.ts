import { constants as osConstants } from "node:os";
import { rm } from "node:fs/promises";
import { PassThrough, Writable } from "node:stream";

import type { IPty } from "node-pty";

import type { SandboxedProcess } from "./sandbox.js";

const PROCESS_STOP_GRACE_MS = 2_000;
export const MIN_TERMINAL_COLUMNS = 20;
export const MAX_TERMINAL_COLUMNS = 400;
export const MIN_TERMINAL_ROWS = 5;
export const MAX_TERMINAL_ROWS = 200;

export interface TerminalProcessLaunch {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  columns: number;
  rows: number;
}

export async function launchTerminalProcess(
  request: TerminalProcessLaunch,
): Promise<SandboxedProcess> {
  const nodePty = await import("node-pty");
  let terminal: IPty;
  try {
    terminal = nodePty.spawn(request.command, request.args, {
      name: request.env["TERM"] ?? "xterm-256color",
      cols: request.columns,
      rows: request.rows,
      cwd: request.cwd,
      env: request.env,
      encoding: "utf8",
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("posix_spawnp failed")
    ) {
      throw new Error(
        "PTY launch failed because the node-pty spawn helper is not executable; reinstall dependencies so the Napier postinstall check can repair it",
      );
    }
    throw error;
  }

  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let settled = false;
  terminal.onData((data) => {
    if (!stdout.destroyed) stdout.write(data);
  });
  const exit = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve) => {
    terminal.onExit((event) => {
      settled = true;
      stdin.destroy();
      stdout.end();
      stderr.end();
      resolve({
        code: event.exitCode,
        signal: signalName(event.signal),
      });
    });
  });
  const stdin = new Writable({
    write(chunk, _encoding, callback) {
      try {
        terminal.write(
          Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk),
        );
        callback();
      } catch (error) {
        callback(error instanceof Error ? error : new Error(String(error)));
      }
    },
  });

  return {
    stdin,
    stdout,
    stderr,
    exit,
    resize: async (columns, rows) => {
      terminal.resize(columns, rows);
    },
    terminate: async () => {
      if (settled) {
        await exit;
        return;
      }
      signalProcessGroup(terminal.pid, "SIGTERM", terminal);
      const stopped = await Promise.race([
        exit.then(() => true),
        new Promise<false>((resolve) =>
          setTimeout(() => resolve(false), PROCESS_STOP_GRACE_MS),
        ),
      ]);
      if (!stopped) signalProcessGroup(terminal.pid, "SIGKILL", terminal);
      await exit;
    },
  };
}

export async function launchTerminalSandboxWrapper(
  request: TerminalProcessLaunch & { sandboxHome: string },
): Promise<SandboxedProcess> {
  let child: SandboxedProcess;
  try {
    child = await launchTerminalProcess(request);
  } catch (error) {
    await rm(request.sandboxHome, { recursive: true, force: true });
    throw error;
  }
  const exit = child.exit.finally(async () => {
    await rm(request.sandboxHome, { recursive: true, force: true });
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

export function validateTerminalDimensions(
  terminal: { columns: number; rows: number } | undefined,
): void {
  if (
    terminal !== undefined &&
    (!Number.isSafeInteger(terminal.columns) ||
      terminal.columns < MIN_TERMINAL_COLUMNS ||
      terminal.columns > MAX_TERMINAL_COLUMNS ||
      !Number.isSafeInteger(terminal.rows) ||
      terminal.rows < MIN_TERMINAL_ROWS ||
      terminal.rows > MAX_TERMINAL_ROWS)
  ) {
    throw new Error(
      `Sandbox terminal size must be ${MIN_TERMINAL_COLUMNS}-${MAX_TERMINAL_COLUMNS} columns by ${MIN_TERMINAL_ROWS}-${MAX_TERMINAL_ROWS} rows`,
    );
  }
}

function signalProcessGroup(
  pid: number,
  signal: NodeJS.Signals,
  terminal: IPty,
): void {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      terminal.kill(signal);
    } catch {
      // The exit event remains authoritative for a concurrent settlement.
    }
  }
}

function signalName(signal: number | undefined): NodeJS.Signals | null {
  if (!signal) return null;
  const match = Object.entries(osConstants.signals).find(
    ([, value]) => value === signal,
  );
  return (match?.[0] as NodeJS.Signals | undefined) ?? null;
}
