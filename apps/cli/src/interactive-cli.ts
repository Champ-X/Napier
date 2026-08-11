import path from "node:path";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

import type { RunRecord } from "@napier/contracts";
import {
  streamRunErrorFrame,
  type EmbeddedAgentExecution,
  type LocalAgentRuntimeServices,
} from "@napier/runtime";

import type { CliChatOptions } from "./cli-chat-options.js";
import { cliErrorFrame } from "./cli-public-error.js";
import { configureCliModelCredential } from "./cli-model-credential.js";
import {
  activeCliAgent,
  assertCliResumeReadiness,
  assertCliRunReadiness,
  cliSandboxWarning,
  writeCliSandboxWarning,
} from "./cli-run-readiness.js";
import {
  contextualCliRunModel,
  recommendedCliRunModel,
} from "./cli-default-run-model.js";
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
import { InteractiveLineQueue } from "./interactive-line-queue.js";
import {
  TerminalBrowserInteractionConfirmationController,
  terminalBrowserInteractionConfirmationLines,
} from "./terminal-browser-confirmation.js";
import { canonicalWorkspace } from "./workspace-path.js";
import { interactiveCapabilityStatus } from "./interactive-capability-status.js";

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
  let automaticModel = options.model === undefined;
  let lastRun: RunRecord | undefined;
  let capabilities;
  let sandboxWarning: string | undefined;
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
      browserInteractionConfirmation: { available: true },
    });
    sandboxWarning = cliSandboxWarning(services.sandbox);
    await writeCliSandboxWarning(io.stderr, sandboxWarning);
    parentSignal?.throwIfAborted();
    const initialAgent = activeCliAgent(services, options.agentId, threadId);
    await configureCliModelCredential(services, options, io.env);
    model ??= await recommendedCliRunModel(services, initialAgent);
    capabilities = interactiveCapabilityStatus(
      initialAgent,
      options.capabilityPreset,
      services.browserInteractionConfirmations.available,
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
    const inputQueue = new InteractiveLineQueue();
    const confirmations = new TerminalBrowserInteractionConfirmationController(
      services.browserInteractionConfirmations,
    );
    const submitConfirmation = async (line: string): Promise<void> => {
      const result = await confirmations.submit(line);
      if (result === "invalid") {
        await writeLine(
          io.stderr,
          "[confirm] Type approve or reject; Ctrl-C cancels the Run.",
        );
      } else if (result === "settling") {
        await writeLine(io.stderr, "[confirm] Decision is already settling.");
      } else if (result === "failed") {
        await writeLine(
          io.stderr,
          "[confirm] Decision failed closed; cancelling the Run.",
        );
        activeController?.abort();
      }
    };
    inputLoop.on("line", (line) => {
      if (confirmations.hasPending()) {
        void submitConfirmation(line).catch(() => activeController?.abort());
      } else {
        inputQueue.push(line);
      }
    });
    inputLoop.once("close", () => {
      inputQueue.close();
      if (confirmations.hasPending()) activeController?.abort();
    });
    const renderEvent = async (
      event: Parameters<typeof renderer.render>[0],
    ) => {
      const confirmation = confirmations.applyEvent(event);
      if (!confirmation) {
        await renderer.render(event);
        return;
      }
      if (confirmation.status !== "pending") {
        await writeLine(
          io.stderr,
          `[confirm] Browser ${confirmation.action} ${confirmation.status}`,
        );
        return;
      }
      for (const line of terminalBrowserInteractionConfirmationLines(
        confirmation,
      )) {
        await writeLine(io.stderr, line);
      }
      await prompt(inputLoop, io.stderr, terminal, threadId, "confirm> ");
    };
    unsubscribeInterrupt = io.subscribeInterrupt?.(interrupt);
    parentSignal?.addEventListener("abort", parentAbort, { once: true });
    if (parentSignal?.aborted) parentAbort();
    await writeLine(
      io.stderr,
      "Napier chat ready. Type /help for commands; Ctrl-C cancels an active Run.",
    );
    await prompt(inputLoop, io.stderr, terminal, threadId);

    while (true) {
      const input = await inputQueue.next();
      if (input.done) break;
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
              interactiveStatusLine(
                threadId,
                model,
                lastRun,
                capabilities,
                sandboxWarning,
              ),
            );
          } else if (command.kind === "model_show") {
            await writeLine(
              io.stderr,
              `Model: ${interactiveModelLabel(model)}`,
            );
          } else if (command.kind === "model_default") {
            automaticModel = true;
            model = await recommendedCliRunModel(
              services,
              activeCliAgent(services, options.agentId, threadId),
            );
            await writeLine(
              io.stderr,
              `Model: ${interactiveModelLabel(model)}`,
            );
          } else if (command.kind === "model_set") {
            automaticModel = false;
            model = command.model;
            await writeLine(
              io.stderr,
              `Model: ${interactiveModelLabel(model)}`,
            );
          } else if (command.kind === "thread") {
            threadId = command.threadId;
            nextTitle = undefined;
            lastRun = undefined;
            capabilities = interactiveCapabilityStatus(
              activeCliAgent(services, undefined, threadId),
              options.capabilityPreset,
              services.browserInteractionConfirmations.available,
            );
            model = await contextualCliRunModel(
              services,
              activeCliAgent(services, undefined, threadId),
              automaticModel,
              model,
            );
            await writeLine(io.stderr, `Thread: ${threadId}`);
          } else if (command.kind === "new") {
            nextTitle = command.title;
            threadId = undefined;
            lastRun = undefined;
            capabilities = interactiveCapabilityStatus(
              activeCliAgent(services, options.agentId, undefined),
              options.capabilityPreset,
              services.browserInteractionConfirmations.available,
            );
            model = await contextualCliRunModel(
              services,
              activeCliAgent(services, options.agentId, undefined),
              automaticModel,
              model,
            );
            await writeLine(
              io.stderr,
              `Thread: new${nextTitle ? ` (${nextTitle})` : ""}`,
            );
          } else if (command.kind === "resume") {
            await writeCliSandboxWarning(io.stderr, sandboxWarning);
            const execution = await invoke(
              options.timeoutMs,
              sessionController.signal,
              async (signal) => {
                await assertCliResumeReadiness(
                  services!,
                  threadId!,
                  command.runId,
                  signal,
                  dependencies.runReadiness,
                );
                return services!.embeddedAgents.resume({
                  threadId: threadId!,
                  ...(command.runId ? { runId: command.runId } : {}),
                  ...(model ? { model } : {}),
                  signal,
                  onEvent: renderEvent,
                });
              },
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
        await writeCliSandboxWarning(io.stderr, sandboxWarning);
        const execution = await invoke(
          options.timeoutMs,
          sessionController.signal,
          async (signal) => {
            await assertCliRunReadiness(
              services!,
              activeCliAgent(services!, options.agentId, threadId),
              options.capabilityPreset,
              signal,
              dependencies.runReadiness,
            );
            return services!.embeddedAgents.run({
              prompt: text,
              ...(threadId ? { threadId } : {}),
              ...(options.agentId ? { agentId: options.agentId } : {}),
              ...(!threadId && nextTitle ? { title: nextTitle } : {}),
              ...(model ? { model } : {}),
              ...(options.capabilityPreset
                ? { capabilityPreset: options.capabilityPreset }
                : {}),
              signal,
              onEvent: renderEvent,
            });
          },
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
          capabilities = interactiveCapabilityStatus(
            activeCliAgent(services, undefined, threadId),
            options.capabilityPreset,
            services.browserInteractionConfirmations.available,
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
      const frame = cliErrorFrame(threadId ?? "thread_cli_interactive", error);
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
  overrideLabel?: string,
): Promise<void> {
  const label =
    overrideLabel ??
    (threadId ? `napier:${threadId.slice(-8)}> ` : "napier:new> ");
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
