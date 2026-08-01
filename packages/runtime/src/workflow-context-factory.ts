import type {
  ExecuteExecutionPlanWorkflowRequest,
  ExecutionPlanWorkflowManifest,
} from "@napier/contracts";

import type { EventSink } from "./agent-runtime.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import { createId } from "./ids.js";
import type { LocalStore } from "./store.js";
import { validateExecutionPlanWorkflowBreakpointNodeIds } from "./workflow-breakpoint-model.js";
import { executionPlanRequestFromBlueprint } from "./workflow-blueprints.js";
import type { WorkflowExecutionContext } from "./workflow-context.js";
import {
  WORKFLOW_EXPERIMENT_EXECUTION,
  type WorkflowExperimentExecution,
} from "./workflow-experiment-execution.js";
import { recoverExecutionPlanWorkflowExperimentTarget } from "./workflow-experiment-recovery.js";
import { workflowInputReplacementRequestEvents } from "./workflow-input-override.js";
import {
  ExecutionPlanWorkflowLedger,
  WORKFLOW_EVENT_SCHEMA_VERSION,
  WORKFLOW_STARTED_EVENT,
} from "./workflow-ledger.js";
import {
  assertWorkflowValue,
  workflowSchemaSha256,
} from "./workflow-manifests.js";
import { DEFAULT_EXECUTION_PLAN_WORKFLOW_CONCURRENCY } from "./workflow-parallel-scheduler.js";
import {
  assertWorkflowPlanMatchesManifest,
  workflowPlanCreatedPayload,
} from "./workflow-runtime-model.js";
import { workflowSimulationRequestEvents } from "./workflow-simulation-evidence.js";

export interface RunExecutionPlanWorkflowOptions {
  threadId: string;
  request: ExecuteExecutionPlanWorkflowRequest;
  signal?: AbortSignal;
  onEvent?: EventSink;
  [WORKFLOW_EXPERIMENT_EXECUTION]?: WorkflowExperimentExecution;
}

export class ExecutionPlanWorkflowContextFactory {
  constructor(
    private readonly store: LocalStore,
    private readonly ledger: ExecutionPlanWorkflowLedger,
  ) {}

  async create(
    options: RunExecutionPlanWorkflowOptions,
    manifest: ExecutionPlanWorkflowManifest,
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
    const breakBeforeNodeIds = validateExecutionPlanWorkflowBreakpointNodeIds(
      manifest,
      options.request.breakBeforeNodeIds,
    );
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
          ...(breakBeforeNodeIds.length > 0 ? { breakBeforeNodeIds } : {}),
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
      breakBeforeNodeIds,
      continueBreakpoint: false,
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.onEvent ? { onEvent: options.onEvent } : {}),
      outputs: new Map(),
      nodeResults: new Map(),
      reusedNodes:
        experiment?.reusedNodes.map((node) => structuredClone(node)) ?? [],
      simulatedNodes:
        experiment?.simulatedNodes.map((node) => structuredClone(node)) ?? [],
      inputOverrides:
        experiment?.inputOverrides.map((override) =>
          structuredClone(override),
        ) ?? [],
    };
    if (experiment) {
      await this.appendExperimentStart(options, manifest, context, experiment);
    }
    return context;
  }

  async resume(
    options: RunExecutionPlanWorkflowOptions,
    manifest: ExecutionPlanWorkflowManifest,
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
      manifest,
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
      started.breakBeforeNodeIds,
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
      breakBeforeNodeIds: started.breakBeforeNodeIds,
      continueBreakpoint: options.request.continueBreakpoint === true,
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.onEvent ? { onEvent: options.onEvent } : {}),
      outputs: new Map(),
      nodeResults: new Map(),
      reusedNodes: experiment.reusedNodes,
      simulatedNodes: experiment.simulatedNodes,
      inputOverrides: experiment.inputOverrides,
    };
  }

  private async appendExperimentStart(
    options: RunExecutionPlanWorkflowOptions,
    manifest: ExecutionPlanWorkflowManifest,
    context: WorkflowExecutionContext,
    experiment: WorkflowExperimentExecution,
  ): Promise<void> {
    await this.ledger.append(
      {
        threadId: options.threadId,
        runId: createId("runctl"),
        type: "workflow.experiment.started",
        category: "plan",
        visibility: "user",
        payload: {
          schemaVersion: WORKFLOW_EVENT_SCHEMA_VERSION,
          planId: context.plan.id,
          manifestSha256: manifest.contentSha256,
          ...experiment.lineage,
        },
      },
      options.onEvent,
    );
    for (const event of workflowSimulationRequestEvents(
      manifest,
      context.plan.id,
      experiment.simulatedNodes,
    )) {
      await this.ledger.append(
        {
          threadId: options.threadId,
          runId: createId("runctl"),
          ...event,
        },
        options.onEvent,
      );
    }
    for (const event of workflowInputReplacementRequestEvents(
      manifest,
      context.plan.id,
      experiment.inputOverrides,
    )) {
      await this.ledger.append(
        {
          threadId: options.threadId,
          runId: createId("runctl"),
          ...event,
        },
        options.onEvent,
      );
    }
  }
}
