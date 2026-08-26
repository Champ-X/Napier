import type {
  ExecutionPlanWorkflowJavascriptNode,
  JsonValue,
  RunRecord,
} from "@napier/contracts";

import type { EventSink } from "./event-sink.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import {
  JavascriptKernelManager,
  MAX_JAVASCRIPT_KERNEL_SESSION_TIMEOUT_MS,
  MIN_JAVASCRIPT_KERNEL_SESSION_TIMEOUT_MS,
  type JavascriptKernelEvaluation,
} from "./javascript-kernel.js";
import { JAVASCRIPT_KERNEL_WORKER_SHA256 } from "./javascript-kernel-worker.js";
import type { LocalStore } from "./store.js";
import type { WorkspaceProcessManager } from "./workspace-processes.js";
import { WORKFLOW_JAVASCRIPT_COMPLETED_EVENT } from "./workflow-javascript-evidence.js";
import {
  parseWorkflowJavascriptOutput,
  workflowJavascriptConfigurationSha256,
  workflowJavascriptInputBindingCode,
} from "./workflow-javascript-model.js";
import {
  ExecutionPlanWorkflowKernelError,
  ExecutionPlanWorkflowKernelRun,
} from "./workflow-kernel-run.js";
import type { ExecutionPlanWorkflowLedger } from "./workflow-ledger.js";
import {
  assertWorkflowEncodedBytes,
  assertWorkflowValue,
  MAX_EXECUTION_PLAN_WORKFLOW_NODE_OUTPUT_BYTES,
  workflowSchemaSha256,
} from "./workflow-schemas.js";

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

export class ExecutionPlanWorkflowJavascriptRuntime {
  private readonly kernels: JavascriptKernelManager | undefined;
  private readonly run: ExecutionPlanWorkflowKernelRun;

  constructor(
    store: LocalStore,
    ledger: ExecutionPlanWorkflowLedger,
    processes?: WorkspaceProcessManager,
  ) {
    this.kernels = processes
      ? new JavascriptKernelManager(processes)
      : undefined;
    this.run = new ExecutionPlanWorkflowKernelRun(store, ledger, "workflowjs");
  }

  async execute(
    options: ExecuteExecutionPlanWorkflowJavascriptOptions,
  ): Promise<ExecutionPlanWorkflowJavascriptOutcome> {
    return this.run.execute({
      threadId: options.threadId,
      planId: options.planId,
      agentId: options.agentId,
      agentRevision: options.agentRevision,
      nodeId: options.node.id,
      nodeType: "javascript",
      language: "JavaScript",
      toolName: "javascript_kernel",
      modelId: "napier/workflow-javascript",
      fallbackErrorCode: "javascript_failed",
      input: options.input,
      signal: options.signal,
      ...(options.wasTimedOut ? { wasTimedOut: options.wasTimedOut } : {}),
      ...(options.onEvent ? { onEvent: options.onEvent } : {}),
      onRunCreated: options.onRunCreated,
      executeSession: ({ run, signal }) =>
        this.executeSession(options, run, signal),
      cleanupRun: async (runId) => {
        await this.kernels?.cancelRun({
          threadId: options.threadId,
          runId,
        });
      },
    });
  }

  private async executeSession(
    options: ExecuteExecutionPlanWorkflowJavascriptOptions,
    run: RunRecord,
    signal: AbortSignal,
  ): Promise<{
    output: JsonValue;
    completionEventType: "workflow.javascript.completed";
    completionPayload: Record<string, JsonValue>;
  }> {
    if (!this.kernels) {
      throw new ExecutionPlanWorkflowKernelError(
        "sandbox_unavailable",
        "Workflow JavaScript Kernel Sandbox is unavailable",
        run,
      );
    }
    let inputBindingCode: string;
    try {
      inputBindingCode = workflowJavascriptInputBindingCode(options.input);
    } catch {
      throw new ExecutionPlanWorkflowKernelError(
        "input_invalid",
        "Workflow JavaScript input cannot be bound to the Kernel",
        run,
      );
    }
    const session = await this.kernels.start({
      threadId: options.threadId,
      runId: run.id,
      timeoutMs: Math.min(
        MAX_JAVASCRIPT_KERNEL_SESSION_TIMEOUT_MS,
        Math.max(
          MIN_JAVASCRIPT_KERNEL_SESSION_TIMEOUT_MS,
          options.node.timeoutMs,
        ),
      ),
      signal,
    });
    const binding = await this.kernels.evaluate({
      threadId: options.threadId,
      runId: run.id,
      processId: session.id,
      code: inputBindingCode,
      timeoutMs: options.node.evaluationTimeoutMs,
      signal,
    });
    requireEvaluation(binding, "input_binding_failed", run);
    const evaluations: JavascriptKernelEvaluation[] = [];
    for (const cell of options.node.cells) {
      signal.throwIfAborted();
      const evaluation = await this.kernels.evaluate({
        threadId: options.threadId,
        runId: run.id,
        processId: session.id,
        code: cell,
        timeoutMs: options.node.evaluationTimeoutMs,
        signal,
      });
      requireEvaluation(evaluation, "cell_failed", run);
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
      throw new ExecutionPlanWorkflowKernelError(
        "output_invalid",
        "Workflow JavaScript output does not match its schema",
        run,
      );
    }
    const settled = await this.kernels.cancel({
      threadId: options.threadId,
      runId: run.id,
      processId: session.id,
    });
    if (
      settled.status !== "cancelled" ||
      settled.workspaceDeltaStatus !== "unchanged" ||
      settled.workspaceChangedFileCount !== 0
    ) {
      throw new ExecutionPlanWorkflowKernelError(
        "cleanup_failed",
        "Workflow JavaScript Kernel did not settle unchanged",
        run,
      );
    }
    return {
      output,
      completionEventType: WORKFLOW_JAVASCRIPT_COMPLETED_EVENT,
      completionPayload: {
        attempt: options.attempt,
        manifestSha256: options.manifestSha256,
        javascriptConfigurationSha256: workflowJavascriptConfigurationSha256(
          options.node,
        ),
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
        outputSchemaSha256: workflowSchemaSha256(options.node.outputSchema),
      },
    };
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
    throw new ExecutionPlanWorkflowKernelError(
      code,
      "Workflow JavaScript evaluation failed",
      run,
    );
  }
}
