import type {
  ExecutionPlanWorkflowPythonNode,
  JsonValue,
  RunRecord,
} from "@napier/contracts";

import type { EventSink } from "./event-sink.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import {
  MAX_PYTHON_KERNEL_SESSION_TIMEOUT_MS,
  MIN_PYTHON_KERNEL_SESSION_TIMEOUT_MS,
  PythonKernelManager,
  type PythonKernelEvaluation,
} from "./python-kernel.js";
import { PYTHON_KERNEL_WORKER_SHA256 } from "./python-kernel-worker.js";
import type { LocalStore } from "./store.js";
import type { WorkspaceProcessManager } from "./workspace-processes.js";
import {
  ExecutionPlanWorkflowKernelError,
  ExecutionPlanWorkflowKernelRun,
} from "./workflow-kernel-run.js";
import type { ExecutionPlanWorkflowLedger } from "./workflow-ledger.js";
import { WORKFLOW_PYTHON_COMPLETED_EVENT } from "./workflow-python-evidence.js";
import {
  MAX_EXECUTION_PLAN_WORKFLOW_PYTHON_INPUT_BYTES,
  MAX_EXECUTION_PLAN_WORKFLOW_PYTHON_OUTPUT_BYTES,
  workflowPythonConfigurationSha256,
} from "./workflow-python-model.js";
import {
  assertWorkflowEncodedBytes,
  assertWorkflowValue,
  workflowSchemaSha256,
} from "./workflow-schemas.js";

export interface ExecuteExecutionPlanWorkflowPythonOptions {
  threadId: string;
  planId: string;
  manifestSha256: string;
  agentId: string;
  agentRevision: number;
  node: ExecutionPlanWorkflowPythonNode;
  input: JsonValue;
  inputSha256: string;
  attempt: number;
  signal: AbortSignal;
  wasTimedOut?(): boolean;
  onEvent?: EventSink;
  onRunCreated(run: RunRecord): Promise<void>;
}

export interface ExecutionPlanWorkflowPythonOutcome {
  run: RunRecord;
  output: JsonValue;
}

export class ExecutionPlanWorkflowPythonRuntime {
  private readonly kernels: PythonKernelManager | undefined;
  private readonly run: ExecutionPlanWorkflowKernelRun;

  constructor(
    store: LocalStore,
    ledger: ExecutionPlanWorkflowLedger,
    processes?: WorkspaceProcessManager,
  ) {
    this.kernels = processes ? new PythonKernelManager(processes) : undefined;
    this.run = new ExecutionPlanWorkflowKernelRun(store, ledger, "workflowpy");
  }

  async execute(
    options: ExecuteExecutionPlanWorkflowPythonOptions,
  ): Promise<ExecutionPlanWorkflowPythonOutcome> {
    return this.run.execute({
      threadId: options.threadId,
      planId: options.planId,
      agentId: options.agentId,
      agentRevision: options.agentRevision,
      nodeId: options.node.id,
      nodeType: "python",
      language: "Python",
      toolName: "python_kernel",
      modelId: "napier/workflow-python",
      fallbackErrorCode: "python_failed",
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
    options: ExecuteExecutionPlanWorkflowPythonOptions,
    run: RunRecord,
    signal: AbortSignal,
  ): Promise<{
    output: JsonValue;
    completionEventType: string;
    completionPayload: Record<string, JsonValue>;
  }> {
    if (!this.kernels) {
      throw new ExecutionPlanWorkflowKernelError(
        "sandbox_unavailable",
        "Workflow Python Kernel Sandbox is unavailable",
        run,
      );
    }
    try {
      assertWorkflowEncodedBytes(
        options.input,
        MAX_EXECUTION_PLAN_WORKFLOW_PYTHON_INPUT_BYTES,
        `Workflow Python input ${options.node.id}`,
      );
    } catch {
      throw new ExecutionPlanWorkflowKernelError(
        "input_invalid",
        "Workflow Python input cannot be bound to the Kernel",
        run,
      );
    }
    const session = await this.kernels.start({
      threadId: options.threadId,
      runId: run.id,
      timeoutMs: Math.min(
        MAX_PYTHON_KERNEL_SESSION_TIMEOUT_MS,
        Math.max(MIN_PYTHON_KERNEL_SESSION_TIMEOUT_MS, options.node.timeoutMs),
      ),
      signal,
    });
    const binding = await this.kernels.evaluate({
      threadId: options.threadId,
      runId: run.id,
      processId: session.id,
      code: "None",
      input: options.input,
      resultMode: "workflow_intermediate",
      timeoutMs: options.node.evaluationTimeoutMs,
      signal,
    });
    requireEvaluation(binding, "input_binding_failed", run);
    const evaluations: PythonKernelEvaluation[] = [];
    for (const [index, cell] of options.node.cells.entries()) {
      signal.throwIfAborted();
      const evaluation = await this.kernels.evaluate({
        threadId: options.threadId,
        runId: run.id,
        processId: session.id,
        code: cell,
        resultMode:
          index === options.node.cells.length - 1
            ? "workflow_final"
            : "workflow_intermediate",
        timeoutMs: options.node.evaluationTimeoutMs,
        signal,
      });
      requireEvaluation(evaluation, "cell_failed", run);
      evaluations.push(evaluation);
    }
    const finalEvaluation = evaluations.at(-1)!;
    let output: JsonValue;
    try {
      if (finalEvaluation.jsonValue === undefined) {
        throw new Error("Python result is not exact JSON");
      }
      output = structuredClone(finalEvaluation.jsonValue);
      assertWorkflowEncodedBytes(
        output,
        MAX_EXECUTION_PLAN_WORKFLOW_PYTHON_OUTPUT_BYTES,
        `Workflow Python output ${options.node.id}`,
      );
      assertWorkflowValue(
        options.node.outputSchema,
        output,
        `Workflow Python output ${options.node.id}`,
        MAX_EXECUTION_PLAN_WORKFLOW_PYTHON_OUTPUT_BYTES,
      );
    } catch {
      throw new ExecutionPlanWorkflowKernelError(
        "output_invalid",
        "Workflow Python output does not match its schema",
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
        "Workflow Python Kernel did not settle unchanged",
        run,
      );
    }
    const serializedOutput = canonicalJson(output);
    return {
      output,
      completionEventType: WORKFLOW_PYTHON_COMPLETED_EVENT,
      completionPayload: {
        attempt: options.attempt,
        manifestSha256: options.manifestSha256,
        pythonConfigurationSha256: workflowPythonConfigurationSha256(
          options.node,
        ),
        workerSha256: PYTHON_KERNEL_WORKER_SHA256,
        runtimeExecutableSha256: binding.runtimeExecutableSha256,
        runtimeCommandSha256: binding.runtimeCommandSha256,
        pythonVersion: finalEvaluation.pythonVersion,
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
        memoryPeakBytes: Math.max(
          binding.memoryPeakBytes,
          ...evaluations.map((evaluation) => evaluation.memoryPeakBytes),
        ),
        memoryLimitBytes: finalEvaluation.memoryLimitBytes,
        jsonValueSha256: finalEvaluation.jsonValueSha256!,
        jsonValueBytes: finalEvaluation.jsonValueBytes!,
        outputSchemaSha256: workflowSchemaSha256(options.node.outputSchema),
        outputCanonicalSha256: sha256(serializedOutput),
      },
    };
  }
}

function requireEvaluation(
  evaluation: PythonKernelEvaluation,
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
      "Workflow Python evaluation failed",
      run,
    );
  }
}
