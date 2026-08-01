import path from "node:path";
import type { Readable, Writable } from "node:stream";

import type {
  ExecutionPlanWorkflowExperimentResultFrame,
  ExecutionPlanWorkflowResultFrame,
  RunEvent,
  RunRecord,
  StreamFrame,
} from "@napier/contracts";
import {
  canonicalJson,
  createExecutionPlanWorkflowExperimentResultFrame,
  createExecutionPlanWorkflowResultFrame,
  createLocalAgentRuntime,
  createThreadBranch,
  hashEventStream,
  loadWorkspaceSourceFile,
  MAX_EXECUTION_PLAN_WORKFLOW_MANIFEST_BYTES,
  streamRunDoneFrame,
  streamRunErrorFrame,
  streamSnapshotFrame,
  validateCreateExecutionPlanWorkflowExperimentRequest,
  validateExecuteExecutionPlanWorkflowRequest,
  type LocalAgentRuntimeOptions,
  type LocalAgentRuntimeServices,
} from "@napier/runtime";

import {
  CLI_HELP,
  CLI_VERSION,
  parseCliArgs,
  type CliAction,
  type CliBranchOptions,
  type CliExecutionOptions,
  type CliResumeOptions,
  type CliRunOptions,
  type CliWorkflowOptions,
} from "./cli-options.js";
import { executeAgentMessageExperimentCli } from "./agent-message-experiment-cli.js";
import { executeModelInvocationExperimentCli } from "./model-invocation-experiment-cli.js";
import { executeToolInvocationExperimentCli } from "./tool-invocation-experiment-cli.js";
import { writeLine } from "./cli-output.js";
import { executeInteractive } from "./interactive-cli.js";
import { OrderedEventFrameWriter } from "./ordered-event-frame-writer.js";
import { executeRpc } from "./rpc-cli.js";
import { canonicalWorkspace } from "./workspace-path.js";

export { CLI_HELP, CLI_VERSION, parseCliArgs };

export interface CliIo {
  cwd: string;
  env: Readonly<Record<string, string | undefined>>;
  stdin?: Readable;
  stdout: Writable;
  stderr: Writable;
  subscribeInterrupt?(listener: () => void): () => void;
}

export interface RunCliDependencies {
  createRuntime(
    options: LocalAgentRuntimeOptions,
  ): Promise<LocalAgentRuntimeServices>;
}

const DEFAULT_DEPENDENCIES: RunCliDependencies = {
  createRuntime: createLocalAgentRuntime,
};
const WORKFLOW_MANIFEST_EXTENSIONS = new Set([".json"]);

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
  if (action.kind === "run") {
    return executeRun(action.options, io, dependencies, parentSignal);
  }
  if (action.kind === "chat") {
    return executeInteractive(action.options, io, dependencies, parentSignal);
  }
  if (action.kind === "resume") {
    return executeResume(action.options, io, dependencies, parentSignal);
  }
  if (action.kind === "branch") {
    return executeBranch(action.options, io, dependencies, parentSignal);
  }
  if (action.kind === "experiment") {
    return executeAgentMessageExperimentCli(
      action.options,
      io,
      dependencies,
      parentSignal,
    );
  }
  if (action.kind === "model-experiment") {
    return executeModelInvocationExperimentCli(
      action.options,
      io,
      dependencies,
      parentSignal,
    );
  }
  if (action.kind === "tool-experiment") {
    return executeToolInvocationExperimentCli(
      action.options,
      io,
      dependencies,
      parentSignal,
    );
  }
  if (action.kind === "rpc") {
    return executeRpc(action.options, io, dependencies, parentSignal);
  }
  return executeWorkflow(action.options, io, dependencies, parentSignal);
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

async function executeBranch(
  options: CliBranchOptions,
  io: CliIo,
  dependencies: RunCliDependencies,
  parentSignal?: AbortSignal,
): Promise<number> {
  let services: LocalAgentRuntimeServices | undefined;
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
    const result = await createThreadBranch(services.store, options.threadId, {
      fromSeq: options.fromSeq,
      ...(options.title ? { title: options.title } : {}),
    });
    if (options.jsonl) {
      const eventWriter = new OrderedEventFrameWriter(
        io.stdout,
        result.detail.thread.id,
        1,
      );
      for (const event of result.detail.events) {
        await eventWriter.write(event);
      }
      await eventWriter.finish(result.detail.thread.eventCount);
      const snapshot = streamSnapshotFrame(result.detail);
      await writeJsonLine(io.stdout, snapshot);
      await writeJsonLine(
        io.stdout,
        streamRunDoneFrame(
          result.detail.thread.id,
          result.run.id,
          result.run.status,
          snapshot.detailSha256,
          snapshot.detailBytes,
          snapshot.detail.thread.eventCount,
          snapshot.eventBytes,
          hashEventStream(snapshot.detail.events),
        ),
      );
    } else {
      await writeLine(io.stdout, result.detail.thread.id);
      await writeLine(
        io.stderr,
        `Napier branch ${result.detail.thread.id} from ${result.sourceThreadId}#${String(result.sourceSeq)}`,
      );
    }
    return 0;
  } catch (error) {
    const frame = streamRunErrorFrame(options.threadId, error);
    if (options.jsonl) {
      await writeJsonLine(io.stdout, frame);
    } else {
      await writeLine(
        io.stderr,
        `Napier branch failed: ${frame.message} (${frame.diagnosticSha256.slice(0, 12)})`,
      );
    }
    return 1;
  } finally {
    await services?.shutdown().catch(() => undefined);
  }
}

async function executeWorkflow(
  options: CliWorkflowOptions,
  io: CliIo,
  dependencies: RunCliDependencies,
  parentSignal?: AbortSignal,
): Promise<number> {
  let services: LocalAgentRuntimeServices | undefined;
  let threadId = options.threadId ?? "thread_cli_workflow_preflight";
  const controller = new AbortController();
  const forwardAbort = (): void => controller.abort();
  parentSignal?.addEventListener("abort", forwardAbort, { once: true });
  if (parentSignal?.aborted) controller.abort();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const workspaceRoot = await canonicalWorkspace(options.workspace, io.cwd);
    const manifestFile = await loadWorkspaceSourceFile(
      workspaceRoot,
      options.manifestPath,
      {
        label: "Workflow manifest",
        maxBytes: MAX_EXECUTION_PLAN_WORKFLOW_MANIFEST_BYTES,
        extensions: WORKFLOW_MANIFEST_EXTENSIONS,
        extensionError: "Workflow manifest must be a JSON file",
      },
    );
    const manifest = parseJson(manifestFile.source, "Workflow manifest");
    const request = options.fromNodeId
      ? undefined
      : validateExecuteExecutionPlanWorkflowRequest(
          options.planId
            ? {
                manifest,
                planId: options.planId,
                ...(options.retryBlocked ? { retryBlocked: true } : {}),
                ...(options.continueBreakpoint
                  ? { continueBreakpoint: true }
                  : {}),
              }
            : {
                manifest,
                input: parseJson(options.inputJson!, "Workflow input"),
                ...(options.breakBeforeNodeIds
                  ? { breakBeforeNodeIds: options.breakBeforeNodeIds }
                  : {}),
              },
        );
    const experimentRequest = options.fromNodeId
      ? validateCreateExecutionPlanWorkflowExperimentRequest({
          manifest,
          planId: options.planId,
          fromNodeId: options.fromNodeId,
          ...(options.singleNode
            ? { mode: "single_node" as const }
            : options.simulateOutputJson !== undefined
              ? {
                  mode: "simulate_node" as const,
                  simulatedOutput: parseJson(
                    options.simulateOutputJson,
                    "Workflow simulated output",
                  ),
                }
              : {}),
          ...(options.title ? { title: options.title } : {}),
          ...(options.modelOverridesJson
            ? {
                modelOverrides: parseJson(
                  options.modelOverridesJson,
                  "Workflow model overrides",
                ),
              }
            : {}),
          ...(options.confirmSideEffects ? { confirmSideEffects: true } : {}),
          ...(options.expectedPreviewSha256
            ? { expectedPreviewSha256: options.expectedPreviewSha256 }
            : {}),
        })
      : undefined;
    const dataRoot = path.resolve(
      io.cwd,
      options.dataRoot ?? path.join(workspaceRoot, ".napier"),
    );
    services = await dependencies.createRuntime({
      workspaceRoot,
      dataRoot,
      env: io.env,
    });
    if (experimentRequest) {
      if (options.previewExperiment) {
        const preview = await services.workflowExperiments.preview(
          options.threadId!,
          experimentRequest,
        );
        await writeJsonLine(io.stdout, preview);
        if (!options.jsonl) {
          await writeLine(
            io.stderr,
            `Napier workflow experiment preview ${preview.previewSha256.slice(0, 12)} (${preview.requiresSideEffectConfirmation ? "confirmation required" : "ready"})`,
          );
        }
        return 0;
      }
      let eventWriter: OrderedEventFrameWriter | undefined;
      const experiment = await services.workflowExperiments.run({
        sourceThreadId: options.threadId!,
        request: experimentRequest,
        signal: controller.signal,
        onTargetCreated: (thread) => {
          threadId = thread.id;
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
                    "Workflow experiment target stream is unavailable",
                  );
                }
                await eventWriter.write(event);
              },
            }
          : {}),
      });
      const detail = await services.store.getDetail(experiment.targetThreadId);
      const snapshot = streamSnapshotFrame(detail);
      const resultFrame = createExecutionPlanWorkflowExperimentResultFrame(
        experiment,
        snapshot,
        hashEventStream(detail.events),
      );
      if (eventWriter) {
        await eventWriter.finish(detail.thread.eventCount);
        await writeJsonLine(io.stdout, snapshot);
        await writeJsonLine(io.stdout, resultFrame);
      } else {
        await writeLine(
          io.stdout,
          experiment.result.output === undefined
            ? canonicalJson({
                planId: experiment.result.planId,
                status: experiment.result.status,
                previewSha256: experiment.preview.previewSha256,
              })
            : canonicalJson(experiment.result.output),
        );
        await writeLine(
          io.stderr,
          `Napier workflow experiment ${experiment.result.planId} ${experiment.result.status} (thread ${experiment.targetThreadId})`,
        );
        if (experiment.comparison) {
          const delta = experiment.comparison.metricDelta;
          await writeLine(
            io.stderr,
            `Delta (target-source): ${signedNumber(delta.durationMs)}ms, ${signedNumber(delta.inputTokens + delta.outputTokens)} tokens, ${signedNumber(delta.toolCallCount)} tools, ${signedNumber(delta.costUsd, 6)} USD`,
          );
        }
      }
      return experiment.result.status === "completed" ||
        experiment.result.status === "waiting" ||
        experiment.result.status === "paused"
        ? 0
        : 1;
    }
    const thread = options.threadId
      ? services.store.getThread(options.threadId)
      : await createWorkflowThread(services, options);
    threadId = thread.id;
    if (options.agentId && options.agentId !== thread.agentId) {
      throw new Error("Existing Thread Agent does not match --agent");
    }
    const eventWriter = options.jsonl
      ? new OrderedEventFrameWriter(io.stdout, thread.id, thread.eventCount + 1)
      : undefined;
    const onEvent = eventWriter
      ? async (event: RunEvent): Promise<void> => eventWriter.write(event)
      : undefined;
    const result = options.approval
      ? (
          await answerAndResumeWorkflowApproval(
            services,
            request!,
            options,
            controller.signal,
            onEvent,
          )
        ).result
      : await services.workflows.run({
          threadId,
          request: request!,
          signal: controller.signal,
          ...(onEvent ? { onEvent } : {}),
        });
    const detail = await services.store.getDetail(threadId);
    const snapshot = streamSnapshotFrame(detail);
    const resultFrame = createExecutionPlanWorkflowResultFrame(
      result,
      snapshot,
      hashEventStream(detail.events),
    );
    if (eventWriter) {
      await eventWriter.finish(detail.thread.eventCount);
      await writeJsonLine(io.stdout, snapshot);
      await writeJsonLine(io.stdout, resultFrame);
    } else {
      await writeLine(
        io.stdout,
        result.output === undefined
          ? canonicalJson({
              planId: result.planId,
              status: result.status,
              resultSha256: result.resultSha256,
              ...(result.breakpoint ? { breakpoint: result.breakpoint } : {}),
            })
          : canonicalJson(result.output),
      );
      await writeLine(
        io.stderr,
        `Napier workflow ${result.planId} ${result.status} (thread ${threadId})`,
      );
    }
    return result.status === "completed" ||
      result.status === "waiting" ||
      result.status === "paused"
      ? 0
      : 1;
  } catch (error) {
    const frame = streamRunErrorFrame(threadId, error);
    if (options.jsonl) {
      await writeJsonLine(io.stdout, frame);
    } else {
      await writeLine(
        io.stderr,
        `Napier workflow failed: ${frame.message} (${frame.diagnosticSha256.slice(0, 12)})`,
      );
    }
    return 1;
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener("abort", forwardAbort);
    await services?.shutdown().catch(() => undefined);
  }
}

async function answerAndResumeWorkflowApproval(
  services: LocalAgentRuntimeServices,
  request: ReturnType<typeof validateExecuteExecutionPlanWorkflowRequest>,
  options: CliWorkflowOptions,
  signal: AbortSignal,
  onEvent?: (event: RunEvent) => Promise<void>,
) {
  if (!options.planId || !options.approval || !("planId" in request)) {
    throw new Error("Workflow Approval answer requires a resume request");
  }
  const pending = await services.embeddedWorkflows.pendingApproval({
    manifest: request.manifest,
    threadId: options.threadId!,
    planId: options.planId,
  });
  return services.embeddedWorkflows.answerAndResume({
    manifest: request.manifest,
    threadId: options.threadId!,
    planId: options.planId,
    decisionId: pending.id,
    expectedDecisionSha256: pending.contentSha256,
    answer: {
      selectedOptionIds: [
        options.approval === "approve" ? "option_1" : "option_2",
      ],
      ...(options.decisionNote ? { customText: options.decisionNote } : {}),
    },
    signal,
    ...(onEvent ? { onEvent } : {}),
  });
}

async function createWorkflowThread(
  services: LocalAgentRuntimeServices,
  options: CliWorkflowOptions,
) {
  const agent = options.agentId
    ? services.store.getAgent(options.agentId)
    : services.store.listAgents()[0];
  if (!agent) throw new Error("No Agent profile is available");
  return services.store.createThread({
    title: options.title ?? "CLI Workflow",
    agentId: agent.id,
  });
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
      ? new OrderedEventFrameWriter(io.stdout, thread.id, thread.eventCount + 1)
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
  frame:
    | StreamFrame
    | ExecutionPlanWorkflowResultFrame
    | ExecutionPlanWorkflowExperimentResultFrame
    | unknown,
): Promise<void> {
  await writeLine(stream, JSON.stringify(frame));
}

function signedNumber(value: number, fractionDigits?: number): string {
  const text =
    fractionDigits === undefined
      ? String(value)
      : value.toFixed(fractionDigits);
  return value > 0 ? `+${text}` : text;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}
