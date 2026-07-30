import type { ModelRef } from "@napier/contracts";

export const CLI_VERSION = "0.1.0";
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 30 * 60 * 1_000;
const MAX_PROMPT_BYTES = 64 * 1_024;
const MAX_TITLE_CHARS = 160;
const RESOURCE_ID = /^[a-z][a-z0-9_]{2,80}$/u;

export interface CliExecutionOptions {
  workspace: string;
  dataRoot?: string;
  model?: ModelRef;
  timeoutMs: number;
  jsonl: boolean;
}

export interface CliRunOptions extends CliExecutionOptions {
  prompt: string;
  agentId?: string;
  threadId?: string;
  title?: string;
}

export interface CliResumeOptions extends CliExecutionOptions {
  threadId: string;
  runId?: string;
}

export type CliAction =
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "run"; options: CliRunOptions }
  | { kind: "resume"; options: CliResumeOptions };

const RUN_VALUE_OPTIONS = new Set([
  "--workspace",
  "--data-root",
  "--prompt",
  "--model",
  "--agent",
  "--thread",
  "--title",
  "--timeout-ms",
]);
const RESUME_VALUE_OPTIONS = new Set([
  "--workspace",
  "--data-root",
  "--model",
  "--thread",
  "--run",
  "--timeout-ms",
]);

export function parseCliArgs(argv: string[]): CliAction {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    return { kind: "help" };
  }
  if (argv[0] === "--version" || argv[0] === "-v") {
    if (argv.length !== 1) throw new Error("--version accepts no arguments");
    return { kind: "version" };
  }
  const command = argv[0];
  if (command !== "run" && command !== "resume") {
    throw new Error("Unknown command");
  }
  if (argv.length === 2 && (argv[1] === "--help" || argv[1] === "-h")) {
    return { kind: "help" };
  }
  const { values, jsonl } = parseOptions(
    argv.slice(1),
    command === "run" ? RUN_VALUE_OPTIONS : RESUME_VALUE_OPTIONS,
  );
  return command === "run"
    ? parseRunOptions(values, jsonl)
    : parseResumeOptions(values, jsonl);
}

function parseRunOptions(
  values: Map<string, string>,
  jsonl: boolean,
): Extract<CliAction, { kind: "run" }> {
  const workspace = requiredValue(values, "--workspace");
  const prompt = requiredValue(values, "--prompt");
  if (Buffer.byteLength(prompt, "utf8") > MAX_PROMPT_BYTES) {
    throw new Error(`--prompt exceeds ${MAX_PROMPT_BYTES} UTF-8 bytes`);
  }
  const threadId = optionalResourceId(values, "--thread");
  const agentId = optionalResourceId(values, "--agent");
  if (threadId && values.has("--title")) {
    throw new Error("--title cannot be used with an existing --thread");
  }
  const rawTitle = values.get("--title");
  const title = rawTitle?.trim();
  if (rawTitle !== undefined && (!title || title.length > MAX_TITLE_CHARS)) {
    throw new Error(`--title must be 1-${MAX_TITLE_CHARS} characters`);
  }
  const model = optionalModelRef(values);
  return {
    kind: "run",
    options: {
      workspace,
      prompt,
      timeoutMs: parseTimeout(values.get("--timeout-ms")),
      jsonl,
      ...(values.has("--data-root")
        ? { dataRoot: requiredValue(values, "--data-root") }
        : {}),
      ...(model ? { model } : {}),
      ...(agentId ? { agentId } : {}),
      ...(threadId ? { threadId } : {}),
      ...(title ? { title } : {}),
    },
  };
}

function parseResumeOptions(
  values: Map<string, string>,
  jsonl: boolean,
): Extract<CliAction, { kind: "resume" }> {
  const model = optionalModelRef(values);
  const runId = optionalResourceId(values, "--run");
  return {
    kind: "resume",
    options: {
      workspace: requiredValue(values, "--workspace"),
      threadId: requiredResourceId(values, "--thread"),
      timeoutMs: parseTimeout(values.get("--timeout-ms")),
      jsonl,
      ...(values.has("--data-root")
        ? { dataRoot: requiredValue(values, "--data-root") }
        : {}),
      ...(model ? { model } : {}),
      ...(runId ? { runId } : {}),
    },
  };
}

function parseOptions(
  argv: string[],
  allowedValues: ReadonlySet<string>,
): { values: Map<string, string>; jsonl: boolean } {
  const values = new Map<string, string>();
  let jsonl = false;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]!;
    if (flag === "--jsonl") {
      if (jsonl) throw new Error("Duplicate option: --jsonl");
      jsonl = true;
      continue;
    }
    if (!allowedValues.has(flag)) throw new Error("Unknown option");
    if (values.has(flag)) throw new Error(`Duplicate option: ${flag}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${flag}`);
    }
    values.set(flag, value);
    index += 1;
  }
  return { values, jsonl };
}

function requiredValue(values: Map<string, string>, flag: string): string {
  const value = values.get(flag)?.trim();
  if (!value) throw new Error(`${flag} is required`);
  return value;
}

function requiredResourceId(
  values: Map<string, string>,
  flag: string,
): string {
  const value = requiredValue(values, flag);
  if (!RESOURCE_ID.test(value)) throw new Error(`${flag} is invalid`);
  return value;
}

function optionalResourceId(
  values: Map<string, string>,
  flag: string,
): string | undefined {
  if (!values.has(flag)) return undefined;
  return requiredResourceId(values, flag);
}

function optionalModelRef(
  values: Map<string, string>,
): ModelRef | undefined {
  return values.has("--model")
    ? parseModelRef(requiredValue(values, "--model"))
    : undefined;
}

function parseTimeout(value: string | undefined): number {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  if (!/^[0-9]+$/u.test(value)) throw new Error("--timeout-ms is invalid");
  const timeoutMs = Number(value);
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < MIN_TIMEOUT_MS ||
    timeoutMs > MAX_TIMEOUT_MS
  ) {
    throw new Error(`--timeout-ms must be ${MIN_TIMEOUT_MS}-${MAX_TIMEOUT_MS}`);
  }
  return timeoutMs;
}

function parseModelRef(value: string): ModelRef {
  const separator = value.indexOf("/");
  const provider = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (
    separator < 1 ||
    !/^[a-z][a-z0-9_-]{0,63}$/u.test(provider) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u.test(id)
  ) {
    throw new Error("--model must be provider/model-id");
  }
  return { provider, id };
}

export const CLI_HELP = `Napier CLI ${CLI_VERSION}

Usage:
  napier run --workspace <path> --prompt <text> [options]
  napier resume --workspace <path> --thread <thread-id> [options]

Commands:
  run                    Start a new Run on a new or existing Thread
  resume                 Continue an interrupted Run as a linked child

Shared options:
  --data-root <path>     Napier state directory (default: <workspace>/.napier)
  --model <provider/id>  Model for this Run
  --timeout-ms <ms>      External wall-time limit (${MIN_TIMEOUT_MS}-${MAX_TIMEOUT_MS})
  --jsonl                Emit StreamFrame JSON objects on stdout

Run options:
  --prompt <text>        User prompt for the Run
  --agent <agent-id>     Agent for a new Thread
  --thread <thread-id>   Append to an existing Thread
  --title <text>         Title for a new Thread

Resume options:
  --thread <thread-id>   Waiting Thread containing an interrupted Run
  --run <run-id>         Specific interrupted Run (default: latest)

Other:
  -h, --help             Show help
  -v, --version          Show version
`;
