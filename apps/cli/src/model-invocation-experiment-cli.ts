import path from "node:path";
import type { Writable } from "node:stream";

import type { RunEvent } from "@napier/contracts";
import {
  canonicalJson,
  createModelInvocationExperimentResultFrame,
  hashEventStream,
  streamRunErrorFrame,
  streamSnapshotFrame,
  type LocalAgentRuntimeOptions,
  type LocalAgentRuntimeServices,
} from "@napier/runtime";

import type { CliModelInvocationExperimentOptions } from "./cli-options.js";
import { writeLine } from "./cli-output.js";
import { OrderedEventFrameWriter } from "./ordered-event-frame-writer.js";
import { canonicalWorkspace } from "./workspace-path.js";

export interface ModelInvocationExperimentCliIo {
  cwd: string;
  env: Readonly<Record<string, string | undefined>>;
  stdout: Writable;
  stderr: Writable;
}

export interface ModelInvocationExperimentCliDependencies {
  createRuntime(
    options: LocalAgentRuntimeOptions,
  ): Promise<LocalAgentRuntimeServices>;
}

export async function executeModelInvocationExperimentCli(
  options: CliModelInvocationExperimentOptions,
  io: ModelInvocationExperimentCliIo,
  dependencies: ModelInvocationExperimentCliDependencies,
  parentSignal?: AbortSignal,
): Promise<number> {
  let services: LocalAgentRuntimeServices | undefined;
  let targetThreadId = options.threadId;
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
    const request = experimentRequest(options);
    if (options.preview) {
      const preview = await services.modelInvocationExperiments.preview(
        options.threadId,
        request,
        controller.signal,
      );
      await writeLine(io.stdout, JSON.stringify(preview));
      if (!options.jsonl) {
        await writeLine(
          io.stderr,
          `Napier model invocation preview ${preview.previewSha256.slice(0, 12)} (single call, no tool execution)`,
        );
      }
      return 0;
    }

    let eventWriter: OrderedEventFrameWriter | undefined;
    const experiment = await services.modelInvocationExperiments.run({
      sourceThreadId: options.threadId,
      request: {
        ...request,
        expectedPreviewSha256: options.expectedPreviewSha256!,
      },
      signal: controller.signal,
      onTargetCreated: (thread) => {
        targetThreadId = thread.id;
        if (options.jsonl) {
          eventWriter = new OrderedEventFrameWriter(
            io.stdout,
            thread.id,
            thread.eventCount + 1,
          );
        }
      },
      ...(options.jsonl
        ? {
            onEvent: async (event: RunEvent): Promise<void> => {
              if (!eventWriter) {
                throw new Error(
                  "Model invocation experiment target stream is unavailable",
                );
              }
              await eventWriter.write(event);
            },
          }
        : {}),
    });
    const detail = await services.store.getDetail(experiment.targetThreadId);
    const snapshot = streamSnapshotFrame(detail);
    const resultFrame = createModelInvocationExperimentResultFrame(
      experiment,
      snapshot,
      hashEventStream(detail.events),
    );
    if (eventWriter) {
      await eventWriter.finish(detail.thread.eventCount);
      await writeLine(io.stdout, JSON.stringify(snapshot));
      await writeLine(io.stdout, JSON.stringify(resultFrame));
    } else {
      await writeLine(
        io.stdout,
        experiment.assistantText ??
          canonicalJson({
            targetRunId: experiment.targetRunId,
            status: experiment.status,
            candidateToolCallNames: experiment.candidateToolCallNames,
            previewSha256: experiment.preview.previewSha256,
          }),
      );
      await writeLine(
        io.stderr,
        `Napier model invocation experiment ${experiment.targetRunId} ${experiment.status} (thread ${experiment.targetThreadId})`,
      );
      const delta = experiment.comparison.metricDelta;
      await writeLine(
        io.stderr,
        `Delta (target-source): ${signed(delta.durationMs)}ms, ${signed(delta.inputTokens + delta.outputTokens)} tokens, ${signed(delta.toolCallCount)} tool calls, ${signed(delta.costUsd, 6)} USD`,
      );
    }
    return experiment.status === "completed" ? 0 : 1;
  } catch (error) {
    const frame = streamRunErrorFrame(targetThreadId, error);
    if (options.jsonl) {
      await writeLine(io.stdout, JSON.stringify(frame));
    } else {
      await writeLine(
        io.stderr,
        `Napier model invocation experiment failed: ${frame.message} (${frame.diagnosticSha256.slice(0, 12)})`,
      );
    }
    return 1;
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener("abort", forwardAbort);
    await services?.shutdown().catch(() => undefined);
  }
}

function experimentRequest(options: CliModelInvocationExperimentOptions) {
  return {
    sourceRunId: options.sourceRunId,
    sourceTurnIndex: options.sourceTurnIndex,
    ...(options.model ? { model: options.model } : {}),
    ...(options.title ? { title: options.title } : {}),
  };
}

function signed(value: number, fractionDigits?: number): string {
  const text =
    fractionDigits === undefined
      ? String(value)
      : value.toFixed(fractionDigits);
  return value > 0 ? `+${text}` : text;
}
