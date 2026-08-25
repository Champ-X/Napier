import path from "node:path";
import type { Writable } from "node:stream";

import type { RunEvent } from "@napier/contracts";
import {
  canonicalJson,
  hashEventStream,
  streamRunErrorFrame,
  streamSnapshotFrame,
} from "@napier/runtime/core";
import {
  createToolInvocationExperimentResultFrame,
} from "@napier/runtime/evaluation";
import {
  type LocalAgentRuntimeOptions,
  type LocalAgentRuntimeServices,
} from "@napier/runtime/agent";

import type { CliToolInvocationExperimentOptions } from "./cli-options.js";
import { writeLine } from "./cli-output.js";
import { OrderedEventFrameWriter } from "./ordered-event-frame-writer.js";
import { canonicalWorkspace } from "./workspace-path.js";

export interface ToolInvocationExperimentCliIo {
  cwd: string;
  env: Readonly<Record<string, string | undefined>>;
  stdout: Writable;
  stderr: Writable;
}

export interface ToolInvocationExperimentCliDependencies {
  createRuntime(
    options: LocalAgentRuntimeOptions,
  ): Promise<LocalAgentRuntimeServices>;
}

export async function executeToolInvocationExperimentCli(
  options: CliToolInvocationExperimentOptions,
  io: ToolInvocationExperimentCliIo,
  dependencies: ToolInvocationExperimentCliDependencies,
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
      const preview = await services.toolInvocationExperiments.preview(
        options.threadId,
        request,
        controller.signal,
      );
      await writeLine(io.stdout, JSON.stringify(preview));
      if (!options.jsonl) {
        await writeLine(
          io.stderr,
          `Napier tool invocation preview ${preview.previewSha256.slice(0, 12)} (${preview.sourceToolName}, read-only)`,
        );
      }
      return 0;
    }

    let eventWriter: OrderedEventFrameWriter | undefined;
    const experiment = await services.toolInvocationExperiments.run({
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
                  "Tool invocation experiment target stream is unavailable",
                );
              }
              await eventWriter.write(event);
            },
          }
        : {}),
    });
    const detail = await services.store.getDetail(experiment.targetThreadId);
    const snapshot = streamSnapshotFrame(detail);
    const resultFrame = createToolInvocationExperimentResultFrame(
      experiment,
      snapshot,
      hashEventStream(detail.events),
    );
    if (eventWriter) {
      await eventWriter.finish(detail.thread.eventCount, detail.events);
      await writeLine(io.stdout, JSON.stringify(snapshot));
      await writeLine(io.stdout, JSON.stringify(resultFrame));
    } else {
      await writeLine(
        io.stdout,
        experiment.candidateOutput ??
          canonicalJson({
            targetRunId: experiment.targetRunId,
            status: experiment.status,
            outputChanged: experiment.comparison.outputChanged,
            previewSha256: experiment.preview.previewSha256,
          }),
      );
      await writeLine(
        io.stderr,
        `Napier tool invocation experiment ${experiment.targetRunId} ${experiment.status} (thread ${experiment.targetThreadId})`,
      );
      await writeLine(
        io.stderr,
        `Delta (target-source): ${signed(experiment.comparison.durationMsDelta)}ms; output ${experiment.comparison.outputChanged ? "changed" : "unchanged"}`,
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
        `Napier tool invocation experiment failed: ${frame.message} (${frame.diagnosticSha256.slice(0, 12)})`,
      );
    }
    return 1;
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener("abort", forwardAbort);
    await services?.shutdown().catch(() => undefined);
  }
}

function experimentRequest(options: CliToolInvocationExperimentOptions) {
  return {
    sourceRunId: options.sourceRunId,
    sourceCallId: options.sourceCallId,
    ...(options.title ? { title: options.title } : {}),
  };
}

function signed(value: number): string {
  return value > 0 ? `+${String(value)}` : String(value);
}
