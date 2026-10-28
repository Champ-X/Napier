import type { RecoverWorkflowRequest } from "@napier/contracts/workflow-recovery";
import path from "node:path";
import type {
  ExecuteExecutionPlanWorkflowRequest,
  ExecutionPlanWorkflowManifest,
} from "@napier/contracts";

import type { EventSink } from "./event-sink.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import { createId } from "./ids.js";
import type { LocalStore } from "./store.js";
import { LEDGER_DATABASE_FILENAME } from "./sqlite-ledger-model.js";
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
} from "./workflow-schemas.js";
import { DEFAULT_EXECUTION_PLAN_WORKFLOW_CONCURRENCY } from "./workflow-parallel-scheduler.js";
import {
  assertWorkflowPlanMatchesManifest,
  workflowPlanCreatedPayload,
} from "./workflow-runtime-model.js";
import { workflowSimulationRequestEvents } from "./workflow-simulation-evidence.js";
import { withWorkflowExecutionLock } from "./workflow-execution-lock.js";
import { workflowManifestStore } from "./workflow-manifest-store.js";
import {
  WORKFLOW_RECOVERY_CHECKPOINT,
  loadWorkflowRecoveryManifest,
  workflowRecoveryCheckpoint,
} from "./workflow-recovery-checkpoint.js";

export interface RunExecutionPlanWorkflowOptions {
  threadId: string;
  request: ExecuteExecutionPlanWorkflowRequest;
  signal?: AbortSignal;
  onEvent?: EventSink;
  [WORKFLOW_EXPERIMENT_EXECUTION]?: WorkflowExperimentExecution;
  [WORKFLOW_RECOVERY_CHECKPOINT]?: string;
}

export class ExecutionPlanWorkflowContextFactory {
  constructor(
    private readonly store: LocalStore,
    private readonly ledger: ExecutionPlanWorkflowLedger,
  ) {}

  async withContext<T>(
    options: RunExecutionPlanWorkflowOptions,
    manifest: ExecutionPlanWorkflowManifest,
    execute: (context: WorkflowExecutionContext) => Promise<T>,
  ): Promise<T> {
    return withWorkflowExecutionLock(
      {
        databasePath: path.join(this.store.dataRoot, LEDGER_DATABASE_FILENAME),
        threadId: options.threadId,
        wait: "planId" in options.request,
        ...(options.signal ? { signal: options.signal } : {}),
      },
      async (reclaimed) => {
        if (reclaimed)
          await this.store.runLifecycleRepository.reconcileInterruptedRuns(
            true,
          );
        await this.assertRecoveryCheckpoint(options);
        const context =
          "planId" in options.request
            ? await this.resume(options, manifest)
            : await this.create(options, manifest);
        if (options[WORKFLOW_RECOVERY_CHECKPOINT]) {
          // Consume before any node execution. A lost response can never release
          // a later breakpoint by replaying the same request.
          await this.ledger.append(
            {
              threadId: options.threadId,
              runId: createId("runctl"),
              type: "workflow.recovery.claimed",
              category: "plan",
              visibility: "user",
              payload: {
                schemaVersion: 1,
                planId: context.plan.id,
                manifestSha256: manifest.contentSha256,
                checkpointSha256: options[WORKFLOW_RECOVERY_CHECKPOINT]!,
              },
            },
            options.onEvent,
          );
        }
        return execute(context);
      },
    );
  }

  recoveryCheckpoint(threadId: string, planId: string) {
    return workflowRecoveryCheckpoint(
      this.store,
      threadId,
      planId,
      this.ledger,
    );
  }

  async recoveryOptions(options: {
    threadId: string;
    planId: string;
    request: RecoverWorkflowRequest;
    signal?: AbortSignal;
    onEvent?: EventSink;
  }): Promise<RunExecutionPlanWorkflowOptions> {
    const checkpoint = await this.recoveryCheckpoint(
      options.threadId,
      options.planId,
    );
    if (
      checkpoint.status !== "ready" ||
      !checkpoint.checkpointSha256 ||
      checkpoint.checkpointSha256 !== options.request.checkpointSha256
    ) {
      throw new Error(
        "Workflow recovery checkpoint has changed; refresh before continuing",
      );
    }
    const manifest = await loadWorkflowRecoveryManifest(
      this.store,
      options.threadId,
      options.planId,
      this.ledger,
    );
    return {
      threadId: options.threadId,
      request: {
        manifest,
        planId: options.planId,
        ...(checkpoint.action === "continue_breakpoint"
          ? { continueBreakpoint: true }
          : {}),
        ...(checkpoint.action === "retry_blocked"
          ? { retryBlocked: true }
          : {}),
      },
      [WORKFLOW_RECOVERY_CHECKPOINT]: checkpoint.checkpointSha256,
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.onEvent ? { onEvent: options.onEvent } : {}),
    };
  }

  private async assertRecoveryCheckpoint(
    options: RunExecutionPlanWorkflowOptions,
  ): Promise<void> {
    const expected = options[WORKFLOW_RECOVERY_CHECKPOINT];
    if (!expected) return;
    if (!("planId" in options.request))
      throw new Error("Workflow recovery requires a Plan");
    const current = await this.recoveryCheckpoint(
      options.threadId,
      options.request.planId,
    );
    if (
      current.status !== "ready" ||
      current.checkpointSha256 !== expected ||
      current.manifestSha256 !== options.request.manifest.contentSha256 ||
      (current.action === "continue_breakpoint") !==
        (options.request.continueBreakpoint === true) ||
      (current.action === "retry_blocked") !==
        (options.request.retryBlocked === true)
    ) {
      throw new Error(
        "Workflow recovery checkpoint has changed; refresh before continuing",
      );
    }
  }

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
    await workflowManifestStore(this.store.dataRoot).put(
      manifest.contentSha256,
      JSON.stringify(manifest),
    );
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
