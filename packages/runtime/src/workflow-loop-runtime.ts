import {
  emptyUsage,
  type ExecutionPlanWorkflowLoopNode,
  type ExecutionPlanWorkflowManifest,
  type JsonValue,
  type RunRecord,
} from "@napier/contracts";

import type { EventSink } from "./event-sink.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import { createProcessLeaseOwnerId } from "./ids.js";
import type { LocalStore } from "./store.js";
import {
  ExecutionPlanWorkflowLedger,
  WORKFLOW_EVENT_SCHEMA_VERSION,
} from "./workflow-ledger.js";
import {
  recoverWorkflowLoopCheckpoint,
  workflowLoopCheckpointSha256,
  WORKFLOW_LOOP_CHECKPOINT_REUSED_EVENT,
  WORKFLOW_LOOP_COMPLETED_EVENT,
} from "./workflow-loop-evidence.js";
import { ExecutionPlanWorkflowLoopError } from "./workflow-loop-error.js";
import { ExecutionPlanWorkflowLoopIterationRuntime } from "./workflow-loop-iteration-runtime.js";
import { workflowLoopNodeConfigurationSha256 } from "./workflow-loop-model.js";
import { WORKFLOW_NODE_EXECUTION } from "./workflow-node-execution.js";
import {
  assertWorkflowEncodedBytes,
  assertWorkflowValue,
  MAX_EXECUTION_PLAN_WORKFLOW_NODE_OUTPUT_BYTES,
  workflowSchemaSha256,
} from "./workflow-schemas.js";
import type { WorkflowAgentExecutionPort } from "./workflow-runtime-ports.js";

const RUN_LEASE_TTL_MS = 60_000;
const RUN_LEASE_HEARTBEAT_MS = 20_000;

export interface ExecuteExecutionPlanWorkflowLoopOptions {
  threadId: string;
  planId: string;
  manifest: ExecutionPlanWorkflowManifest;
  agentId: string;
  agentRevision: number;
  node: ExecutionPlanWorkflowLoopNode;
  input: JsonValue;
  inputSha256: string;
  attempt: number;
  signal: AbortSignal;
  wasTimedOut?(): boolean;
  onEvent?: EventSink;
  onRunCreated(run: RunRecord): Promise<void>;
}

export interface ExecutionPlanWorkflowLoopOutcome {
  run: RunRecord;
  output: JsonValue;
  iterationCount: number;
  reusedIterationCount: number;
}

export class ExecutionPlanWorkflowLoopRuntime {
  private readonly workerId = createProcessLeaseOwnerId("workflowloop");
  private readonly iterations: ExecutionPlanWorkflowLoopIterationRuntime;

  constructor(
    private readonly store: LocalStore,
    agentExecution: WorkflowAgentExecutionPort,
    private readonly ledger: ExecutionPlanWorkflowLedger,
  ) {
    this.iterations = new ExecutionPlanWorkflowLoopIterationRuntime(
      agentExecution,
      ledger,
    );
  }

  async execute(
    options: ExecuteExecutionPlanWorkflowLoopOptions,
  ): Promise<ExecutionPlanWorkflowLoopOutcome> {
    options.signal.throwIfAborted();
    const profile = this.store.getAgentRevision(
      options.agentId,
      options.agentRevision,
    ).profile;
    const model = options.node.model ?? profile.model;
    const leased = await this.store.createLeasedRun(
      {
        threadId: options.threadId,
        agentId: options.agentId,
        agentRevision: options.agentRevision,
        model,
        source: "workflow",
        [WORKFLOW_NODE_EXECUTION]: { planId: options.planId },
      },
      {
        ownerId: this.workerId,
        ttlMs: RUN_LEASE_TTL_MS,
      },
    );
    let settled = false;
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
            model: `${model.provider}/${model.id}`,
            source: "workflow",
            workflowNodeType: "loop",
            configurationSha256: leased.run.configuration?.contentSha256 ?? "",
          },
        },
        options.onEvent,
      );
      const checkpoint = recoverWorkflowLoopCheckpoint({
        events: await this.store.listEvents(options.threadId),
        runs: this.store.listRuns(options.threadId),
        node: options.node,
        planId: options.planId,
        manifestSha256: options.manifest.contentSha256,
        nodeInput: options.input,
        nodeInputSha256: options.inputSha256,
        agentId: options.agentId,
        agentRevision: options.agentRevision,
        model,
      });
      if (checkpoint.iterations.length > 0) {
        await this.ledger.append(
          {
            threadId: options.threadId,
            runId: leased.run.id,
            type: WORKFLOW_LOOP_CHECKPOINT_REUSED_EVENT,
            category: "plan",
            visibility: "user",
            payload: {
              schemaVersion: WORKFLOW_EVENT_SCHEMA_VERSION,
              planId: options.planId,
              nodeId: options.node.id,
              attempt: options.attempt,
              manifestSha256: options.manifest.contentSha256,
              loopConfigurationSha256: workflowLoopNodeConfigurationSha256(
                options.node,
              ),
              inputSha256: options.inputSha256,
              reusedIterationCount: checkpoint.iterations.length,
              checkpointSha256: checkpoint.checkpointSha256,
              sourceCoordinatorSetSha256: sha256(
                canonicalJson(
                  checkpoint.iterations.map(
                    (iteration) => iteration.coordinatorRunId,
                  ),
                ),
              ),
              lastOutputSha256: checkpoint.iterations.at(-1)!.outputSha256,
              matched: checkpoint.matched,
            },
          },
          options.onEvent,
        );
      }
      const iterations = [...checkpoint.iterations];
      let previousOutput = checkpoint.output;
      let matched = checkpoint.matched;
      for (
        let iterationIndex = iterations.length;
        iterationIndex < options.node.maxIterations && !matched;
        iterationIndex += 1
      ) {
        controller.signal.throwIfAborted();
        const iteration = await this.iterations.execute(
          options,
          leased.run,
          model,
          iterationIndex,
          previousOutput,
          controller.signal,
        );
        iterations.push(iteration);
        previousOutput = iteration.output;
        matched = iteration.matched;
      }
      if (!matched || previousOutput === undefined) {
        throw new ExecutionPlanWorkflowLoopError(
          "iteration_limit",
          "Workflow Loop exhausted its iteration limit",
          leased.run,
        );
      }
      assertWorkflowEncodedBytes(
        previousOutput,
        MAX_EXECUTION_PLAN_WORKFLOW_NODE_OUTPUT_BYTES,
        `Workflow Loop output ${options.node.id}`,
      );
      assertWorkflowValue(
        options.node.outputSchema,
        previousOutput,
        `Workflow Loop output ${options.node.id}`,
      );
      controller.signal.throwIfAborted();
      const serializedOutput = canonicalJson(previousOutput);
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
            model: "napier/workflow-loop",
            usage: emptyUsage(),
          },
        },
        options.onEvent,
      );
      controller.signal.throwIfAborted();
      const reusedIterationCount = iterations.filter(
        (iteration) => iteration.coordinatorRunId !== leased.run.id,
      ).length;
      await this.ledger.append(
        {
          threadId: options.threadId,
          runId: leased.run.id,
          type: WORKFLOW_LOOP_COMPLETED_EVENT,
          category: "plan",
          visibility: "user",
          payload: {
            schemaVersion: WORKFLOW_EVENT_SCHEMA_VERSION,
            planId: options.planId,
            nodeId: options.node.id,
            attempt: options.attempt,
            manifestSha256: options.manifest.contentSha256,
            loopConfigurationSha256: workflowLoopNodeConfigurationSha256(
              options.node,
            ),
            inputSha256: options.inputSha256,
            outputSha256,
            outputBytes: Buffer.byteLength(serializedOutput, "utf8"),
            outputSchemaSha256: workflowSchemaSha256(options.node.outputSchema),
            iterationCount: iterations.length,
            reusedIterationCount,
            maxIterations: options.node.maxIterations,
            iterationRunSetSha256: sha256(
              canonicalJson(
                iterations.map((iteration) => iteration.childRunId),
              ),
            ),
            checkpointSha256: workflowLoopCheckpointSha256(iterations),
            untilSubjectSha256: iterations.at(-1)!.untilSubjectSha256,
            termination: "condition_matched",
          },
        },
        options.onEvent,
      );
      const run = await this.store.finishRun(leased.run.id, "completed", {
        leaseToken: leased.token,
        terminalEvent: {
          visibility: "debug",
          payload: { status: "completed" },
        },
        onTerminalEvent: options.onEvent,
      });
      settled = true;
      return {
        run,
        output: previousOutput,
        iterationCount: iterations.length,
        reusedIterationCount,
      };
    } catch (error) {
      if (settled) throw error;
      const timedOut = options.wasTimedOut?.() === true;
      const cancelled = options.signal.aborted && !timedOut;
      const code =
        error instanceof ExecutionPlanWorkflowLoopError
          ? error.code
          : leaseLost
            ? "lease_lost"
            : timedOut
              ? "timeout"
              : cancelled
                ? "cancelled"
                : "loop_failed";
      const diagnosticSha256 = sha256(errorMessage(error));
      await this.store
        .finishRun(leased.run.id, cancelled ? "cancelled" : "failed", {
          error: `Workflow Loop ${code}`,
          leaseToken: leased.token,
          terminalEvent: {
            visibility: "user",
            payload: {
              status: cancelled ? "cancelled" : "failed",
              errorCode: code,
              diagnosticSha256,
            },
          },
          onTerminalEvent: options.onEvent,
        })
        .catch(() => undefined);
      if (error instanceof ExecutionPlanWorkflowLoopError) throw error;
      throw new ExecutionPlanWorkflowLoopError(
        code,
        "Workflow Loop execution failed",
        leased.run,
      );
    } finally {
      clearInterval(heartbeat);
      options.signal.removeEventListener("abort", forwardAbort);
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
