import path from "node:path";
import type { CommandRuntime } from "./command-runtime.js";

export const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
export const MIN_COMMAND_TIMEOUT_MS = 1_000;
export const MAX_COMMAND_TIMEOUT_MS = 30 * 60_000;
export const MAX_COMMAND_ARGUMENTS = 64;
export const MAX_COMMAND_ARGUMENT_CHARS = 2_048;
// Literal argv may contain multiline source or data. Paths retain the stricter
// policy; neither form accepts NUL, terminal escapes or other control bytes.
export const COMMAND_ARGUMENT_PATTERN =
  "^[^\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f]*$";
export const COMMAND_PATH_PATTERN = "^[^\\u0000-\\u001f\\u007f]*$";
const MAX_TOTAL_ARGUMENT_CHARS = 16_384;
const COMMAND_ARGUMENT_EXPRESSION = new RegExp(COMMAND_ARGUMENT_PATTERN, "u");
const COMMAND_PATH_EXPRESSION = new RegExp(COMMAND_PATH_PATTERN, "u");

export interface CommandExecutionRequest {
  runtime: CommandRuntime;
  args: string[];
  cwd?: string;
  timeoutMs?: number;
}

export function validateCommandRequest(input: CommandExecutionRequest): void {
  if (
    input.runtime !== "node" &&
    input.runtime !== "python" &&
    input.runtime !== "shell"
  ) {
    throw new Error(`Unsupported command runtime: ${String(input.runtime)}`);
  }
  if (
    !Array.isArray(input.args) ||
    input.args.length > MAX_COMMAND_ARGUMENTS ||
    input.args.some(
      (argument) =>
        typeof argument !== "string" ||
        argument.length > MAX_COMMAND_ARGUMENT_CHARS ||
        !COMMAND_ARGUMENT_EXPRESSION.test(argument),
    ) ||
    input.args.reduce((total, argument) => total + argument.length, 0) >
      MAX_TOTAL_ARGUMENT_CHARS
  ) {
    throw new Error("command args exceed the bounded explicit argv contract");
  }
  if (input.runtime === "shell" && input.args.length !== 1) {
    throw new Error("shell runtime requires exactly one explicit script");
  }
  if (
    input.cwd !== undefined &&
    (!input.cwd ||
      path.isAbsolute(input.cwd) ||
      input.cwd.length > 500 ||
      !COMMAND_PATH_EXPRESSION.test(input.cwd))
  ) {
    throw new Error("command cwd must be workspace-relative");
  }
  if (
    input.timeoutMs !== undefined &&
    (!Number.isSafeInteger(input.timeoutMs) ||
      input.timeoutMs < MIN_COMMAND_TIMEOUT_MS ||
      input.timeoutMs > MAX_COMMAND_TIMEOUT_MS)
  ) {
    throw new Error(
      `command timeoutMs must be ${MIN_COMMAND_TIMEOUT_MS}-${MAX_COMMAND_TIMEOUT_MS}`,
    );
  }
}
