import type {
  ExecuteExecutionPlanWorkflowRequest,
  ExecutionPlanWorkflowNode,
  ExecutionPlanWorkflowNodeResult,
  ExecutionPlanWorkflowResult,
  JsonValue,
  RunRecord,
} from "@napier/contracts";

import type {
  AgentRuntime,
  EventSink,
  RunPromptOptions,
} from "./agent-runtime.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import { createId } from "./ids.js";
import type { LocalStore } from "./store.js";
import type {
  WorkflowExecutionContext,
  WorkflowNodeFailure,
} from "./workflow-context.js";
import { evaluateExecutionPlanWorkflowCondition } from "./workflow-condition-model.js";
import { ExecutionPlanWorkflowConditionNodeExecutor } from "./workflow-condition-node.js";
import {
  WORKFLOW_EXPERIMENT_EXECUTION,
  type WorkflowExperimentExecution,
} from "./workflow-experiment-execution.js";
import { recoverExecutionPlanWorkflowExperimentTarget } from "./workflow-experiment-recovery.js";
import {
  ExecutionPlanWorkflowLedger,
  WORKFLOW_BLOCKED_EVENT,
  WORKFLOW_CANCELLED_EVENT,
  WORKFLOW_COMPLETED_EVENT,
  WORKFLOW_EVENT_SCHEMA_VERSION,
  WORKFLOW_NODE_COMPLETED_EVENT,
  WORKFLOW_NODE_FAILED_EVENT,
  WORKFLOW_NODE_STARTED_EVENT,
  WORKFLOW_STARTED_EVENT,
  WORKFLOW_WAITING_EVENT,
  workflowNodeEventMetadata,
} from "./workflow-ledger.js";
import { ExecutionPlanWorkflowRecovery } from "./workflow-recovery.js";
import {
  assertWorkflowValue,
  buildExecutionPlanWorkflowNodeInput,
  parseExecutionPlanWorkflowNodeOutput,
  validateExecutionPlanWorkflowManifest,
  workflowNodeBindingContextSha256,
  workflowSchemaSha256,
} from "./workflow-manifests.js";
import {
  assertWorkflowPlanMatchesManifest,
  completedWorkflowNodeResult,
  workflowNodePrompt,
  workflowPlanCreatedPayload,
} from "./workflow-runtime-model.js";
import { ExecutionPlanWorkflowReuseMaterializer } from "./workflow-reuse-materializer.js";
import { executionPlanRequestFromBlueprint } from "./workflow-blueprints.js";
import { ExecutionPlanWorkflowApprovalNodeExecutor } from "./workflow-approval-node.js";
import { ExecutionPlanWorkflowDeterministicNodeExecutor } from "./workflow-deterministic-node.js";
import {
  DEFAULT_EXECUTION_PLAN_WORKFLOW_CONCURRENCY,
  executeExecutionPlanWorkflowReadyBatch,
} from "./workflow-parallel-scheduler.js";
import { WORKFLOW_NODE_EXECUTION } from "./workflow-node-execution.js";
import { ExecutionPlanWorkflowToolNodeExecutor } from "./workflow-tool-node.js";

export interface RunExecutionPlanWorkflowOptions {
  threadId: string;
  request: ExecuteExecutionPlanWorkflowRequest;
  signal?: AbortSignal;
  onEvent?: EventSink;
  [WORKFLOW_EXPERIMENT_EXECUTION]?: WorkflowExperimentExecution;
}

interface NodeExecutionOutcome {
  result: ExecutionPlanWorkflowNodeResult;
  cancelled: boolean;
}

export class ExecutionPlanWorkflowRuntime {
  private readonly activeThreads = new Set<string>();
  private readonly ledger: ExecutionPlanWorkflowLedger;
  private readonly recovery: ExecutionPlanWorkflowRecovery;
  private readonly reuseMaterializer: ExecutionPlanWorkflowReuseMaterializer;
  private readonly approvalNodeExecutor: ExecutionPlanWorkflowApprovalNodeExecutor;
  private readonly conditionNodeExecutor: ExecutionPlanWorkflowConditionNodeExecutor;
  private readonly deterministicNodeExecutor: ExecutionPlanWorkflowDeterministicNodeExecutor;
  private readonly toolNodeExecutor: ExecutionPlanWorkflowToolNodeExecutor;

  constructor(
    private readonly store: LocalStore,
    private readonly agentRuntime: AgentRuntime,
  ) {
    this.ledger = new ExecutionPlanWorkflowLedger(store);
    this.conditionNodeExecutor = new ExecutionPlanWorkflowConditionNodeExecutor(
      store,
      this.ledger,
    );
    this.approvalNodeExecutor = new ExecutionPlanWorkflowApprovalNodeExecutor(
      store,
      this.ledger,
      {
        blockNode: (context, node, failure) =>
          this.blockNode(context, node, failure),
        completePlanStep: (context, nodeId, runId, outputSha256) =>
          this.completePlanStep(context, nodeId, runId, outputSha256),
      },
    );
    this.deterministicNodeExecutor =
      new ExecutionPlanWorkflowDeterministicNodeExecutor(store, this.ledger, {
        blockNode: (context, node, failure) =>
          this.blockNode(context, node, failure),
        completePlanStep: (context, nodeId, runId, outputSha256) =>
          this.completePlanStep(context, nodeId, runId, outputSha256),
      });
    this.toolNodeExecutor = new ExecutionPlanWorkflowToolNodeExecutor(
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
  }

  async run(
    options: RunExecutionPlanWorkflowOptions,
  ): Promise<ExecutionPlanWorkflowResult> {
    options.signal?.throwIfAborted();
    this.store.getThread(options.threadId);
    const manifest = validateExecutionPlanWorkflowManifest(
      options.request.manifest,
    );
    if (this.activeThreads.has(options.threadId)) {
      throw new Error("Thread already has an active Workflow execution");
    }
    this.activeThreads.add(options.threadId);
    try {
      const context =
        "planId" in options.request
          ? await this.resumeContext(options, manifest)
          : await this.createContext(options, manifest);
      return await this.executeContext(context);
    } finally {
      this.activeThreads.delete(options.threadId);
    }
  }

  private async createContext(
    options: RunExecutionPlanWorkflowOptions,
    manifest: ReturnType<typeof validateExecutionPlanWorkflowManifest>,
  ): Promise<WorkflowExecutionContext> {
    if (!("input" in options.request)) {
      throw new Error("Workflow input is required for a new execution");
    }
    assertWorkflowValue(
      manifest.inputSchema,
      options.request.input,
      "Workflow input",
    );
    options.signal?.throwIfAborted();
    const thread = this.store.getThread(options.threadId);
    const agent = this.store.getAgent(thread.agentId);
    const experiment = options[WORKFLOW_EXPERIMENT_EXECUTION];
    const agentRevision =
      experiment?.agentRevision === undefined
        ? agent.revision
        : experiment.agentRevision;
    this.store.getAgentRevision(agent.id, agentRevision);
    const plan = await this.store.createPlan(
      options.threadId,
      executionPlanRequestFromBlueprint(manifest.blueprint),
    );
    await this.ledger.append(
      {
        threadId: options.threadId,
        runId: createId("runctl"),
        type: "plan.created",
        category: "plan",
        visibility: "user",
        payload: workflowPlanCreatedPayload(plan, manifest.contentSha256),
      },
      options.onEvent,
    );
    const input = structuredClone(options.request.input);
    await this.ledger.append(
      {
        threadId: options.threadId,
        runId: createId("runctl"),
        type: WORKFLOW_STARTED_EVENT,
        category: "plan",
        visibility: "user",
        payload: {
          schemaVersion: WORKFLOW_EVENT_SCHEMA_VERSION,
          planId: plan.id,
          manifestSha256: manifest.contentSha256,
          blueprintSha256: manifest.blueprint.contentSha256,
          workflowVersion: manifest.version,
          nodeCount: manifest.nodeCount,
          agentId: agent.id,
          agentRevision,
          input,
          inputSha256: sha256(canonicalJson(input)),
          inputSchemaSha256: workflowSchemaSha256(manifest.inputSchema),
          outputSchemaSha256: workflowSchemaSha256(manifest.outputSchema),
          outputNodeId: manifest.outputNodeId,
          maxConcurrency:
            manifest.maxConcurrency ??
            DEFAULT_EXECUTION_PLAN_WORKFLOW_CONCURRENCY,
        },
      },
      options.onEvent,
    );
    const context: WorkflowExecutionContext = {
      threadId: options.threadId,
      manifest,
      input,
      agentId: agent.id,
      agentRevision,
      plan,
      resumed: false,
      retryBlocked: false,
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.onEvent ? { onEvent: options.onEvent } : {}),
      outputs: new Map(),
      nodeResults: new Map(),
      reusedNodes:
        experiment?.reusedNodes.map((node) => structuredClone(node)) ?? [],
    };
    if (experiment) {
      await this.ledger.append(
        {
          threadId: options.threadId,
          runId: createId("runctl"),
          type: "workflow.experiment.started",
          category: "plan",
          visibility: "user",
          payload: {
            schemaVersion: WORKFLOW_EVENT_SCHEMA_VERSION,
            planId: plan.id,
            manifestSha256: manifest.contentSha256,
            ...experiment.lineage,
          },
        },
        options.onEvent,
      );
    }
    return context;
  }

  private async resumeContext(
    options: RunExecutionPlanWorkflowOptions,
    manifest: ReturnType<typeof validateExecutionPlanWorkflowManifest>,
  ): Promise<WorkflowExecutionContext> {
    if (!("planId" in options.request)) {
      throw new Error("Workflow planId is required for resume");
    }
    const plan = this.store.getPlan(options.request.planId);
    if (plan.threadId !== options.threadId) {
      throw new Error("Workflow Plan does not belong to the Thread");
    }
    assertWorkflowPlanMatchesManifest(plan, manifest);
    const started = await this.ledger.recoverWorkflowStart(
      options.threadId,
      plan.id,
      manifest.contentSha256,
      manifest.maxConcurrency ?? DEFAULT_EXECUTION_PLAN_WORKFLOW_CONCURRENCY,
    );
    const thread = this.store.getThread(options.threadId);
    if (started.agentId !== thread.agentId) {
      throw new Error("Workflow Agent does not match its Thread");
    }
    this.store.getAgentRevision(started.agentId, started.agentRevision);
    assertWorkflowValue(manifest.inputSchema, started.input, "Workflow input");
    const experiment = await recoverExecutionPlanWorkflowExperimentTarget(
      this.store,
      options.threadId,
      plan,
      manifest,
      started.input,
      started.agentId,
      started.agentRevision,
    );
    return {
      threadId: options.threadId,
      manifest,
      input: started.input,
      agentId: started.agentId,
      agentRevision: started.agentRevision,
      plan,
      resumed: true,
      retryBlocked: options.request.retryBlocked === true,
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.onEvent ? { onEvent: options.onEvent } : {}),
      outputs: new Map(),
      nodeResults: new Map(),
      reusedNodes: experiment.reusedNodes,
    };
  }

  private async executeContext(
    context: WorkflowExecutionContext,
  ): Promise<ExecutionPlanWorkflowResult> {
    await this.recovery.recoverCompletedAndInterruptedNodes(context);
    await this.approvalNodeExecutor.recoverRunning(context);
    await this.recovery.recoverBlockedNodeResults(context);
    await this.recovery.reopenInterruptedDeterministicNodes(context);
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
    if (context.retryBlocked) {
      await this.recovery.reopenRetryableNodes(context);
    }

    for (;;) {
      if (context.signal?.aborted) {
        return this.finish(context, "cancelled");
      }
      context.plan = this.store.getPlan(context.plan.id);
      const batch = await executeExecutionPlanWorkflowReadyBatch(
        context,
        (nodeContext, node) => this.executeNode(nodeContext, node),
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
      ) &&
      context.plan.status === "completed"
    ) {
      return this.finish(context, "completed");
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
  ): Promise<NodeExecutionOutcome> {
    const attempt = await this.ledger.nextAttempt(
      context.threadId,
      context.plan.id,
      node.id,
    );
    let input: JsonValue;
    try {
      input = buildExecutionPlanWorkflowNodeInput(
        node,
        context.input,
        context.outputs,
      );
    } catch (error) {
      return {
        result: await this.blockNode(context, node, {
          inputSha256: workflowNodeBindingContextSha256(
            node,
            context.input,
            context.outputs,
          ),
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
    if (node.type === "deterministic") {
      return this.deterministicNodeExecutor.execute(
        context,
        node,
        input,
        inputSha256,
        attempt,
      );
    }
    if (node.type === "approval") {
      return this.approvalNodeExecutor.execute(
        context,
        node,
        input,
        inputSha256,
        attempt,
      );
    }
    if (node.type === "tool") {
      return this.toolNodeExecutor.execute(
        context,
        node,
        input,
        inputSha256,
        attempt,
      );
    }

    const controller = new AbortController();
    let timedOut = false;
    const forwardAbort = (): void => controller.abort();
    context.signal?.addEventListener("abort", forwardAbort, { once: true });
    if (context.signal?.aborted) controller.abort();
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, node.timeoutMs);
    let run: RunRecord | undefined;
    try {
      const prompt = workflowNodePrompt(context.manifest, node, input);
      const runOptions: RunPromptOptions = {
        threadId: context.threadId,
        text: prompt,
        source: "workflow",
        [WORKFLOW_NODE_EXECUTION]: { planId: context.plan.id },
        agentRevision: context.agentRevision,
        signal: controller.signal,
        ...(node.model ? { model: node.model } : {}),
        onRunCreated: async (createdRun) => {
          run = createdRun;
          const before = this.store.getPlan(context.plan.id);
          const started = await this.store.transitionPlanStep(
            context.plan.id,
            node.id,
            { action: "start", runId: createdRun.id },
          );
          context.plan = started;
          await this.ledger.appendPlanStepEvent(
            context,
            started,
            node.id,
            "started",
            createdRun.id,
          );
          await this.ledger.append(
            {
              threadId: context.threadId,
              runId: createdRun.id,
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
        ...(context.onEvent ? { onEvent: context.onEvent } : {}),
      };
      run = await this.agentRuntime.runPrompt(runOptions);
    } catch (error) {
      const cancelled = context.signal?.aborted === true;
      const errorCode = cancelled
        ? "cancelled"
        : timedOut
          ? "timeout"
          : "run_start_failed";
      return {
        result: await this.blockNode(context, node, {
          ...(run ? { runId: run.id } : {}),
          inputSha256,
          attempt,
          errorCode,
          diagnosticSha256: sha256(errorMessage(error)),
        }),
        cancelled,
      };
    } finally {
      clearTimeout(timeout);
      context.signal?.removeEventListener("abort", forwardAbort);
    }

    if (!run) throw new Error("Workflow node Run was not created");
    if (context.signal?.aborted) {
      return {
        result: await this.blockNode(context, node, {
          runId: run.id,
          inputSha256,
          attempt,
          errorCode: "cancelled",
          diagnosticSha256: sha256(run.error ?? "cancelled"),
        }),
        cancelled: true,
      };
    }
    if (timedOut) {
      return {
        result: await this.blockNode(context, node, {
          runId: run.id,
          inputSha256,
          attempt,
          errorCode: "timeout",
          diagnosticSha256: sha256(run.error ?? "timeout"),
        }),
        cancelled: false,
      };
    }
    if (run.status !== "completed") {
      return {
        result: await this.blockNode(context, node, {
          runId: run.id,
          inputSha256,
          attempt,
          errorCode: `run_${run.status}`,
          diagnosticSha256: sha256(run.error ?? run.status),
        }),
        cancelled: false,
      };
    }

    let output: JsonValue;
    try {
      output = parseExecutionPlanWorkflowNodeOutput(
        await this.ledger.nodeAssistantOutput(context.threadId, run.id),
        node.outputSchema,
      );
    } catch (error) {
      return {
        result: await this.blockNode(context, node, {
          runId: run.id,
          inputSha256,
          attempt,
          errorCode: "output_invalid",
          diagnosticSha256: sha256(errorMessage(error)),
        }),
        cancelled: false,
      };
    }
    const outputSha256 = sha256(canonicalJson(output));
    await this.completePlanStep(context, node.id, run.id, outputSha256);
    await this.ledger.append(
      {
        threadId: context.threadId,
        runId: run.id,
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
    return {
      result: completedWorkflowNodeResult(
        node,
        attempt,
        run.id,
        inputSha256,
        output,
      ),
      cancelled: false,
    };
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
  ): Promise<ExecutionPlanWorkflowResult> {
    context.plan = this.store.getPlan(context.plan.id);
    const output =
      status === "completed"
        ? context.outputs.get(context.manifest.outputNodeId)
        : undefined;
    if (status === "completed") {
      if (output === undefined) {
        throw new Error("Workflow output node result is unavailable");
      }
      assertWorkflowValue(
        context.manifest.outputSchema,
        output,
        "Workflow output",
      );
    }
    const nodeResults = context.manifest.nodes.flatMap((node) => {
      const result = context.nodeResults.get(node.id);
      return result ? [structuredClone(result)] : [];
    });
    const base = {
      kind: "napier.execution-plan-workflow-result" as const,
      schemaVersion: 1 as const,
      threadId: context.threadId,
      planId: context.plan.id,
      manifestSha256: context.manifest.contentSha256,
      blueprintSha256: context.manifest.blueprint.contentSha256,
      status,
      resumed: context.resumed,
      nodeResults,
      ...(output !== undefined ? { output: structuredClone(output) } : {}),
      ...(output !== undefined
        ? { outputSha256: sha256(canonicalJson(output)) }
        : {}),
    };
    const result: ExecutionPlanWorkflowResult = {
      ...base,
      resultSha256: sha256(canonicalJson(base)),
    };
    const eventType =
      status === "completed"
        ? WORKFLOW_COMPLETED_EVENT
        : status === "waiting"
          ? WORKFLOW_WAITING_EVENT
          : status === "cancelled"
            ? WORKFLOW_CANCELLED_EVENT
            : WORKFLOW_BLOCKED_EVENT;
    const completedNodeCount = nodeResults.filter(
      (node) => node.status === "completed",
    ).length;
    const skippedNodeCount = nodeResults.filter(
      (node) => node.status === "skipped",
    ).length;
    if (
      !(await this.ledger.hasTerminalEvent({
        threadId: context.threadId,
        planId: context.plan.id,
        eventType,
        manifestSha256: context.manifest.contentSha256,
        blueprintSha256: context.manifest.blueprint.contentSha256,
        status,
        planRevision: context.plan.revision,
        nodeResultCount: nodeResults.length,
        completedNodeCount,
        skippedNodeCount,
        ...(result.outputSha256 ? { outputSha256: result.outputSha256 } : {}),
      }))
    ) {
      await this.ledger.append(
        {
          threadId: context.threadId,
          runId: createId("runctl"),
          type: eventType,
          category: "plan",
          visibility: "user",
          payload: {
            schemaVersion: WORKFLOW_EVENT_SCHEMA_VERSION,
            planId: context.plan.id,
            manifestSha256: context.manifest.contentSha256,
            blueprintSha256: context.manifest.blueprint.contentSha256,
            status,
            planRevision: context.plan.revision,
            nodeResultCount: nodeResults.length,
            completedNodeCount,
            skippedNodeCount,
            ...(result.outputSha256
              ? { outputSha256: result.outputSha256 }
              : {}),
            resultSha256: result.resultSha256,
          },
        },
        context.onEvent,
      );
    }
    await this.store.setThreadStatus(
      context.threadId,
      status === "waiting"
        ? "waiting"
        : status === "blocked"
          ? "failed"
          : "idle",
    );
    return result;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
