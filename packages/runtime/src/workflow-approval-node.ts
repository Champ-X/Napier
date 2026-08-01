import type {
  ExecutionPlanWorkflowApprovalNode,
  ExecutionPlanWorkflowNodeResult,
  JsonValue,
  OperatorDecision,
  RunRecord,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import type { LocalStore } from "./store.js";
import {
  emitOperatorDecisionMutation,
  ExecutionPlanWorkflowApprovalRuntime,
  WorkflowApprovalRuntimeError,
} from "./workflow-approval-runtime.js";
import type {
  WorkflowExecutionContext,
  WorkflowNodeFailure,
} from "./workflow-context.js";
import {
  resolveWorkflowApproval,
  workflowApprovalAnsweredBeforeExpiry,
} from "./workflow-approval-model.js";
import {
  ExecutionPlanWorkflowLedger,
  WORKFLOW_EVENT_SCHEMA_VERSION,
  WORKFLOW_NODE_COMPLETED_EVENT,
  WORKFLOW_NODE_STARTED_EVENT,
  workflowNodeEventMetadata,
} from "./workflow-ledger.js";
import { completedWorkflowNodeResult } from "./workflow-runtime-model.js";
import { buildWorkflowExecutionNodeInput } from "./workflow-node-input.js";
import {
  assertWorkflowValue,
  workflowSchemaSha256,
} from "./workflow-schemas.js";

export interface WorkflowApprovalNodeOperations {
  completePlanStep(
    context: WorkflowExecutionContext,
    nodeId: string,
    runId: string,
    outputSha256: string,
  ): Promise<void>;
  blockNode(
    context: WorkflowExecutionContext,
    node: ExecutionPlanWorkflowApprovalNode,
    failure: WorkflowNodeFailure,
  ): Promise<ExecutionPlanWorkflowNodeResult>;
}

export interface WorkflowApprovalNodeOutcome {
  result: ExecutionPlanWorkflowNodeResult;
  cancelled: boolean;
}

export class ExecutionPlanWorkflowApprovalNodeExecutor {
  private readonly runtime: ExecutionPlanWorkflowApprovalRuntime;

  constructor(
    private readonly store: LocalStore,
    private readonly ledger: ExecutionPlanWorkflowLedger,
    private readonly operations: WorkflowApprovalNodeOperations,
  ) {
    this.runtime = new ExecutionPlanWorkflowApprovalRuntime(store, ledger);
  }

  async execute(
    context: WorkflowExecutionContext,
    node: ExecutionPlanWorkflowApprovalNode,
    _input: JsonValue,
    inputSha256: string,
    attempt: number,
  ): Promise<WorkflowApprovalNodeOutcome> {
    const controller = new AbortController();
    const forwardAbort = (): void => controller.abort();
    context.signal?.addEventListener("abort", forwardAbort, { once: true });
    if (context.signal?.aborted) controller.abort();
    if (controller.signal.aborted) {
      context.signal?.removeEventListener("abort", forwardAbort);
      return {
        result: await this.operations.blockNode(context, node, {
          inputSha256,
          attempt,
          errorCode: "cancelled",
          diagnosticSha256: sha256("Workflow approval was cancelled"),
        }),
        cancelled: true,
      };
    }
    let runId: string | undefined;
    try {
      const outcome = await this.runtime.request({
        threadId: context.threadId,
        planId: context.plan.id,
        manifestSha256: context.manifest.contentSha256,
        agentId: context.agentId,
        agentRevision: context.agentRevision,
        node,
        inputSha256,
        attempt,
        signal: controller.signal,
        ...(context.onEvent ? { onEvent: context.onEvent } : {}),
        onRunCreated: async (run) => {
          runId = run.id;
          const before = this.store.getPlan(context.plan.id);
          const started = await this.store.transitionPlanStep(
            context.plan.id,
            node.id,
            { action: "start", runId: run.id },
          );
          context.plan = started;
          await this.ledger.appendPlanStepEvent(
            context,
            started,
            node.id,
            "started",
            run.id,
          );
          await this.ledger.append(
            {
              threadId: context.threadId,
              runId: run.id,
              type: WORKFLOW_NODE_STARTED_EVENT,
              category: "plan",
              visibility: "user",
              payload: {
                schemaVersion: WORKFLOW_EVENT_SCHEMA_VERSION,
                planId: started.id,
                nodeId: node.id,
                ...workflowNodeEventMetadata(node),
                attempt,
                manifestSha256: context.manifest.contentSha256,
                inputSha256,
                inputSchemaSha256: workflowSchemaSha256(node.inputSchema),
                outputSchemaSha256: workflowSchemaSha256(node.outputSchema),
                planRevisionBefore: before.revision,
                planRevisionAfter: started.revision,
                recovered: false,
              },
            },
            context.onEvent,
          );
        },
      });
      return {
        result: waitingWorkflowApprovalResult(
          node,
          attempt,
          outcome.run.id,
          outcome.decision.id,
          inputSha256,
        ),
        cancelled: false,
      };
    } catch (error) {
      const cancelled =
        context.signal?.aborted === true ||
        (error instanceof WorkflowApprovalRuntimeError &&
          error.code === "cancelled");
      const errorCode =
        error instanceof WorkflowApprovalRuntimeError
          ? error.code
          : cancelled
            ? "cancelled"
            : "approval_request_failed";
      return {
        result: await this.operations.blockNode(context, node, {
          ...(error instanceof WorkflowApprovalRuntimeError && error.run
            ? { runId: error.run.id }
            : runId
              ? { runId }
              : {}),
          inputSha256,
          attempt,
          errorCode,
          diagnosticSha256: sha256(errorMessage(error)),
        }),
        cancelled,
      };
    } finally {
      context.signal?.removeEventListener("abort", forwardAbort);
    }
  }

  async recoverRunning(context: WorkflowExecutionContext): Promise<void> {
    context.plan = this.store.getPlan(context.plan.id);
    for (const node of context.manifest.nodes) {
      if (node.type !== "approval" || context.nodeResults.has(node.id)) {
        continue;
      }
      const step = context.plan.steps.find(
        (candidate) => candidate.id === node.id,
      );
      if (step?.status !== "running") continue;
      if (
        Object.values(node.inputBindings).some(
          (binding) =>
            binding.source === "node" && !context.outputs.has(binding.nodeId),
        )
      ) {
        continue;
      }
      if (!step.runId) {
        throw new Error("Workflow approval Plan step has no Run binding");
      }
      const input = buildWorkflowExecutionNodeInput(context, node);
      const inputSha256 = sha256(canonicalJson(input));
      const run = this.store
        .listRuns(context.threadId)
        .find((candidate) => candidate.id === step.runId);
      this.assertOriginRun(context, run);
      await this.ledger.ensureNodeStartedEvent(
        context,
        node,
        run.id,
        inputSha256,
      );
      const { decision, expiresAt } = await this.ledger.approvalDecision(
        context,
        node,
        run.id,
        inputSha256,
      );
      const attempt = await this.ledger.attemptForRun(
        context.threadId,
        context.plan.id,
        node.id,
        run.id,
      );
      const outcome = await this.resolveDecision(
        context,
        node,
        run,
        decision,
        expiresAt,
        inputSha256,
        attempt,
      );
      context.nodeResults.set(node.id, outcome);
      if (outcome.output !== undefined) {
        context.outputs.set(node.id, structuredClone(outcome.output));
      }
      context.plan = this.store.getPlan(context.plan.id);
    }
  }

  private async resolveDecision(
    context: WorkflowExecutionContext,
    node: ExecutionPlanWorkflowApprovalNode,
    originRun: RunRecord,
    decision: OperatorDecision,
    expiresAt: string,
    inputSha256: string,
    attempt: number,
  ): Promise<ExecutionPlanWorkflowNodeResult> {
    if (decision.status === "pending") {
      if (Date.now() < Date.parse(expiresAt)) {
        return waitingWorkflowApprovalResult(
          node,
          attempt,
          originRun.id,
          decision.id,
          inputSha256,
        );
      }
      const cancelled = await this.store.cancelOperatorDecision(
        context.threadId,
        decision.id,
        "workflow_timed_out",
      );
      await emitOperatorDecisionMutation(cancelled, context.onEvent);
      return this.blockApproval(
        context,
        node,
        originRun.id,
        inputSha256,
        attempt,
        "approval_timeout",
        sha256(canonicalJson({ decisionId: decision.id, expiresAt })),
      );
    }
    if (decision.status === "cancelled") {
      return this.blockApproval(
        context,
        node,
        originRun.id,
        inputSha256,
        attempt,
        decision.cancellationReason === "workflow_timed_out"
          ? "approval_timeout"
          : "approval_cancelled",
        sha256(
          canonicalJson({
            decisionId: decision.id,
            reason: decision.cancellationReason ?? "",
          }),
        ),
      );
    }
    if (
      (decision.status === "answered" || decision.status === "continued") &&
      !workflowApprovalAnsweredBeforeExpiry(decision, expiresAt)
    ) {
      if (decision.status === "answered") {
        const cancelled = await this.store.cancelOperatorDecision(
          context.threadId,
          decision.id,
          "workflow_timed_out",
        );
        await emitOperatorDecisionMutation(cancelled, context.onEvent);
      }
      return this.blockApproval(
        context,
        node,
        originRun.id,
        inputSha256,
        attempt,
        "approval_timeout",
        sha256(canonicalJson({ decisionId: decision.id, expiresAt })),
      );
    }
    const continued =
      decision.status === "answered"
        ? await this.runtime.continue({
            threadId: context.threadId,
            planId: context.plan.id,
            agentId: context.agentId,
            agentRevision: context.agentRevision,
            originRun,
            decision,
            ...(context.onEvent ? { onEvent: context.onEvent } : {}),
          })
        : decision;
    return this.settleResolution(
      context,
      node,
      originRun.id,
      continued,
      inputSha256,
      attempt,
      decision.status === "continued",
    );
  }

  private async settleResolution(
    context: WorkflowExecutionContext,
    node: ExecutionPlanWorkflowApprovalNode,
    originRunId: string,
    decision: OperatorDecision,
    inputSha256: string,
    attempt: number,
    recovered: boolean,
  ): Promise<ExecutionPlanWorkflowNodeResult> {
    if (decision.status !== "continued" || !decision.continuationRunId) {
      throw new Error("Workflow approval decision is not continued");
    }
    const continuationRun = this.store
      .listRuns(context.threadId)
      .find((candidate) => candidate.id === decision.continuationRunId);
    if (
      !continuationRun ||
      continuationRun.source !== "workflow" ||
      continuationRun.parentRunId !== originRunId ||
      continuationRun.agentId !== context.agentId ||
      continuationRun.agentRevision !== context.agentRevision ||
      (continuationRun.status !== "completed" &&
        continuationRun.status !== "interrupted")
    ) {
      throw new Error("Workflow approval continuation Run binding is invalid");
    }
    const resolution = resolveWorkflowApproval(node, decision);
    if (resolution.status !== "approved") {
      return this.blockApproval(
        context,
        node,
        originRunId,
        inputSha256,
        attempt,
        resolution.status === "rejected"
          ? "approval_rejected"
          : "approval_answer_invalid",
        sha256(
          canonicalJson({
            decisionId: decision.id,
            answerSha256: decision.answerSha256 ?? "",
          }),
        ),
      );
    }
    assertWorkflowValue(
      node.outputSchema,
      resolution.output,
      `Workflow approval output ${node.id}`,
    );
    const outputSha256 = sha256(canonicalJson(resolution.output));
    await this.operations.completePlanStep(
      context,
      node.id,
      originRunId,
      outputSha256,
    );
    if (recovered) {
      await this.ledger.verifyOrRecoverNodeCompletedEvent(
        context,
        node,
        originRunId,
        inputSha256,
        outputSha256,
      );
    } else {
      await this.ledger.append(
        {
          threadId: context.threadId,
          runId: originRunId,
          type: WORKFLOW_NODE_COMPLETED_EVENT,
          category: "plan",
          visibility: "user",
          payload: {
            schemaVersion: WORKFLOW_EVENT_SCHEMA_VERSION,
            planId: context.plan.id,
            nodeId: node.id,
            ...workflowNodeEventMetadata(node),
            attempt,
            manifestSha256: context.manifest.contentSha256,
            inputSha256,
            outputSha256,
            inputSchemaSha256: workflowSchemaSha256(node.inputSchema),
            outputSchemaSha256: workflowSchemaSha256(node.outputSchema),
            recovered: false,
          },
        },
        context.onEvent,
      );
    }
    return completedWorkflowNodeResult(
      node,
      attempt,
      originRunId,
      inputSha256,
      resolution.output,
    );
  }

  private assertOriginRun(
    context: WorkflowExecutionContext,
    run: RunRecord | undefined,
  ): asserts run is RunRecord {
    if (
      !run ||
      run.source !== "workflow" ||
      run.agentId !== context.agentId ||
      run.agentRevision !== context.agentRevision ||
      (run.status !== "completed" && run.status !== "interrupted")
    ) {
      throw new Error("Workflow approval origin Run binding is invalid");
    }
  }

  private blockApproval(
    context: WorkflowExecutionContext,
    node: ExecutionPlanWorkflowApprovalNode,
    runId: string,
    inputSha256: string,
    attempt: number,
    errorCode: string,
    diagnosticSha256: string,
  ): Promise<ExecutionPlanWorkflowNodeResult> {
    return this.operations.blockNode(context, node, {
      runId,
      inputSha256,
      attempt,
      errorCode,
      diagnosticSha256,
    });
  }
}

function waitingWorkflowApprovalResult(
  node: ExecutionPlanWorkflowApprovalNode,
  attempt: number,
  runId: string,
  decisionId: string,
  inputSha256: string,
): ExecutionPlanWorkflowNodeResult {
  return {
    nodeId: node.id,
    attempt,
    status: "waiting",
    runId,
    decisionId,
    inputSha256,
    inputSchemaSha256: workflowSchemaSha256(node.inputSchema),
    outputSchemaSha256: workflowSchemaSha256(node.outputSchema),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
