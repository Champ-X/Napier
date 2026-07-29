import { once } from "node:events";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { Writable } from "node:stream";

import type { ModelRef, RunEvent, StreamFrame } from "@napier/contracts";
import {
  createLocalAgentRuntime,
  hashEventStream,
  streamEventFrame,
  streamRunDoneFrame,
  streamRunErrorFrame,
  streamSnapshotFrame,
  type LocalAgentRuntimeOptions,
  type LocalAgentRuntimeServices,
} from "@napier/runtime";

export const CLI_VERSION = "0.1.0";
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 30 * 60 * 1_000;
const MAX_PROMPT_BYTES = 64 * 1_024;
const MAX_TITLE_CHARS = 160;
const RESOURCE_ID = /^[a-z][a-z0-9_]{2,80}$/u;

export interface CliIo {
  cwd: string;
  env: Readonly<Record<string, string | undefined>>;
  stdout: Writable;
  stderr: Writable;
}

export interface RunCliDependencies {
  createRuntime(
    options: LocalAgentRuntimeOptions,
  ): Promise<LocalAgentRuntimeServices>;
}

interface CliRunOptions {
  workspace: string;
  dataRoot?: string;
  prompt: string;
  model?: ModelRef;
  agentId?: string;
  threadId?: string;
  title?: string;
  timeoutMs: number;
  jsonl: boolean;
}

type CliAction =
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "run"; options: CliRunOptions };

const DEFAULT_DEPENDENCIES: RunCliDependencies = {
  createRuntime: createLocalAgentRuntime,
};

export async function runCli(
  argv: string[],
  io: CliIo,
  dependencies: RunCliDependencies = DEFAULT_DEPENDENCIES,
  parentSignal?: AbortSignal,
): Promise<number> {
  const machineMode = argv.includes("--jsonl");
  let action: CliAction;
  try {
    action = parseCliArgs(argv);
  } catch (error) {
    const frame = streamRunErrorFrame("thread_cli_preflight", error);
    if (machineMode) {
      await writeJsonLine(io.stdout, frame);
    } else {
      await writeLine(io.stderr, `Napier CLI error: ${errorMessage(error)}`);
      await writeLine(io.stderr, "Run `napier run --help` for usage.");
    }
    return 2;
  }
  if (action.kind === "help") {
    await writeLine(io.stdout, CLI_HELP);
    return 0;
  }
  if (action.kind === "version") {
    await writeLine(io.stdout, CLI_VERSION);
    return 0;
  }
  return executeRun(action.options, io, dependencies, parentSignal);
}

async function executeRun(
  options: CliRunOptions,
  io: CliIo,
  dependencies: RunCliDependencies,
  parentSignal?: AbortSignal,
): Promise<number> {
  let services: LocalAgentRuntimeServices | undefined;
  let threadId = options.threadId ?? "thread_cli_preflight";
  const controller = new AbortController();
  const forwardAbort = (): void => controller.abort();
  parentSignal?.addEventListener("abort", forwardAbort, { once: true });
  if (parentSignal?.aborted) controller.abort();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const workspaceRoot = await canonicalWorkspace(options.workspace, io.cwd);
    const dataRoot = path.resolve(
      io.cwd,
      options.dataRoot ?? path.join(workspaceRoot, ".napier"),
    );
    services = await dependencies.createRuntime({
      workspaceRoot,
      dataRoot,
      env: io.env,
    });
    const thread = options.threadId
      ? existingThread(services, options)
      : await newThread(services, options);
    threadId = thread.id;
    const run = await services.runtime.runPrompt({
      threadId,
      text: options.prompt,
      ...(options.model ? { model: options.model } : {}),
      signal: controller.signal,
      ...(options.jsonl
        ? {
            onEvent: async (event: RunEvent) => {
              await writeJsonLine(io.stdout, streamEventFrame(event));
            },
          }
        : {}),
    });
    const detail = await services.store.getDetail(threadId);
    if (options.jsonl) {
      const snapshot = streamSnapshotFrame(detail);
      const done = streamRunDoneFrame(
        threadId,
        run.id,
        run.status,
        snapshot.detailSha256,
        snapshot.detailBytes,
        snapshot.detail.thread.eventCount,
        snapshot.eventBytes,
        hashEventStream(snapshot.detail.events),
      );
      await writeJsonLine(io.stdout, snapshot);
      await writeJsonLine(io.stdout, done);
    } else {
      const assistant = latestAssistantText(detail.events, run.id);
      if (assistant) await writeLine(io.stdout, assistant);
      await writeLine(
        io.stderr,
        `Napier run ${run.id} ${run.status} (thread ${threadId})`,
      );
    }
    return run.status === "completed" ? 0 : 1;
  } catch (error) {
    const frame = streamRunErrorFrame(threadId, error);
    if (options.jsonl) {
      await writeJsonLine(io.stdout, frame);
    } else {
      await writeLine(
        io.stderr,
        `Napier run failed: ${frame.message} (${frame.diagnosticSha256.slice(0, 12)})`,
      );
    }
    return 1;
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener("abort", forwardAbort);
    await services?.shutdown().catch(() => undefined);
  }
}

function existingThread(
  services: LocalAgentRuntimeServices,
  options: CliRunOptions,
) {
  const thread = services.store.getThread(options.threadId!);
  if (options.agentId && options.agentId !== thread.agentId) {
    throw new Error("Existing Thread Agent does not match --agent");
  }
  return thread;
}

async function newThread(
  services: LocalAgentRuntimeServices,
  options: CliRunOptions,
) {
  const agent = options.agentId
    ? services.store.getAgent(options.agentId)
    : services.store.listAgents()[0];
  if (!agent) throw new Error("No Agent profile is available");
  return services.store.createThread({
    title: options.title ?? "CLI one-shot",
    agentId: agent.id,
  });
}

async function canonicalWorkspace(
  candidate: string,
  cwd: string,
): Promise<string> {
  const workspaceRoot = await realpath(path.resolve(cwd, candidate));
  const info = await stat(workspaceRoot);
  if (!info.isDirectory()) throw new Error("CLI workspace must be a directory");
  return workspaceRoot;
}

export function parseCliArgs(argv: string[]): CliAction {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    return { kind: "help" };
  }
  if (argv[0] === "--version" || argv[0] === "-v") {
    if (argv.length !== 1) throw new Error("--version accepts no arguments");
    return { kind: "version" };
  }
  if (argv[0] !== "run") {
    throw new Error("Unknown command");
  }
  if (argv.length === 2 && (argv[1] === "--help" || argv[1] === "-h")) {
    return { kind: "help" };
  }
  const values = new Map<string, string>();
  const booleans = new Set<string>();
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index]!;
    if (flag === "--jsonl") {
      if (booleans.has(flag)) throw new Error(`Duplicate option: ${flag}`);
      booleans.add(flag);
      continue;
    }
    if (!VALUE_OPTIONS.has(flag)) throw new Error("Unknown option");
    if (values.has(flag)) throw new Error(`Duplicate option: ${flag}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${flag}`);
    }
    values.set(flag, value);
    index += 1;
  }
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
  const timeoutMs = parseTimeout(values.get("--timeout-ms"));
  const model = values.has("--model")
    ? parseModelRef(values.get("--model")!)
    : undefined;
  return {
    kind: "run",
    options: {
      workspace,
      prompt,
      timeoutMs,
      jsonl: booleans.has("--jsonl"),
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

const VALUE_OPTIONS = new Set([
  "--workspace",
  "--data-root",
  "--prompt",
  "--model",
  "--agent",
  "--thread",
  "--title",
  "--timeout-ms",
]);

function requiredValue(values: Map<string, string>, flag: string): string {
  const value = values.get(flag)?.trim();
  if (!value) throw new Error(`${flag} is required`);
  return value;
}

function optionalResourceId(
  values: Map<string, string>,
  flag: string,
): string | undefined {
  const value = values.get(flag);
  if (value === undefined) return undefined;
  if (!RESOURCE_ID.test(value)) throw new Error(`${flag} is invalid`);
  return value;
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

function latestAssistantText(events: RunEvent[], runId: string): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.runId !== runId || event.type !== "message.assistant") continue;
    if (
      event.payload &&
      !Array.isArray(event.payload) &&
      typeof event.payload === "object" &&
      typeof event.payload["text"] === "string"
    ) {
      return event.payload["text"];
    }
  }
  return "";
}

async function writeJsonLine(
  stream: Writable,
  frame: StreamFrame,
): Promise<void> {
  await writeLine(stream, JSON.stringify(frame));
}

async function writeLine(stream: Writable, text: string): Promise<void> {
  if (stream.write(`${text}\n`)) return;
  await once(stream, "drain");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const CLI_HELP = `Napier CLI ${CLI_VERSION}

Usage:
  napier run --workspace <path> --prompt <text> [options]

Options:
  --data-root <path>     Napier state directory (default: <workspace>/.napier)
  --model <provider/id>  Model for this Run
  --agent <agent-id>     Agent for a new Thread
  --thread <thread-id>   Append to an existing Thread
  --title <text>         Title for a new Thread
  --timeout-ms <ms>      External wall-time limit (${MIN_TIMEOUT_MS}-${MAX_TIMEOUT_MS})
  --jsonl                Emit StreamFrame JSON objects on stdout
  -h, --help             Show help
  -v, --version          Show version
`;
