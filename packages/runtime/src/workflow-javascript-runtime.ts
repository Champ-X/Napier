import {
  emptyUsage,
  type ExecutionPlanWorkflowJavascriptNode,
  type JsonValue,
  type RunRecord,
} from "@napier/contracts";

import type { EventSink } from "./agent-runtime.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import { createId } from "./ids.js";
import {
  JavascriptKernelManager,
  MAX_JAVASCRIPT_KERNEL_SESSION_TIMEOUT_MS,
  MIN_JAVASCRIPT_KERNEL_SESSION_TIMEOUT_MS,
  type JavascriptKernelEvaluation,
} from "./javascript-kernel.js";
import { JAVASCRIPT_KERNEL_WORKER_SHA256 } from "./javascript-kernel-worker.js";
import { assessToolCall } from "./policy.js";
import type { LocalStore } from "./store.js";
import type { WorkspaceProcessManager } from "./workspace-processes.js";
import { WORKFLOW_JAVASCRIPT_COMPLETED_EVENT } from "./workflow-javascript-evidence.js";
import {
  parseWorkflowJavascriptOutput,
  workflowJavascriptConfigurationSha256,
  workflowJavascriptInputBindingCode,
} from "./workflow-javascript-model.js";
import {
  ExecutionPlanWorkflowLedger,
  WORKFLOW_EVENT_SCHEMA_VERSION,
} from "./workflow-ledger.js";
import { WORKFLOW_NODE_EXECUTION } from "./workflow-node-execution.js";
import {
  assertWorkflowEncodedBytes,
  assertWorkflowValue,
  MAX_EXECUTION_PLAN_WORKFLOW_NODE_OUTPUT_BYTES,
  workflowSchemaSha256,
} from "./workflow-schemas.js";

const RUN_LEASE_TTL_MS = 60_000;
const RUN_LEASE_HEARTBEAT_MS = 20_000;

export interface ExecuteExecutionPlanWorkflowJavascriptOptions {
  threadId: string;
  planId: string;
  manifestSha256: string;
  agentId: string;
  agentRevision: number;
  node: ExecutionPlanWorkflowJavascriptNode;
  input: JsonValue;
  inputSha256: string;
  attempt: number;
  signal: AbortSignal;
  wasTimedOut?(): boolean;
  onEvent?: EventSink;
  onRunCreated(run: RunRecord): Promise<void>;
}

export interface ExecutionPlanWorkflowJavascriptOutcome {
  run: RunRecord;
  output: JsonValue;
}

export class ExecutionPlanWorkflowJavascriptError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly run?: RunRecord,
  ) {
    super(message);
    this.name = "ExecutionPlanWorkflowJavascriptError";
  }
}

export class ExecutionPlanWorkflowJavascriptRuntime {
  private readonly workerId = createId("workflowjs");
  private readonly kernels: JavascriptKernelManager | undefined;

  constructor(
    private readonly store: LocalStore,
    private readonly ledger: ExecutionPlanWorkflowLedger,
    processes?: WorkspaceProcessManager,
  ) {
    this.kernels = processes
      ? new JavascriptKernelManager(processes)
      : undefined;
  }

  async execute(
    options: ExecuteExecutionPlanWorkflowJavascriptOptions,
  ): Promise<ExecutionPlanWorkflowJavascriptOutcome> {
    options.signal.throwIfAborted();
    const profile = this.store.getAgentRevision(
      options.agentId,
      options.agentRevision,
    ).profile;
    const leased = await this.store.createLeasedRun(
      {
        threadId: options.threadId,
        agentId: options.agentId,
        agentRevision: options.agentRevision,
        model: profile.model,
        source: "workflow",
        [WORKFLOW_NODE_EXECUTION]: { planId: options.planId },
      },
      {
        ownerId: this.workerId,
        ttlMs: RUN_LEASE_TTL_MS,
      },
    );
    let settled = false;
    let completionRecorded = false;
    let sessionStarted = false;
    let leaseLost = false;
    const controller = new AbortController();
    const forwardAbort = (): void => controller.abort();
    options.signal.addEventListener("abort", forwardAbort, { once: true });
    if (options.signal.aborted) controller.abort();
    const heartbeat = setInterval(() => {
      void this.store
        .renewRunLease(leased.run.id, leased.token, RUN_LEASE_TTL_MS)
        .catch(() => {
          leaseLost = true;
          controller.abort();
        });
    }, RUN_LEASE_HEARTBEAT_MS);
    try {
      controller.signal.throwIfAborted();
      await options.onRunCreated(leased.run);
      await this.ledger.append(
        {
          threadId: options.threadId,
          runId: leased.run.id,
          type: "run.started",
          category: "lifecycle",
          visibility: "debug",
          payload: {
            agentId: options.agentId,
            agentRevision: options.agentRevision,
            model: `${profile.model.provider}/${profile.model.id}`,
            source: "workflow",
            workflowNodeType: "javascript",
            configurationSha256: leased.run.configuration?.contentSha256 ?? "",
          },
        },
        options.onEvent,
      );
      if (!profile.enabledTools.includes("javascript_kernel")) {
        throw new ExecutionPlanWorkflowJavascriptError(
          "tool_unavailable",
          "Workflow JavaScript Kernel is not enabled",
          leased.run,
        );
      }
      const decision = assessToolCall(
        profile.toolPolicy,
        "javascript_kernel",
        { action: "start" },
        this.store.workspaceRoot,
      );
      if (!decision.allowed) {
        throw new ExecutionPlanWorkflowJavascriptError(
          "policy_denied",
          "Workflow JavaScript Kernel policy denied execution",
          leased.run,
        );
      }
      if (!this.kernels) {
        throw new ExecutionPlanWorkflowJavascriptError(
          "sandbox_unavailable",
          "Workflow JavaScript Kernel Sandbox is unavailable",
          leased.run,
        );
      }
      let inputBindingCode: string;
      try {
        inputBindingCode = workflowJavascriptInputBindingCode(options.input);
      } catch {
        throw new ExecutionPlanWorkflowJavascriptError(
          "input_invalid",
          "Workflow JavaScript input cannot be bound to the Kernel",
          leased.run,
        );
      }
      const session = await this.kernels.start({
        threadId: options.threadId,
        runId: leased.run.id,
        timeoutMs: Math.min(
          MAX_JAVASCRIPT_KERNEL_SESSION_TIMEOUT_MS,
          Math.max(
            MIN_JAVASCRIPT_KERNEL_SESSION_TIMEOUT_MS,
            options.node.timeoutMs,
          ),
        ),
        signal: controller.signal,
      });
      sessionStarted = true;
      const binding = await this.kernels.evaluate({
        threadId: options.threadId,
        runId: leased.run.id,
        processId: session.id,
        code: inputBindingCode,
        timeoutMs: options.node.evaluationTimeoutMs,
        signal: controller.signal,
      });
      requireEvaluation(binding, "input_binding_failed", leased.run);
      const evaluations: JavascriptKernelEvaluation[] = [];
      for (const cell of options.node.cells) {
        controller.signal.throwIfAborted();
        const evaluation = await this.kernels.evaluate({
          threadId: options.threadId,
          runId: leased.run.id,
          processId: session.id,
          code: cell,
          timeoutMs: options.node.evaluationTimeoutMs,
          signal: controller.signal,
        });
        requireEvaluation(evaluation, "cell_failed", leased.run);
        evaluations.push(evaluation);
      }
      const finalEvaluation = evaluations.at(-1)!;
      let output: JsonValue;
      try {
        output = parseWorkflowJavascriptOutput(
          finalEvaluation.preview,
          finalEvaluation.previewTruncated,
        );
        assertWorkflowEncodedBytes(
          output,
          MAX_EXECUTION_PLAN_WORKFLOW_NODE_OUTPUT_BYTES,
          `Workflow JavaScript output ${options.node.id}`,
        );
        assertWorkflowValue(
          options.node.outputSchema,
          output,
          `Workflow JavaScript output ${options.node.id}`,
        );
      } catch {
        throw new ExecutionPlanWorkflowJavascriptError(
          "output_invalid",
          "Workflow JavaScript output does not match its schema",
          leased.run,
        );
      }
      const settledSession = await this.kernels.cancel({
        threadId: options.threadId,
        runId: leased.run.id,
        processId: session.id,
      });
      sessionStarted = false;
      if (
        settledSession.status !== "cancelled" ||
        settledSession.workspaceDeltaStatus !== "unchanged" ||
        settledSession.workspaceChangedFileCount !== 0
      ) {
        throw new ExecutionPlanWorkflowJavascriptError(
          "cleanup_failed",
          "Workflow JavaScript Kernel did not settle unchanged",
          leased.run,
        );
      }
      controller.signal.throwIfAborted();
      const serializedOutput = canonicalJson(output);
      const outputSha256 = sha256(serializedOutput);
      await this.ledger.append(
        {
          threadId: options.threadId,
          runId: leased.run.id,
          type: "message.assistant",
          category: "message",
          visibility: "hidden",
          payload: {
            role: "assistant",
            text: serializedOutput,
            model: "napier/workflow-javascript",
            usage: emptyUsage(),
          },
        },
        options.onEvent,
      );
      controller.signal.throwIfAborted();
      await this.ledger.append(
        {
          threadId: options.threadId,
          runId: leased.run.id,
          type: WORKFLOW_JAVASCRIPT_COMPLETED_EVENT,
          category: "plan",
          visibility: "user",
          payload: {
            schemaVersion: WORKFLOW_EVENT_SCHEMA_VERSION,
            planId: options.planId,
            nodeId: options.node.id,
            attempt: options.attempt,
            manifestSha256: options.manifestSha256,
            javascriptConfigurationSha256:
              workflowJavascriptConfigurationSha256(options.node),
            workerSha256: JAVASCRIPT_KERNEL_WORKER_SHA256,
            inputSha256: options.inputSha256,
            inputBindingRequestSha256: binding.requestSha256,
            inputBindingResultSha256: binding.resultSha256,
            cellCount: evaluations.length,
            cellRequestSetSha256: sha256(
              canonicalJson(
                evaluations.map((evaluation) => evaluation.requestSha256),
              ),
            ),
            cellResultSetSha256: sha256(
              canonicalJson(
                evaluations.map((evaluation) => evaluation.resultSha256),
              ),
            ),
            durationMs:
              binding.durationMs +
              evaluations.reduce(
                (total, evaluation) => total + evaluation.durationMs,
                0,
              ),
            outputSha256,
            outputBytes: Buffer.byteLength(serializedOutput, "utf8"),
            outputSchemaSha256: workflowSchemaSha256(options.node.outputSchema),
          },
        },
        options.onEvent,
      );
      completionRecorded = true;
      const run = await this.store.finishRun(leased.run.id, "completed", {
        leaseToken: leased.token,
      });
      settled = true;
      await this.ledger.append(
        {
          threadId: options.threadId,
          runId: leased.run.id,
          type: "run.completed",
          category: "lifecycle",
          visibility: "debug",
          payload: { status: "completed" },
        },
        options.onEvent,
      );
      return { run, output };
    } catch (caught) {
      let error = caught;
      if (sessionStarted && this.kernels) {
        try {
          await this.kernels.cancelRun({
            threadId: options.threadId,
            runId: leased.run.id,
          });
        } catch {
          error = new ExecutionPlanWorkflowJavascriptError(
            "cleanup_failed",
            "Workflow JavaScript Kernel cleanup failed",
            leased.run,
          );
        }
      }
      if (settled) throw error;
      if (completionRecorded) {
        let interrupted = false;
        try {
          await this.store.finishRun(leased.run.id, "interrupted", {
            error: "Workflow JavaScript settlement interrupted",
            leaseToken: leased.token,
          });
          interrupted = true;
        } catch {
          // Lease expiry remains the fallback when Store settlement is down.
        }
        if (interrupted) {
          await this.ledger
            .append(
              {
                threadId: options.threadId,
                runId: leased.run.id,
                type: "run.interrupted",
                category: "lifecycle",
                visibility: "user",
                payload: {
                  status: "interrupted",
                  errorCode: "settlement_interrupted",
                  diagnosticSha256: sha256(
                    "Workflow JavaScript settlement interrupted",
                  ),
                },
              },
              options.onEvent,
            )
            .catch(() => undefined);
        }
        throw new ExecutionPlanWorkflowJavascriptError(
          "settlement_interrupted",
          "Workflow JavaScript Run settlement was interrupted",
          leased.run,
        );
      }
      const timedOut = options.wasTimedOut?.() === true;
      const cancelled = options.signal.aborted && !timedOut;
      const code =
        error instanceof ExecutionPlanWorkflowJavascriptError
          ? error.code
          : leaseLost
            ? "lease_lost"
            : timedOut
              ? "timeout"
              : cancelled
                ? "cancelled"
                : "javascript_failed";
      const diagnosticSha256 = sha256(errorMessage(error));
      await this.ledger
        .append(
          {
            threadId: options.threadId,
            runId: leased.run.id,
            type: cancelled ? "run.cancelled" : "run.failed",
            category: "lifecycle",
            visibility: "user",
            payload: {
              status: cancelled ? "cancelled" : "failed",
              errorCode: code,
              diagnosticSha256,
            },
          },
          options.onEvent,
        )
        .catch(() => undefined);
      await this.store
        .finishRun(leased.run.id, cancelled ? "cancelled" : "failed", {
          error: `Workflow JavaScript ${code}`,
          leaseToken: leased.token,
        })
        .catch(() => undefined);
      if (error instanceof ExecutionPlanWorkflowJavascriptError) throw error;
      throw new ExecutionPlanWorkflowJavascriptError(
        code,
        "Workflow JavaScript execution failed",
        leased.run,
      );
    } finally {
      clearInterval(heartbeat);
      options.signal.removeEventListener("abort", forwardAbort);
    }
  }
}

function requireEvaluation(
  evaluation: JavascriptKernelEvaluation,
  code: string,
  run: RunRecord,
): void {
  if (
    evaluation.status !== "ok" ||
    evaluation.terminal ||
    evaluation.processStatus !== "running"
  ) {
    throw new ExecutionPlanWorkflowJavascriptError(
      code,
      "Workflow JavaScript evaluation failed",
      run,
    );
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
