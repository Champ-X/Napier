import path from "node:path";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

import type { RunRecord } from "@napier/contracts";
import { agentCapabilityStatus } from "@napier/contracts/agent-capabilities";
import {
  streamRunErrorFrame,
  type EmbeddedAgentExecution,
  type LocalAgentRuntimeServices,
} from "@napier/runtime";

import type { CliChatOptions } from "./cli-chat-options.js";
import { configureCliModelCredential } from "./cli-model-credential.js";
import { writeLine, writeText } from "./cli-output.js";
import type { CliIo, RunCliDependencies } from "./cli-runtime.js";
import {
  INTERACTIVE_COMMAND_HELP,
  interactiveModelLabel,
  interactiveStatusLine,
  MAX_INTERACTIVE_INPUT_BYTES,
  parseInteractiveCommand,
} from "./interactive-command-model.js";
import {
  InteractiveEventRenderer,
  InteractiveOutputError,
} from "./interactive-renderer.js";
import { canonicalWorkspace } from "./workspace-path.js";

const INTERRUPT_DEBOUNCE_MS = 100;

export const INTERACTIVE_HELP = [
  INTERACTIVE_COMMAND_HELP,
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
  let capabilities;
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
    await configureCliModelCredential(services, options, io.env);
    capabilities = agentCapabilityStatus(
      activeInteractiveAgent(services, options.agentId, threadId),
    );
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
      if (Buffer.byteLength(rawLine, "utf8") > MAX_INTERACTIVE_INPUT_BYTES) {
        await writeLine(
          io.stderr,
          `Interactive input exceeds ${MAX_INTERACTIVE_INPUT_BYTES} UTF-8 bytes.`,
        );
        await prompt(inputLoop, io.stderr, terminal, threadId);
        continue;
      }
      if (rawLine.startsWith("/") && !rawLine.startsWith("//")) {
        try {
          const command = parseInteractiveCommand(rawLine, threadId);
          if (command.kind === "exit") {
            exitRequested = true;
            break;
          }
          if (command.kind === "help") {
            await writeLine(io.stderr, INTERACTIVE_HELP);
          } else if (command.kind === "status") {
            await writeLine(
              io.stderr,
              interactiveStatusLine(threadId, model, lastRun, capabilities),
            );
          } else if (command.kind === "model_show") {
            await writeLine(
              io.stderr,
              `Model: ${interactiveModelLabel(model)}`,
            );
          } else if (command.kind === "model_default") {
            model = undefined;
            await writeLine(io.stderr, "Model: agent default");
          } else if (command.kind === "model_set") {
            model = command.model;
            await writeLine(
              io.stderr,
              `Model: ${interactiveModelLabel(model)}`,
            );
          } else if (command.kind === "thread") {
            threadId = command.threadId;
            nextTitle = undefined;
            lastRun = undefined;
            capabilities = agentCapabilityStatus(
              activeInteractiveAgent(services, undefined, threadId),
            );
            await writeLine(io.stderr, `Thread: ${threadId}`);
          } else if (command.kind === "new") {
            nextTitle = command.title;
            threadId = undefined;
            lastRun = undefined;
            capabilities = agentCapabilityStatus(
              activeInteractiveAgent(services, options.agentId, undefined),
            );
            await writeLine(
              io.stderr,
              `Thread: new${nextTitle ? ` (${nextTitle})` : ""}`,
            );
          } else if (command.kind === "resume") {
            const execution = await invoke(
              options.timeoutMs,
              sessionController.signal,
              (signal) =>
                services!.embeddedAgents.resume({
                  threadId: threadId!,
                  ...(command.runId ? { runId: command.runId } : {}),
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
          } else if (command.kind === "clear") {
            await commandError(
              io.stderr,
              "/clear is available only in napier tui",
            );
          }
        } catch (error) {
          await commandError(io.stderr, errorMessage(error));
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
          capabilities = agentCapabilityStatus(
            activeInteractiveAgent(services, undefined, threadId),
          );
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

function activeInteractiveAgent(
  services: LocalAgentRuntimeServices,
  requestedAgentId: string | undefined,
  threadId: string | undefined,
) {
  if (threadId) {
    return services.store.getAgent(services.store.getThread(threadId).agentId);
  }
  return requestedAgentId
    ? services.store.getAgent(requestedAgentId)
    : services.store.listAgents()[0]!;
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

async function commandError(stderr: Writable, message: string): Promise<void> {
  await writeLine(stderr, `Interactive command error: ${message}`);
}

function streamIsTty(stream: Readable | Writable): boolean {
  return (stream as Readable & { isTTY?: boolean }).isTTY === true;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
