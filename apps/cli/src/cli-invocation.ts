import path from "node:path";

import type { RunEvent, RunRecord } from "@napier/contracts";
import {
  hashEventStream,
  streamRunDoneFrame,
  streamSnapshotFrame,
  type LocalAgentRuntimeServices,
} from "@napier/runtime";

import type { CliExecutionOptions } from "./cli-execution-options.js";
import { cliErrorFrame } from "./cli-public-error.js";
import {
  OneShotBrowserInteractionConfirmation,
  oneShotBrowserConfirmationAvailable,
} from "./one-shot-browser-confirmation.js";
import { OrderedEventFrameWriter } from "./ordered-event-frame-writer.js";
import { writeJsonLine, writeLine } from "./cli-output.js";
import type { CliIo, RunCliDependencies } from "./cli-runtime.js";
import { canonicalWorkspace } from "./workspace-path.js";

export interface PreparedCliInvocation {
  threadId: string;
  invoke(
    signal: AbortSignal,
    onEvent?: (event: RunEvent) => Promise<void>,
  ): Promise<RunRecord>;
}

export async function executeCliInvocation(
  options: CliExecutionOptions,
  io: CliIo,
  dependencies: RunCliDependencies,
  parentSignal: AbortSignal | undefined,
  initialThreadId: string,
  browserInteractionConfirmation: boolean,
  prepare: (
    services: LocalAgentRuntimeServices,
  ) => PreparedCliInvocation | Promise<PreparedCliInvocation>,
): Promise<number> {
  let services: LocalAgentRuntimeServices | undefined;
  let confirmation: OneShotBrowserInteractionConfirmation | undefined;
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
    const confirmationInput =
      browserInteractionConfirmation &&
      oneShotBrowserConfirmationAvailable(io.stdin, options.jsonl)
        ? io.stdin
        : undefined;
    services = await dependencies.createRuntime({
      workspaceRoot,
      dataRoot,
      env: io.env,
      ...(confirmationInput
        ? { browserInteractionConfirmation: { available: true } }
        : {}),
    });
    const invocation = await prepare(services);
    threadId = invocation.threadId;
    const thread = services.store.getThread(threadId);
    const eventWriter = options.jsonl
      ? new OrderedEventFrameWriter(io.stdout, thread.id, thread.eventCount + 1)
      : undefined;
    confirmation = confirmationInput
      ? new OneShotBrowserInteractionConfirmation(
          confirmationInput,
          io.stderr,
          services.browserInteractionConfirmations,
          () => controller.abort(),
        )
      : undefined;
    const onEvent =
      eventWriter || confirmation
        ? async (event: RunEvent): Promise<void> => {
            await eventWriter?.write(event);
            await confirmation?.handleEvent(event);
          }
        : undefined;
    const run = await invocation.invoke(controller.signal, onEvent);
    const detail = await services.store.getDetail(threadId);
    if (eventWriter) {
      await eventWriter.finish(detail.thread.eventCount, detail.events);
      const snapshot = streamSnapshotFrame(detail);
      await writeJsonLine(io.stdout, snapshot);
      await writeJsonLine(
        io.stdout,
        streamRunDoneFrame(
          threadId,
          run.id,
          run.status,
          snapshot.detailSha256,
          snapshot.detailBytes,
          snapshot.detail.thread.eventCount,
          snapshot.eventBytes,
          hashEventStream(snapshot.detail.events),
        ),
      );
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
    const frame = cliErrorFrame(threadId, error);
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
    await confirmation?.close().catch(() => undefined);
    await services?.shutdown().catch(() => undefined);
  }
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
