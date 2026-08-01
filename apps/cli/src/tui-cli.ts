import path from "node:path";
import type { Readable, Writable } from "node:stream";

import {
  streamRunErrorFrame,
  type EmbeddedAgentExecution,
  type LocalAgentRuntimeServices,
} from "@napier/runtime";

import type { CliChatOptions } from "./cli-chat-options.js";
import { writeLine } from "./cli-output.js";
import type { CliIo, RunCliDependencies } from "./cli.js";
import {
  interactiveModelLabel,
  parseInteractiveCommand,
} from "./interactive-command-model.js";
import { TuiInputController, type TuiInputAction } from "./tui-input.js";
import { TuiSessionState } from "./tui-state.js";
import { TuiOutputError, TuiTerminal } from "./tui-terminal.js";
import { canonicalWorkspace } from "./workspace-path.js";

const INTERRUPT_DEBOUNCE_MS = 100;

type RawTtyInput = Readable & {
  isTTY?: boolean;
  isRaw?: boolean;
  setRawMode?(enabled: boolean): void;
};

type ResizeOutput = Writable & {
  isTTY?: boolean;
  on(event: "resize", listener: () => void): ResizeOutput;
  removeListener(event: "resize", listener: () => void): ResizeOutput;
};

export async function executeTui(
  options: CliChatOptions,
  io: CliIo,
  dependencies: RunCliDependencies,
  parentSignal?: AbortSignal,
): Promise<number> {
  const input = io.stdin as RawTtyInput | undefined;
  const output = io.stdout as ResizeOutput;
  if (
    !input ||
    input.isTTY !== true ||
    output.isTTY !== true ||
    typeof input.setRawMode !== "function"
  ) {
    await writeLine(
      io.stderr,
      "Napier tui requires interactive stdin/stdout TTYs with raw mode; use chat, run --jsonl, or rpc otherwise.",
    );
    return 2;
  }

  const terminal = new TuiTerminal(io.stdout);
  const state = new TuiSessionState({
    ...(options.threadId ? { threadId: options.threadId } : {}),
    ...(options.title ? { title: options.title } : {}),
    ...(options.model ? { model: options.model } : {}),
  });
  const inputController = new TuiInputController();
  const exit = deferred<number>();
  const sessionController = new AbortController();
  const previousRaw = input.isRaw === true;
  let rawModeChanged = false;
  let services: LocalAgentRuntimeServices | undefined;
  let ready = false;
  let exiting = false;
  let activeController: AbortController | undefined;
  let activePromise: Promise<void> | undefined;
  let sessionFailure: unknown;
  let lastInterruptAt = 0;

  const requestExit = (code: number): void => {
    if (exiting) return;
    exiting = true;
    sessionController.abort();
    activeController?.abort();
    exit.resolve(code);
  };
  const failSession = (error: unknown): void => {
    if (sessionFailure === undefined) sessionFailure = error;
    requestExit(1);
  };
  const render = (): Promise<void> =>
    terminal
      .render(state.snapshot(), inputController.snapshot())
      .catch((error) => {
        failSession(error);
        throw error;
      });
  const scheduleRender = (): void => {
    void render().catch(() => undefined);
  };
  const interrupt = (): void => {
    const now = Date.now();
    if (now - lastInterruptAt < INTERRUPT_DEBOUNCE_MS) return;
    lastInterruptAt = now;
    if (activeController && !activeController.signal.aborted) {
      state.cancelRequested();
      activeController.abort();
      scheduleRender();
      return;
    }
    requestExit(130);
  };
  const parentAbort = (): void => requestExit(1);
  const resize = (): void => scheduleRender();
  const end = (): void => requestExit(0);
  const data = (chunk: Buffer | string): void => {
    let actions: TuiInputAction[];
    try {
      actions = inputController.feed(chunk);
    } catch (error) {
      failSession(error);
      return;
    }
    for (const action of actions) {
      if (action.kind === "interrupt") {
        interrupt();
      } else if (action.kind === "exit") {
        if (state.snapshot().active) {
          state.setNotice("Ctrl-D exits only while idle; Ctrl-C cancels");
          scheduleRender();
        } else {
          requestExit(0);
        }
      } else if (action.kind === "scroll") {
        state.scroll(action.direction, Math.max(1, terminal.size().rows - 8));
        scheduleRender();
      } else if (action.kind === "overflow") {
        state.setNotice("Input reached the 64 KiB UTF-8 limit");
        scheduleRender();
      } else if (action.kind === "changed") {
        scheduleRender();
      } else if (action.kind === "submit") {
        void handleSubmission(action.value).catch(failSession);
      }
    }
  };

  const startOperation = (
    label: "prompt" | "resume",
    operation: (
      signal: AbortSignal,
      onEvent: NonNullable<
        Parameters<
          LocalAgentRuntimeServices["embeddedAgents"]["run"]
        >[0]["onEvent"]
      >,
    ) => Promise<EmbeddedAgentExecution>,
  ): void => {
    if (!ready || activePromise || exiting) {
      state.setNotice(
        ready
          ? "A Run is already active; Ctrl-C cancels it"
          : "Runtime is still starting",
      );
      scheduleRender();
      return;
    }
    if (label === "resume") state.beginResume();
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    sessionController.signal.addEventListener("abort", abort, { once: true });
    if (sessionController.signal.aborted) controller.abort();
    activeController = controller;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      state.setNotice(`Turn timed out after ${String(options.timeoutMs)} ms`);
      controller.abort();
      scheduleRender();
    }, options.timeoutMs);
    const current = (async () => {
      try {
        await render();
        const execution = await operation(controller.signal, async (event) => {
          if (state.applyEvent(event)) await render();
        });
        state.finish(execution);
        if (timedOut) {
          state.setNotice(
            `Turn timed out after ${String(options.timeoutMs)} ms; Run ${execution.run.status}`,
          );
        }
      } catch (error) {
        if (error instanceof TuiOutputError) {
          failSession(error);
          return;
        }
        const frame = streamRunErrorFrame(
          state.currentThreadId() ?? "thread_cli_tui",
          error,
        );
        state.fail(
          timedOut
            ? `Turn timed out after ${String(options.timeoutMs)} ms`
            : `Turn failed: ${frame.message} (${frame.diagnosticSha256.slice(0, 12)})`,
        );
      } finally {
        clearTimeout(timeout);
        sessionController.signal.removeEventListener("abort", abort);
        if (activeController === controller) activeController = undefined;
        activePromise = undefined;
        scheduleRender();
      }
    })();
    activePromise = current;
  };

  async function handleSubmission(raw: string): Promise<void> {
    if (exiting) return;
    if (!ready) {
      state.setNotice("Runtime is still starting");
      await render();
      return;
    }
    if (state.snapshot().active) {
      state.setNotice("A Run is already active; Ctrl-C cancels it");
      await render();
      return;
    }
    if (raw.startsWith("/") && !raw.startsWith("//")) {
      try {
        const command = parseInteractiveCommand(raw, state.currentThreadId());
        if (command.kind === "exit") {
          requestExit(0);
          return;
        }
        if (command.kind === "help") state.showHelp();
        else if (command.kind === "status") state.showStatus();
        else if (command.kind === "model_show") {
          state.setNotice(
            `Model: ${interactiveModelLabel(state.currentModel())}`,
          );
        } else if (command.kind === "model_default") {
          state.setModel(undefined);
        } else if (command.kind === "model_set") {
          state.setModel(command.model);
        } else if (command.kind === "thread") {
          state.setThread(command.threadId);
        } else if (command.kind === "new") {
          state.setNewThread(command.title);
        } else if (command.kind === "clear") {
          state.clearTranscript();
        } else if (command.kind === "resume") {
          startOperation("resume", (signal, onEvent) =>
            services!.embeddedAgents.resume({
              threadId: state.currentThreadId()!,
              ...(command.runId ? { runId: command.runId } : {}),
              ...(state.currentModel() ? { model: state.currentModel()! } : {}),
              signal,
              onEvent,
            }),
          );
          return;
        }
      } catch (error) {
        state.setNotice(`Command error: ${errorMessage(error)}`);
      }
      await render();
      return;
    }

    const prompt = raw.startsWith("//") ? raw.slice(1) : raw;
    state.beginPrompt(prompt);
    startOperation("prompt", (signal, onEvent) =>
      services!.embeddedAgents.run({
        prompt,
        ...(state.currentThreadId()
          ? { threadId: state.currentThreadId()! }
          : {}),
        ...(options.agentId ? { agentId: options.agentId } : {}),
        ...(!state.currentThreadId() && state.pendingTitle()
          ? { title: state.pendingTitle()! }
          : {}),
        ...(state.currentModel() ? { model: state.currentModel()! } : {}),
        signal,
        onEvent,
      }),
    );
  }

  const unsubscribeInterrupt = io.subscribeInterrupt?.(interrupt);
  try {
    parentSignal?.throwIfAborted();
    parentSignal?.addEventListener("abort", parentAbort, { once: true });
    if (parentSignal?.aborted) parentAbort();
    input.on("data", data);
    input.once("end", end);
    output.on("resize", resize);
    rawModeChanged = true;
    input.setRawMode(true);
    input.resume();
    await terminal.enter();
    state.setNotice("Starting local Runtime");
    await render();

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
    sessionController.signal.throwIfAborted();
    ready = true;
    state.setNotice("Ready; type a prompt or /help");
    await render();
    await exit.promise;
  } catch (error) {
    if (sessionFailure === undefined) sessionFailure = error;
    requestExit(1);
  } finally {
    ready = false;
    input.removeListener("data", data);
    input.removeListener("end", end);
    output.removeListener("resize", resize);
    unsubscribeInterrupt?.();
    parentSignal?.removeEventListener("abort", parentAbort);
    activeController?.abort();
    await activePromise?.catch(() => undefined);
    await services?.shutdown().catch(() => undefined);
    let restorationError: unknown;
    try {
      if (rawModeChanged) input.setRawMode(previousRaw);
    } catch (error) {
      restorationError = error;
    }
    try {
      await terminal.restore();
    } catch (error) {
      restorationError ??= error;
    }
    input.pause();
    if (restorationError !== undefined) {
      sessionFailure ??= restorationError;
    }
  }

  if (sessionFailure !== undefined) {
    const frame = streamRunErrorFrame(
      state.currentThreadId() ?? "thread_cli_tui",
      sessionFailure,
    );
    await writeLine(
      io.stderr,
      `Napier tui failed: ${frame.message} (${frame.diagnosticSha256.slice(0, 12)})`,
    ).catch(() => undefined);
    return 1;
  }
  return await exit.promise;
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value) {
      resolvePromise?.(value);
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
