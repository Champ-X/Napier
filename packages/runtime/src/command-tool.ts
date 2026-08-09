import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { JsonValue } from "@napier/contracts";
import { Type } from "typebox";

import {
  COMMAND_ARGUMENT_PATTERN,
  CommandRunner,
  MAX_COMMAND_ARGUMENT_CHARS,
  MAX_COMMAND_ARGUMENTS,
  MAX_COMMAND_TIMEOUT_MS,
  MIN_COMMAND_TIMEOUT_MS,
  type CommandExecutionDetails,
  type CommandExecutionResult,
  type CommandRunnerOptions,
} from "./command-execution.js";
import { canonicalJson, sha256 } from "./ed25519.js";

const commandSchema = Type.Object(
  {
    runtime: Type.Literal("node"),
    args: Type.Array(
      Type.String({
        maxLength: MAX_COMMAND_ARGUMENT_CHARS,
        pattern: COMMAND_ARGUMENT_PATTERN,
      }),
      {
        maxItems: MAX_COMMAND_ARGUMENTS,
      },
    ),
    cwd: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 500,
        pattern: COMMAND_ARGUMENT_PATTERN,
      }),
    ),
    timeoutMs: Type.Optional(
      Type.Integer({
        minimum: MIN_COMMAND_TIMEOUT_MS,
        maximum: MAX_COMMAND_TIMEOUT_MS,
      }),
    ),
  },
  { additionalProperties: false },
);

export function createCommandTool(
  options: CommandRunnerOptions,
): AgentTool<typeof commandSchema, CommandExecutionDetails> {
  const runner = new CommandRunner(options);
  return {
    name: "run_command",
    label: "Run command",
    description:
      "Run Node with literal argv (no shell/interpolation/env expansion) in a bounded OS sandbox. Optional workspace-relative cwd defaults root; timeoutMs bounds wall time. Workspace is read-only/offline, inherited env denied, output capped.",
    parameters: commandSchema,
    async execute(_toolCallId, input, signal) {
      const result = await runner.run(input, signal);
      return {
        content: [
          {
            type: "text",
            text: formatCommandResult(result),
          },
        ],
        details: result.details,
      };
    },
  };
}

export function commandToolCallArgumentsLedgerProjection(
  args: unknown,
): JsonValue {
  const record =
    args && typeof args === "object" && !Array.isArray(args)
      ? (args as Record<string, unknown>)
      : undefined;
  const runtime =
    record?.["runtime"] === "node" ? record["runtime"] : "unknown";
  const argumentCount = Array.isArray(record?.["args"])
    ? record["args"].length
    : 0;
  const cwd = typeof record?.["cwd"] === "string" ? record["cwd"] : ".";
  return {
    kind: "napier.redacted-tool-arguments",
    schemaVersion: 1,
    redacted: true,
    runtime,
    argumentCount,
    cwdPathSha256: sha256(cwd),
    inputSha256: commandCallSha256(args),
  };
}

export function commandToolInputLedgerProjection(
  args: unknown,
): Record<string, JsonValue> {
  return {
    inputSha256: commandCallSha256(args),
    inputRedacted: true,
  };
}

export function commandToolOutputLedgerProjection(
  output: string,
  result: unknown,
): Record<string, JsonValue> {
  const details =
    result &&
    typeof result === "object" &&
    "details" in result &&
    result.details &&
    typeof result.details === "object" &&
    !Array.isArray(result.details)
      ? (result.details as Record<string, unknown>)
      : undefined;
  const resultSha256 =
    typeof details?.["resultSha256"] === "string" &&
    /^[a-f0-9]{64}$/u.test(details["resultSha256"])
      ? details["resultSha256"]
      : undefined;
  return {
    outputSha256: sha256(output),
    outputBytes: Buffer.byteLength(output, "utf8"),
    outputRedacted: true,
    ...(resultSha256 ? { resultSha256 } : {}),
  };
}

function commandCallSha256(args: unknown): string {
  return sha256(canonicalJson({ toolName: "run_command", args }));
}

function formatCommandResult(result: CommandExecutionResult): string {
  const { details } = result;
  return [
    `Command ${details.status.toUpperCase()}: ${details.runtime}`,
    `Sandbox: ${details.sandbox}`,
    "Workspace: read-only",
    "Network: denied",
    `Command SHA-256: ${details.commandSha256}`,
    `Arguments: ${details.argumentCount} / ${details.argumentSetSha256}`,
    `Executable SHA-256: ${details.executableSha256}`,
    `Exit: ${String(details.exitCode)} / ${String(details.signal)}`,
    `Duration: ${details.durationMs} ms`,
    `stdout SHA-256: ${details.stdoutSha256}`,
    `stderr SHA-256: ${details.stderrSha256}`,
    "",
    "STDOUT",
    result.stdout || "(empty)",
    "",
    "STDERR",
    result.stderr || "(empty)",
  ].join("\n");
}
