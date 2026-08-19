import type {
  ExecutionPlanWorkflowLoopNode,
  ExecutionPlanWorkflowManifest,
  JsonValue,
  ModelRef,
  RunRecord,
} from "@napier/contracts";

import type { EventSink } from "./event-sink.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import {
  ExecutionPlanWorkflowLedger,
  WORKFLOW_EVENT_SCHEMA_VERSION,
} from "./workflow-ledger.js";
import {
  WORKFLOW_LOOP_ITERATION_COMPLETED_EVENT,
  WORKFLOW_LOOP_ITERATION_FAILED_EVENT,
  WORKFLOW_LOOP_ITERATION_STARTED_EVENT,
  type WorkflowLoopCheckpointIteration,
} from "./workflow-loop-evidence.js";
import { ExecutionPlanWorkflowLoopError } from "./workflow-loop-error.js";
import {
  evaluateWorkflowLoopUntil,
  workflowLoopIterationContext,
  workflowLoopIterationInputSha256,
  workflowLoopIterationPrompt,
  workflowLoopNodeConfigurationSha256,
} from "./workflow-loop-model.js";
import { WORKFLOW_NODE_EXECUTION } from "./workflow-node-execution.js";
import {
  parseExecutionPlanWorkflowNodeOutput,
  workflowSchemaSha256,
} from "./workflow-schemas.js";
import type { WorkflowAgentExecutionPort } from "./workflow-runtime-ports.js";

export interface ExecuteWorkflowLoopIterationOptions {
  threadId: string;
  planId: string;
  manifest: ExecutionPlanWorkflowManifest;
  agentRevision: number;
  node: ExecutionPlanWorkflowLoopNode;
  input: JsonValue;
  inputSha256: string;
  attempt: number;
  onEvent?: EventSink;
}

export class ExecutionPlanWorkflowLoopIterationRuntime {
  constructor(
    private readonly agentExecution: WorkflowAgentExecutionPort,
    private readonly ledger: ExecutionPlanWorkflowLedger,
  ) {}

  async execute(
    options: ExecuteWorkflowLoopIterationOptions,
    coordinator: RunRecord,
    model: ModelRef,
    iterationIndex: number,
    previousOutput: JsonValue | undefined,
    signal: AbortSignal,
  ): Promise<WorkflowLoopCheckpointIteration> {
    const context = workflowLoopIterationContext(
      options.node,
      options.input,
      previousOutput,
      iterationIndex,
    );
    const iterationInputSha256 = workflowLoopIterationInputSha256(
      options.inputSha256,
      context,
    );
    const controller = new AbortController();
    let timedOut = false;
    let childRunId: string | undefined;
    const forwardAbort = (): void => controller.abort();
    signal.addEventListener("abort", forwardAbort, { once: true });
    if (signal.aborted) controller.abort();
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.node.iterationTimeoutMs);
    try {
      const run = await this.agentExecution.runPrompt({
        threadId: options.threadId,
        text: workflowLoopIterationPrompt(
          options.manifest,
          options.node,
          context,
        ),
        source: "workflow",
        [WORKFLOW_NODE_EXECUTION]: { planId: options.planId },
        agentRevision: options.agentRevision,
        executionMode: "workflow_loop_read_only",
        parentRunId: coordinator.id,
        signal: controller.signal,
        model,
        onRunCreated: async (createdRun) => {
          childRunId = createdRun.id;
          await this.ledger.append(
            {
              threadId: options.threadId,
              runId: createdRun.id,
              type: WORKFLOW_LOOP_ITERATION_STARTED_EVENT,
              category: "plan",
              visibility: "user",
              payload: {
                schemaVersion: WORKFLOW_EVENT_SCHEMA_VERSION,
                planId: options.planId,
                nodeId: options.node.id,
                coordinatorRunId: coordinator.id,
                attempt: options.attempt,
                manifestSha256: options.manifest.contentSha256,
                loopConfigurationSha256: workflowLoopNodeConfigurationSha256(
                  options.node,
                ),
                iterationIndex,
                maxIterations: options.node.maxIterations,
                iterationInputSha256,
                outputSchemaSha256: workflowSchemaSha256(
                  options.node.outputSchema,
                ),
              },
            },
            options.onEvent,
          );
        },
        ...(options.onEvent ? { onEvent: options.onEvent } : {}),
      });
      if (timedOut) {
        throw new ExecutionPlanWorkflowLoopError(
          "iteration_timeout",
          "Workflow Loop iteration timed out",
          coordinator,
        );
      }
      if (run.status !== "completed") {
        throw new ExecutionPlanWorkflowLoopError(
          `iteration_run_${run.status}`,
          "Workflow Loop iteration Run did not complete",
          coordinator,
        );
      }
      let output: JsonValue;
      try {
        output = parseExecutionPlanWorkflowNodeOutput(
          await this.ledger.nodeAssistantOutput(options.threadId, run.id),
          options.node.outputSchema,
        );
      } catch {
        throw new ExecutionPlanWorkflowLoopError(
          "iteration_output_invalid",
          "Workflow Loop iteration output does not match its schema",
          coordinator,
        );
      }
      const serializedOutput = canonicalJson(output);
      const outputSha256 = sha256(serializedOutput);
      const evaluation = evaluateWorkflowLoopUntil(options.node, output);
      const completed = await this.ledger.append(
        {
          threadId: options.threadId,
          runId: run.id,
          type: WORKFLOW_LOOP_ITERATION_COMPLETED_EVENT,
          category: "plan",
          visibility: "user",
          payload: {
            schemaVersion: WORKFLOW_EVENT_SCHEMA_VERSION,
            planId: options.planId,
            nodeId: options.node.id,
            coordinatorRunId: coordinator.id,
            attempt: options.attempt,
            manifestSha256: options.manifest.contentSha256,
            loopConfigurationSha256: workflowLoopNodeConfigurationSha256(
              options.node,
            ),
            iterationIndex,
            iterationInputSha256,
            outputSha256,
            outputBytes: Buffer.byteLength(serializedOutput, "utf8"),
            outputSchemaSha256: workflowSchemaSha256(options.node.outputSchema),
            untilSubjectSha256: evaluation.subjectSha256,
            matched: evaluation.matched,
          },
        },
        options.onEvent,
      );
      return {
        iterationIndex,
        coordinatorRunId: coordinator.id,
        childRunId: run.id,
        iterationInputSha256,
        output,
        outputSha256,
        untilSubjectSha256: evaluation.subjectSha256,
        matched: evaluation.matched,
        completedEventSeq: completed.seq,
      };
    } catch (error) {
      if (childRunId) {
        await this.recordFailure(
          options,
          coordinator.id,
          childRunId,
          iterationIndex,
          iterationInputSha256,
          timedOut,
          error,
        );
      }
      if (error instanceof ExecutionPlanWorkflowLoopError) throw error;
      throw new ExecutionPlanWorkflowLoopError(
        timedOut ? "iteration_timeout" : "iteration_failed",
        "Workflow Loop iteration failed",
        coordinator,
      );
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", forwardAbort);
    }
  }

  private async recordFailure(
    options: ExecuteWorkflowLoopIterationOptions,
    coordinatorRunId: string,
    childRunId: string,
    iterationIndex: number,
    iterationInputSha256: string,
    timedOut: boolean,
    error: unknown,
  ): Promise<void> {
    await this.ledger
      .append(
        {
          threadId: options.threadId,
          runId: childRunId,
          type: WORKFLOW_LOOP_ITERATION_FAILED_EVENT,
          category: "plan",
          visibility: "user",
          payload: {
            schemaVersion: WORKFLOW_EVENT_SCHEMA_VERSION,
            planId: options.planId,
            nodeId: options.node.id,
            coordinatorRunId,
            attempt: options.attempt,
            manifestSha256: options.manifest.contentSha256,
            loopConfigurationSha256: workflowLoopNodeConfigurationSha256(
              options.node,
            ),
            iterationIndex,
            iterationInputSha256,
            errorCode:
              error instanceof ExecutionPlanWorkflowLoopError
                ? error.code
                : timedOut
                  ? "iteration_timeout"
                  : "iteration_failed",
            diagnosticSha256: sha256(errorMessage(error)),
          },
        },
        options.onEvent,
      )
      .catch(() => undefined);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
