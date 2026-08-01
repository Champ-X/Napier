import type {
  ExecutionPlanWorkflowBreakpoint,
  ExecutionPlanWorkflowNode,
  ExecutionPlanWorkflowNodeResult,
  ExecutionPlanWorkflowResult,
  JsonValue,
} from "@napier/contracts";

import type { AgentRuntime } from "./agent-runtime.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import { createId } from "./ids.js";
import type { LocalStore } from "./store.js";
import type {
  WorkflowExecutionContext,
  WorkflowNodeFailure,
} from "./workflow-context.js";
import {
  ExecutionPlanWorkflowContextFactory,
  type RunExecutionPlanWorkflowOptions,
} from "./workflow-context-factory.js";
import { evaluateExecutionPlanWorkflowCondition } from "./workflow-condition-model.js";
import { ExecutionPlanWorkflowConditionNodeExecutor } from "./workflow-condition-node.js";
import {
  ExecutionPlanWorkflowLedger,
  WORKFLOW_EVENT_SCHEMA_VERSION,
  WORKFLOW_NODE_FAILED_EVENT,
  workflowNodeEventMetadata,
} from "./workflow-ledger.js";
import { ExecutionPlanWorkflowRecovery } from "./workflow-recovery.js";
import {
  validateExecutionPlanWorkflowManifest,
  workflowSchemaSha256,
} from "./workflow-manifests.js";
import {
  buildWorkflowExecutionNodeInput,
  workflowExecutionNodeBindingContextSha256,
} from "./workflow-node-input.js";
import { ExecutionPlanWorkflowReuseMaterializer } from "./workflow-reuse-materializer.js";
import { ExecutionPlanWorkflowSimulationMaterializer } from "./workflow-simulation-materializer.js";
import { ExecutionPlanWorkflowArtifactSettlement } from "./workflow-artifact-settlement.js";
import { ExecutionPlanWorkflowBreakpointRuntime } from "./workflow-breakpoints.js";
import {
  ExecutionPlanWorkflowNodeDispatcher,
  type WorkflowNodeExecutionOutcome,
} from "./workflow-node-dispatcher.js";
import { executeExecutionPlanWorkflowReadyBatch } from "./workflow-parallel-scheduler.js";
import { finishExecutionPlanWorkflow } from "./workflow-result.js";

export type { RunExecutionPlanWorkflowOptions } from "./workflow-context-factory.js";

export class ExecutionPlanWorkflowRuntime {
  private readonly activeThreads = new Set<string>();
  private readonly ledger: ExecutionPlanWorkflowLedger;
  private readonly artifactSettlement: ExecutionPlanWorkflowArtifactSettlement;
  private readonly breakpointRuntime: ExecutionPlanWorkflowBreakpointRuntime;
  private readonly contexts: ExecutionPlanWorkflowContextFactory;
  private readonly recovery: ExecutionPlanWorkflowRecovery;
  private readonly reuseMaterializer: ExecutionPlanWorkflowReuseMaterializer;
  private readonly simulationMaterializer: ExecutionPlanWorkflowSimulationMaterializer;
  private readonly conditionNodeExecutor: ExecutionPlanWorkflowConditionNodeExecutor;
  private readonly nodeDispatcher: ExecutionPlanWorkflowNodeDispatcher;

  constructor(
    private readonly store: LocalStore,
    agentRuntime: AgentRuntime,
  ) {
    this.ledger = new ExecutionPlanWorkflowLedger(store);
    this.contexts = new ExecutionPlanWorkflowContextFactory(store, this.ledger);
    this.artifactSettlement = new ExecutionPlanWorkflowArtifactSettlement(
      store,
    );
    this.breakpointRuntime = new ExecutionPlanWorkflowBreakpointRuntime(
      store,
      this.ledger,
    );
    this.conditionNodeExecutor = new ExecutionPlanWorkflowConditionNodeExecutor(
      store,
      this.ledger,
    );
    this.nodeDispatcher = new ExecutionPlanWorkflowNodeDispatcher(
      store,
      agentRuntime,
      this.ledger,
      {
        blockNode: (context, node, failure) =>
          this.blockNode(context, node, failure),
        completePlanStep: (context, nodeId, runId, outputSha256) =>
          this.completePlanStep(context, nodeId, runId, outputSha256),
      },
    );
    this.recovery = new ExecutionPlanWorkflowRecovery(store, this.ledger, {
      blockNode: (context, node, failure) =>
        this.blockNode(context, node, failure),
      completePlanStep: (context, nodeId, runId, outputSha256) =>
        this.completePlanStep(context, nodeId, runId, outputSha256),
    });
    this.reuseMaterializer = new ExecutionPlanWorkflowReuseMaterializer(
      store,
      this.ledger,
      {
        completePlanStep: (context, nodeId, runId, outputSha256) =>
          this.completePlanStep(context, nodeId, runId, outputSha256),
      },
    );
    this.simulationMaterializer =
      new ExecutionPlanWorkflowSimulationMaterializer(store, this.ledger, {
        completePlanStep: (context, nodeId, runId, outputSha256) =>
          this.completePlanStep(context, nodeId, runId, outputSha256),
      });
  }

  async run(
    options: RunExecutionPlanWorkflowOptions,
  ): Promise<ExecutionPlanWorkflowResult> {
    options.signal?.throwIfAborted();
    this.store.getThread(options.threadId);
    const manifest = validateExecutionPlanWorkflowManifest(
      options.request.manifest,
    );
    if (
      "planId" in options.request &&
      options.request.retryBlocked === true &&
      options.request.continueBreakpoint === true
    ) {
      throw new Error(
        "Workflow retry and breakpoint continuation are mutually exclusive",
      );
    }
    if (this.activeThreads.has(options.threadId)) {
      throw new Error("Thread already has an active Workflow execution");
    }
    this.activeThreads.add(options.threadId);
    try {
      const context =
        "planId" in options.request
          ? await this.contexts.resume(options, manifest)
          : await this.contexts.create(options, manifest);
      return await this.executeContext(context);
    } finally {
      this.activeThreads.delete(options.threadId);
    }
  }

  private async executeContext(
    context: WorkflowExecutionContext,
  ): Promise<ExecutionPlanWorkflowResult> {
    await this.recovery.recoverCompletedAndInterruptedNodes(context);
    await this.nodeDispatcher.recoverRunningApprovals(context);
    await this.recovery.recoverBlockedNodeResults(context);
    await this.recovery.reopenInterruptedPureNodes(context);
    if (context.reusedNodes.length > 0) {
      await this.reuseMaterializer.reopenInterrupted(
        context,
        context.reusedNodes,
      );
      await this.reuseMaterializer.materialize(context, context.reusedNodes);
      if (context.signal?.aborted) {
        return this.finish(context, "cancelled");
      }
    }
    if (context.simulatedNodes.length > 0) {
      await this.simulationMaterializer.reopenInterrupted(
        context,
        context.simulatedNodes,
      );
      await this.simulationMaterializer.materialize(
        context,
        context.simulatedNodes,
      );
      if (context.signal?.aborted) {
        return this.finish(context, "cancelled");
      }
    }
    if (context.retryBlocked) {
      await this.recovery.reopenRetryableNodes(context);
    }

    for (;;) {
      if (context.signal?.aborted) {
        return this.finish(context, "cancelled");
      }
      context.plan = this.store.getPlan(context.plan.id);
      const breakpoint = await this.breakpointRuntime.beforeReadyBatch(context);
      if (breakpoint === "cancelled") {
        return this.finish(context, "cancelled");
      }
      if (breakpoint && !("releasedNodeId" in breakpoint)) {
        return this.finish(context, "paused", breakpoint);
      }
      const batch = await executeExecutionPlanWorkflowReadyBatch(
        context,
        (nodeContext, node) => this.executeNode(nodeContext, node),
        breakpoint?.releasedNodeId,
      );
      if (batch.length === 0) break;
      let cancelled = false;
      for (const { node, outcome } of batch) {
        context.nodeResults.set(node.id, outcome.result);
        if (outcome.result.output !== undefined) {
          context.outputs.set(node.id, structuredClone(outcome.result.output));
        }
        cancelled ||= outcome.cancelled;
      }
      context.plan = this.store.getPlan(context.plan.id);
      if (cancelled) {
        return this.finish(context, "cancelled");
      }
    }

    context.plan = this.store.getPlan(context.plan.id);
    if (
      context.plan.steps.every(
        (step) => step.status === "completed" || step.status === "skipped",
      )
    ) {
      return this.finish(
        context,
        await this.artifactSettlement.settleTerminal(context),
      );
    }
    if (
      [...context.nodeResults.values()].some(
        (result) => result.status === "waiting",
      )
    ) {
      return this.finish(context, "waiting");
    }
    return this.finish(context, "blocked");
  }

  private async executeNode(
    context: WorkflowExecutionContext,
    node: ExecutionPlanWorkflowNode,
  ): Promise<WorkflowNodeExecutionOutcome> {
    const attempt = await this.ledger.nextAttempt(
      context.threadId,
      context.plan.id,
      node.id,
    );
    let input: JsonValue;
    try {
      input = buildWorkflowExecutionNodeInput(context, node);
    } catch (error) {
      return {
        result: await this.blockNode(context, node, {
          inputSha256: workflowExecutionNodeBindingContextSha256(context, node),
          attempt: Math.min(attempt, node.maxAttempts),
          errorCode:
            attempt > node.maxAttempts ? "attempt_limit" : "input_invalid",
          diagnosticSha256: sha256(errorMessage(error)),
        }),
        cancelled: false,
      };
    }
    const inputSha256 = sha256(canonicalJson(input));
    if (node.when) {
      let evaluation;
      try {
        evaluation = evaluateExecutionPlanWorkflowCondition(
          node.when,
          input,
          node.id,
        );
      } catch (error) {
        return {
          result: await this.blockNode(context, node, {
            inputSha256,
            attempt: Math.min(attempt, node.maxAttempts),
            errorCode:
              attempt > node.maxAttempts
                ? "attempt_limit"
                : "condition_invalid",
            diagnosticSha256: sha256(errorMessage(error)),
          }),
          cancelled: false,
        };
      }
      if (!evaluation.matched) {
        return {
          result: await this.conditionNodeExecutor.skip(
            context,
            node,
            inputSha256,
            evaluation,
          ),
          cancelled: false,
        };
      }
    }
    if (attempt > node.maxAttempts) {
      return {
        result: await this.blockNode(context, node, {
          inputSha256,
          attempt: node.maxAttempts,
          errorCode: "attempt_limit",
          diagnosticSha256: sha256("Workflow node attempt limit exhausted"),
        }),
        cancelled: false,
      };
    }
    return this.nodeDispatcher.execute(
      context,
      node,
      input,
      inputSha256,
      attempt,
    );
  }

  private async completePlanStep(
    context: WorkflowExecutionContext,
    nodeId: string,
    runId: string,
    outputSha256: string,
  ): Promise<void> {
    const before = this.store.getPlan(context.plan.id);
    if (
      before.steps.find((step) => step.id === nodeId)?.status === "completed"
    ) {
      context.plan = before;
      return;
    }
    const plan = await this.store.transitionPlanStep(context.plan.id, nodeId, {
      action: "complete",
      evidence: `Workflow output ${outputSha256} passed its runtime schema.`,
    });
    context.plan = plan;
    await this.ledger.appendPlanStepEvent(
      context,
      plan,
      nodeId,
      "completed",
      runId,
    );
  }

  private async blockNode(
    context: WorkflowExecutionContext,
    node: ExecutionPlanWorkflowNode,
    input: WorkflowNodeFailure,
  ): Promise<ExecutionPlanWorkflowNodeResult> {
    const current = this.store.getPlan(context.plan.id);
    const step = current.steps.find((candidate) => candidate.id === node.id)!;
    let plan = current;
    if (step.status === "ready" || step.status === "running") {
      plan = await this.store.transitionPlanStep(current.id, node.id, {
        action: "block",
        blocker: `Workflow node failed (${input.errorCode}).`,
        evidence: `Diagnostic SHA-256: ${input.diagnosticSha256}`,
      });
      await this.ledger.appendPlanStepEvent(
        context,
        plan,
        node.id,
        "blocked",
        input.runId ?? createId("runctl"),
      );
    }
    context.plan = plan;
    await this.ledger.append(
      {
        threadId: context.threadId,
        runId: input.runId ?? createId("runctl"),
        type: WORKFLOW_NODE_FAILED_EVENT,
        category: "plan",
        visibility: "user",
        payload: {
          schemaVersion: WORKFLOW_EVENT_SCHEMA_VERSION,
          planId: plan.id,
          nodeId: node.id,
          ...workflowNodeEventMetadata(node),
          attempt: input.attempt,
          manifestSha256: context.manifest.contentSha256,
          inputSha256: input.inputSha256,
          inputSchemaSha256: workflowSchemaSha256(node.inputSchema),
          outputSchemaSha256: workflowSchemaSha256(node.outputSchema),
          errorCode: input.errorCode,
          diagnosticSha256: input.diagnosticSha256,
        },
      },
      context.onEvent,
    );
    return {
      nodeId: node.id,
      attempt: input.attempt,
      status:
        input.errorCode === "cancelled" ? "cancelled" : ("blocked" as const),
      inputSha256: input.inputSha256,
      inputSchemaSha256: workflowSchemaSha256(node.inputSchema),
      outputSchemaSha256: workflowSchemaSha256(node.outputSchema),
      ...(input.runId ? { runId: input.runId } : {}),
      errorCode: input.errorCode,
      diagnosticSha256: input.diagnosticSha256,
    };
  }

  private async finish(
    context: WorkflowExecutionContext,
    status: ExecutionPlanWorkflowResult["status"],
    breakpoint?: ExecutionPlanWorkflowBreakpoint,
  ): Promise<ExecutionPlanWorkflowResult> {
    return finishExecutionPlanWorkflow(
      this.store,
      this.ledger,
      context,
      status,
      breakpoint,
    );
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
