import { once } from "node:events";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { Writable } from "node:stream";

import type { RunEvent, RunRecord, StreamFrame } from "@napier/contracts";
import {
  createLocalAgentRuntime,
  hashEventStream,
  streamRunDoneFrame,
  streamRunErrorFrame,
  streamSnapshotFrame,
  type LocalAgentRuntimeOptions,
  type LocalAgentRuntimeServices,
} from "@napier/runtime";

import {
  CLI_HELP,
  CLI_VERSION,
  parseCliArgs,
  type CliAction,
  type CliExecutionOptions,
  type CliResumeOptions,
  type CliRunOptions,
} from "./cli-options.js";
import { OrderedEventFrameWriter } from "./ordered-event-frame-writer.js";

export { CLI_HELP, CLI_VERSION, parseCliArgs };

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
      await writeLine(io.stderr, "Run `napier --help` for usage.");
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
  return action.kind === "run"
    ? executeRun(action.options, io, dependencies, parentSignal)
    : executeResume(action.options, io, dependencies, parentSignal);
}

async function executeRun(
  options: CliRunOptions,
  io: CliIo,
  dependencies: RunCliDependencies,
  parentSignal?: AbortSignal,
): Promise<number> {
  return executeInvocation(
    options,
    io,
    dependencies,
    parentSignal,
    options.threadId ?? "thread_cli_preflight",
    async (services) => {
      const thread = options.threadId
        ? existingThread(services, options)
        : await newThread(services, options);
      return {
        threadId: thread.id,
        invoke: (signal, onEvent) =>
          services.runtime.runPrompt({
            threadId: thread.id,
            text: options.prompt,
            ...(options.model ? { model: options.model } : {}),
            signal,
            ...(onEvent ? { onEvent } : {}),
          }),
      };
    },
  );
}

async function executeResume(
  options: CliResumeOptions,
  io: CliIo,
  dependencies: RunCliDependencies,
  parentSignal?: AbortSignal,
): Promise<number> {
  return executeInvocation(
    options,
    io,
    dependencies,
    parentSignal,
    options.threadId,
    (services) => {
      services.store.getThread(options.threadId);
      return {
        threadId: options.threadId,
        invoke: (signal, onEvent) =>
          services.runtime.resumeInterruptedRun({
            threadId: options.threadId,
            ...(options.runId ? { runId: options.runId } : {}),
            ...(options.model ? { model: options.model } : {}),
            signal,
            ...(onEvent ? { onEvent } : {}),
          }),
      };
    },
  );
}

interface PreparedCliInvocation {
  threadId: string;
  invoke(
    signal: AbortSignal,
    onEvent?: (event: RunEvent) => Promise<void>,
  ): Promise<RunRecord>;
}

async function executeInvocation(
  options: CliExecutionOptions,
  io: CliIo,
  dependencies: RunCliDependencies,
  parentSignal: AbortSignal | undefined,
  initialThreadId: string,
  prepare: (
    services: LocalAgentRuntimeServices,
  ) => PreparedCliInvocation | Promise<PreparedCliInvocation>,
): Promise<number> {
  let services: LocalAgentRuntimeServices | undefined;
  let threadId = initialThreadId;
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
    const invocation = await prepare(services);
    threadId = invocation.threadId;
    const thread = services.store.getThread(threadId);
    const eventWriter = options.jsonl
      ? new OrderedEventFrameWriter(
          io.stdout,
          thread.id,
          thread.eventCount + 1,
        )
      : undefined;
    const onEvent = eventWriter
      ? async (event: RunEvent): Promise<void> => eventWriter.write(event)
      : undefined;
    const run = await invocation.invoke(controller.signal, onEvent);
    const detail = await services.store.getDetail(threadId);
    if (eventWriter) {
      await eventWriter.finish(detail.thread.eventCount);
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
