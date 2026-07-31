import path from "node:path";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

import type { ModelRef, RunRecord } from "@napier/contracts";
import {
  streamRunErrorFrame,
  type EmbeddedAgentExecution,
  type LocalAgentRuntimeServices,
} from "@napier/runtime";

import type { CliChatOptions } from "./cli-chat-options.js";
import { parseCliModelRef } from "./cli-option-values.js";
import { writeLine, writeText } from "./cli-output.js";
import type { CliIo, RunCliDependencies } from "./cli.js";
import {
  InteractiveEventRenderer,
  InteractiveOutputError,
} from "./interactive-renderer.js";
import { canonicalWorkspace } from "./workspace-path.js";

const MAX_INTERACTIVE_LINE_BYTES = 64 * 1_024;
const RESOURCE_ID = /^[a-z][a-z0-9_]{2,80}$/u;
const RUN_ID = /^run_[a-z0-9_-]{8,80}$/u;
const INTERRUPT_DEBOUNCE_MS = 100;

export const INTERACTIVE_HELP = [
  "Interactive commands:",
  "  /status                Show current Thread, model, and last Run",
  "  /model                 Show the current model",
  "  /model <provider/id>   Switch model for later turns",
  "  /model default         Use the Agent's configured default model",
  "  /thread <thread-id>    Continue another existing Thread",
  "  /new [title]           Start a new Thread on the next prompt",
  "  /resume [run-id]       Resume an interrupted Run on the current Thread",
  "  /help                  Show these commands",
  "  /exit                  Close the interactive session",
  "  //text                 Send a prompt beginning with '/'",
  "  Ctrl-C                 Cancel the active Run, or exit while idle",
].join("\n");

export async function executeInteractive(
  options: CliChatOptions,
  io: CliIo,
  dependencies: RunCliDependencies,
  parentSignal?: AbortSignal,
): Promise<number> {
  if (!io.stdin || !streamIsTty(io.stdin)) {
    await writeLine(
      io.stderr,
      "Napier chat requires an interactive TTY; use run --jsonl or rpc for piped automation.",
    );
    return 2;
  }

  const terminal = streamIsTty(io.stderr);
  let readline: ReturnType<typeof createInterface> | undefined;
  let unsubscribeInterrupt: (() => void) | undefined;
  const sessionController = new AbortController();
  let activeController: AbortController | undefined;
  let idleInterrupted = false;
  let parentAborted = false;
  let exitRequested = false;
  let lastInterruptAt = 0;
  const interrupt = (): void => {
    const now = Date.now();
    if (now - lastInterruptAt < INTERRUPT_DEBOUNCE_MS) return;
    lastInterruptAt = now;
    if (activeController && !activeController.signal.aborted) {
      activeController.abort();
      void writeLine(io.stderr, "^C cancelling active Run").catch(
        () => undefined,
      );
      return;
    }
    idleInterrupted = true;
    exitRequested = true;
    sessionController.abort();
    readline?.close();
  };
  const parentAbort = (): void => {
    parentAborted = true;
    exitRequested = true;
    sessionController.abort();
    activeController?.abort();
    readline?.close();
  };

  let services: LocalAgentRuntimeServices | undefined;
  let threadId = options.threadId;
  let nextTitle = options.title;
  let model = options.model;
  let lastRun: RunRecord | undefined;
  const renderer = new InteractiveEventRenderer(io.stdout, io.stderr);
  try {
    parentSignal?.throwIfAborted();
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
    parentSignal?.throwIfAborted();
    const inputLoop = createInterface({
      input: io.stdin,
      ...(terminal ? { output: io.stderr } : {}),
      terminal,
      crlfDelay: Number.POSITIVE_INFINITY,
      historySize: 100,
      removeHistoryDuplicates: true,
    });
    readline = inputLoop;
    inputLoop.on("SIGINT", interrupt);
    const inputIterator = inputLoop[Symbol.asyncIterator]();
    let nextInput = inputIterator.next();
    unsubscribeInterrupt = io.subscribeInterrupt?.(interrupt);
    parentSignal?.addEventListener("abort", parentAbort, { once: true });
    if (parentSignal?.aborted) parentAbort();
    await writeLine(
      io.stderr,
      "Napier chat ready. Type /help for commands; Ctrl-C cancels an active Run.",
    );
    await prompt(inputLoop, io.stderr, terminal, threadId);

    while (true) {
      const input = await nextInput;
      if (input.done) break;
      nextInput = inputIterator.next();
      const rawLine = input.value;
      if (exitRequested || sessionController.signal.aborted) break;
      const trimmedLine = rawLine.trim();
      if (!trimmedLine) {
        await prompt(inputLoop, io.stderr, terminal, threadId);
        continue;
      }
      if (Buffer.byteLength(rawLine, "utf8") > MAX_INTERACTIVE_LINE_BYTES) {
        await writeLine(
          io.stderr,
          `Interactive input exceeds ${MAX_INTERACTIVE_LINE_BYTES} UTF-8 bytes.`,
        );
        await prompt(inputLoop, io.stderr, terminal, threadId);
        continue;
      }
      if (rawLine.startsWith("/") && !rawLine.startsWith("//")) {
        const command = parseCommand(rawLine);
        if (command.name === "exit") {
          if (command.argument) {
            await commandError(io.stderr, "/exit accepts no arguments");
          } else {
            exitRequested = true;
            break;
          }
        } else if (command.name === "help") {
          if (command.argument) {
            await commandError(io.stderr, "/help accepts no arguments");
          } else {
            await writeLine(io.stderr, INTERACTIVE_HELP);
          }
        } else if (command.name === "status") {
          if (command.argument) {
            await commandError(io.stderr, "/status accepts no arguments");
          } else {
            await writeLine(io.stderr, statusLine(threadId, model, lastRun));
          }
        } else if (command.name === "model") {
          if (!command.argument) {
            await writeLine(io.stderr, `Model: ${modelLabel(model)}`);
          } else if (command.argument === "default") {
            model = undefined;
            await writeLine(io.stderr, "Model: agent default");
          } else {
            try {
              model = parseCliModelRef(command.argument);
              await writeLine(io.stderr, `Model: ${modelLabel(model)}`);
            } catch {
              await commandError(
                io.stderr,
                "/model requires provider/model-id or default",
              );
            }
          }
        } else if (command.name === "thread") {
          if (!command.argument || !RESOURCE_ID.test(command.argument)) {
            await commandError(io.stderr, "/thread requires a valid Thread ID");
          } else {
            threadId = command.argument;
            nextTitle = undefined;
            lastRun = undefined;
            await writeLine(io.stderr, `Thread: ${threadId}`);
          }
        } else if (command.name === "new") {
          try {
            nextTitle = interactiveTitle(command.argument);
            threadId = undefined;
            lastRun = undefined;
            await writeLine(
              io.stderr,
              `Thread: new${nextTitle ? ` (${nextTitle})` : ""}`,
            );
          } catch {
            await commandError(
              io.stderr,
              "/new title must be 1-160 safe characters",
            );
          }
        } else if (command.name === "resume") {
          if (!threadId) {
            await commandError(io.stderr, "/resume requires a current Thread");
          } else if (command.argument && !RUN_ID.test(command.argument)) {
            await commandError(io.stderr, "/resume Run ID is invalid");
          } else {
            const execution = await invoke(
              options.timeoutMs,
              sessionController.signal,
              (signal) =>
                services!.embeddedAgents.resume({
                  threadId: threadId!,
                  ...(command.argument ? { runId: command.argument } : {}),
                  ...(model ? { model } : {}),
                  signal,
                  onEvent: (event) => renderer.render(event),
                }),
              (controller) => {
                activeController = controller;
              },
              () => {
                activeController = undefined;
              },
              renderer,
              io.stderr,
              threadId,
            );
            if (execution) {
              threadId = execution.threadId;
              lastRun = execution.run;
            }
          }
        } else {
          await commandError(
            io.stderr,
            `Unknown interactive command: /${command.name}`,
          );
        }
      } else {
        const text = rawLine.startsWith("//") ? rawLine.slice(1) : rawLine;
        const execution = await invoke(
          options.timeoutMs,
          sessionController.signal,
          (signal) =>
            services!.embeddedAgents.run({
              prompt: text,
              ...(threadId ? { threadId } : {}),
              ...(options.agentId ? { agentId: options.agentId } : {}),
              ...(!threadId && nextTitle ? { title: nextTitle } : {}),
              ...(model ? { model } : {}),
              signal,
              onEvent: (event) => renderer.render(event),
            }),
          (controller) => {
            activeController = controller;
          },
          () => {
            activeController = undefined;
          },
          renderer,
          io.stderr,
          threadId,
        );
        if (execution) {
          threadId = execution.threadId;
          nextTitle = undefined;
          lastRun = execution.run;
        }
      }
      if (!exitRequested && !sessionController.signal.aborted) {
        await prompt(inputLoop, io.stderr, terminal, threadId);
      }
    }
    return parentAborted ? 1 : idleInterrupted ? 130 : 0;
  } catch (error) {
    const frame = streamRunErrorFrame(
      threadId ?? "thread_cli_interactive",
      error,
    );
    await renderer.fail().catch(() => undefined);
    await writeLine(
      io.stderr,
      `Napier chat failed: ${frame.message} (${frame.diagnosticSha256.slice(0, 12)})`,
    ).catch(() => undefined);
    return 1;
  } finally {
    unsubscribeInterrupt?.();
    parentSignal?.removeEventListener("abort", parentAbort);
    readline?.removeListener("SIGINT", interrupt);
    readline?.close();
    await services?.shutdown().catch(() => undefined);
  }
}

async function invoke(
  timeoutMs: number,
  sessionSignal: AbortSignal,
  operation: (signal: AbortSignal) => Promise<EmbeddedAgentExecution>,
  started: (controller: AbortController) => void,
  finished: () => void,
  renderer: InteractiveEventRenderer,
  stderr: Writable,
  threadId: string | undefined,
): Promise<EmbeddedAgentExecution | undefined> {
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  sessionSignal.addEventListener("abort", abort, { once: true });
  if (sessionSignal.aborted) controller.abort();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  started(controller);
  try {
    const execution = await operation(controller.signal);
    clearTimeout(timeout);
    if (timedOut) {
      await writeLine(stderr, `Napier turn timed out after ${timeoutMs} ms.`);
    }
    await renderer.finish(execution);
    return execution;
  } catch (error) {
    if (error instanceof InteractiveOutputError) throw error;
    await renderer.fail();
    if (timedOut) {
      await writeLine(stderr, `Napier turn timed out after ${timeoutMs} ms.`);
    } else {
      const frame = streamRunErrorFrame(
        threadId ?? "thread_cli_interactive",
        error,
      );
      await writeLine(
        stderr,
        `Napier turn failed: ${frame.message} (${frame.diagnosticSha256.slice(0, 12)})`,
      );
    }
    return undefined;
  } finally {
    clearTimeout(timeout);
    sessionSignal.removeEventListener("abort", abort);
    finished();
  }
}

async function prompt(
  readline: ReturnType<typeof createInterface>,
  stderr: Writable,
  terminal: boolean,
  threadId: string | undefined,
): Promise<void> {
  const label = threadId ? `napier:${threadId.slice(-8)}> ` : "napier:new> ";
  if (terminal) {
    readline.setPrompt(label);
    readline.prompt();
  } else {
    await writeText(stderr, label);
  }
}

function parseCommand(line: string): { name: string; argument?: string } {
  const separator = line.search(/\s/u);
  const name = line
    .slice(1, separator < 0 ? undefined : separator)
    .toLowerCase();
  const argument =
    separator < 0 ? undefined : line.slice(separator + 1).trim() || undefined;
  return { name, ...(argument ? { argument } : {}) };
}

function interactiveTitle(input: string | undefined): string | undefined {
  if (input === undefined) return undefined;
  const title = input.replace(/\s+/gu, " ").trim();
  if (!title || title.length > 160 || /[\u0000-\u001f\u007f<>]/u.test(title)) {
    throw new Error("Interactive title is invalid");
  }
  return title;
}

function statusLine(
  threadId: string | undefined,
  model: ModelRef | undefined,
  run: RunRecord | undefined,
): string {
  return [
    `Thread: ${threadId ?? "new"}`,
    `Model: ${modelLabel(model)}`,
    `Last Run: ${run ? `${run.id} ${run.status}` : "none"}`,
  ].join(" | ");
}

function modelLabel(model: ModelRef | undefined): string {
  return model ? `${model.provider}/${model.id}` : "agent default";
}

async function commandError(stderr: Writable, message: string): Promise<void> {
  await writeLine(stderr, `Interactive command error: ${message}`);
}

function streamIsTty(stream: Readable | Writable): boolean {
  return (stream as Readable & { isTTY?: boolean }).isTTY === true;
}
