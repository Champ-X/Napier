import { emptyUsage } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import { createId } from "./ids.js";
import type { LocalStore } from "./store.js";
import type {
  WorkflowExecutionContext,
  WorkflowReusedNode,
} from "./workflow-context.js";
import {
  ExecutionPlanWorkflowLedger,
  WORKFLOW_EVENT_SCHEMA_VERSION,
  WORKFLOW_NODE_COMPLETED_EVENT,
  WORKFLOW_NODE_STARTED_EVENT,
} from "./workflow-ledger.js";
import { completedWorkflowNodeResult } from "./workflow-runtime-model.js";
import {
  assertWorkflowValue,
  buildExecutionPlanWorkflowNodeInput,
  workflowSchemaSha256,
} from "./workflow-schemas.js";

export interface WorkflowReuseMaterializerOperations {
  completePlanStep(
    context: WorkflowExecutionContext,
    nodeId: string,
    runId: string,
    outputSha256: string,
  ): Promise<void>;
}

export class ExecutionPlanWorkflowReuseMaterializer {
  constructor(
    private readonly store: LocalStore,
    private readonly ledger: ExecutionPlanWorkflowLedger,
    private readonly operations: WorkflowReuseMaterializerOperations,
  ) {}

  async reopenInterrupted(
    context: WorkflowExecutionContext,
    reusedNodes: WorkflowReusedNode[],
  ): Promise<void> {
    for (const reused of reusedNodes) {
      context.plan = this.store.getPlan(context.plan.id);
      const step = context.plan.steps.find(
        (candidate) => candidate.id === reused.nodeId,
      );
      if (!step || step.status !== "blocked") continue;
      const run = step.runId
        ? this.store
            .listRuns(context.threadId)
            .find((candidate) => candidate.id === step.runId)
        : undefined;
      if (run?.source !== "workflow_reuse" || run.status !== "interrupted") {
        throw new Error(
          "Workflow reused node cannot be recovered as an Agent node",
        );
      }
      const before = context.plan;
      context.plan = await this.store.transitionPlanStep(
        context.plan.id,
        reused.nodeId,
        { action: "reopen" },
      );
      if (context.plan.revision !== before.revision) {
        await this.ledger.appendPlanStepEvent(
          context,
          context.plan,
          reused.nodeId,
          "reopened",
          createId("runctl"),
        );
        context.nodeResults.delete(reused.nodeId);
      }
    }
  }

  async materialize(
    context: WorkflowExecutionContext,
    reusedNodes: WorkflowReusedNode[],
  ): Promise<void> {
    const reusedById = new Map(reusedNodes.map((node) => [node.nodeId, node]));
    if (reusedById.size !== reusedNodes.length) {
      throw new Error("Workflow experiment repeats a reused node");
    }
    const orderedNodeIds = context.plan.phaseWaves.flatMap(
      (wave) => wave.stepIds,
    );
    if (
      reusedNodes.some(
        (node) =>
          !context.manifest.nodes.some(
            (candidate) => candidate.id === node.nodeId,
          ),
      )
    ) {
      throw new Error("Workflow experiment references an unknown reused node");
    }
    for (const nodeId of orderedNodeIds) {
      const reused = reusedById.get(nodeId);
      if (!reused) continue;
      if (context.signal?.aborted) break;
      context.plan = this.store.getPlan(context.plan.id);
      const step = context.plan.steps.find(
        (candidate) => candidate.id === nodeId,
      )!;
      if (step.status === "completed") continue;
      const node = context.manifest.nodes.find(
        (candidate) => candidate.id === nodeId,
      )!;
      assertWorkflowValue(
        node.outputSchema,
        reused.output,
        `Workflow reused output ${node.id}`,
      );
      const output = structuredClone(reused.output);
      const outputSha256 = sha256(canonicalJson(output));
      if (outputSha256 !== reused.sourceOutputSha256) {
        throw new Error("Workflow reused output hash mismatch");
      }
      const input = buildExecutionPlanWorkflowNodeInput(
        node,
        context.input,
        context.outputs,
      );
      const inputSha256 = sha256(canonicalJson(input));
      if (inputSha256 !== reused.sourceInputSha256) {
        throw new Error("Workflow reused input hash mismatch");
      }
      if (step.status !== "ready") {
        throw new Error("Workflow reused node is not dependency-ready");
      }
      const lease = await this.store.createLeasedRun(
        {
          threadId: context.threadId,
          agentId: context.agentId,
          agentRevision: context.agentRevision,
          model: { provider: "napier", id: "workflow-reuse" },
          source: "workflow_reuse",
        },
        {
          ownerId: createId("workflowexp"),
          ttlMs: 10 * 60_000,
        },
      );
      try {
        await this.recordReuse(
          context,
          node,
          reused,
          lease.run.id,
          inputSha256,
          output,
          outputSha256,
        );
        await this.store.finishRun(lease.run.id, "completed", {
          leaseToken: lease.token,
        });
        await this.operations.completePlanStep(
          context,
          node.id,
          lease.run.id,
          outputSha256,
        );
        await this.ledger.append(
          {
            threadId: context.threadId,
            runId: lease.run.id,
            type: WORKFLOW_NODE_COMPLETED_EVENT,
            category: "plan",
            visibility: "user",
            payload: {
              schemaVersion: WORKFLOW_EVENT_SCHEMA_VERSION,
              planId: context.plan.id,
              nodeId: node.id,
              attempt: 1,
              manifestSha256: context.manifest.contentSha256,
              inputSha256,
              outputSha256,
              inputSchemaSha256: workflowSchemaSha256(node.inputSchema),
              outputSchemaSha256: workflowSchemaSha256(node.outputSchema),
              recovered: false,
              reused: true,
            },
          },
          context.onEvent,
        );
        context.outputs.set(node.id, output);
        context.nodeResults.set(
          node.id,
          completedWorkflowNodeResult(
            node,
            1,
            lease.run.id,
            inputSha256,
            output,
          ),
        );
      } catch (error) {
        await this.store
          .finishRun(lease.run.id, "failed", {
            error: "Workflow experiment node reuse failed",
            leaseToken: lease.token,
          })
          .catch(() => undefined);
        throw error;
      }
    }
  }

  private async recordReuse(
    context: WorkflowExecutionContext,
    node: WorkflowExecutionContext["manifest"]["nodes"][number],
    reused: WorkflowReusedNode,
    runId: string,
    inputSha256: string,
    output: WorkflowReusedNode["output"],
    outputSha256: string,
  ): Promise<void> {
    const run = this.store
      .listRuns(context.threadId)
      .find((candidate) => candidate.id === runId)!;
    await this.ledger.append(
      {
        threadId: context.threadId,
        runId,
        type: "run.started",
        category: "lifecycle",
        visibility: "debug",
        payload: {
          agentId: context.agentId,
          agentRevision: context.agentRevision,
          model: `${run.configuration?.model.provider ?? "unknown"}/${run.configuration?.model.id ?? "unknown"}`,
          source: "workflow_reuse",
          workflowExperimentReuse: true,
        },
      },
      context.onEvent,
    );
    const before = this.store.getPlan(context.plan.id);
    context.plan = await this.store.transitionPlanStep(
      context.plan.id,
      node.id,
      { action: "start", runId },
    );
    await this.ledger.appendPlanStepEvent(
      context,
      context.plan,
      node.id,
      "started",
      runId,
    );
    await this.ledger.append(
      {
        threadId: context.threadId,
        runId,
        type: WORKFLOW_NODE_STARTED_EVENT,
        category: "plan",
        visibility: "user",
        payload: {
          schemaVersion: WORKFLOW_EVENT_SCHEMA_VERSION,
          planId: context.plan.id,
          nodeId: node.id,
          attempt: 1,
          manifestSha256: context.manifest.contentSha256,
          inputSha256,
          inputSchemaSha256: workflowSchemaSha256(node.inputSchema),
          outputSchemaSha256: workflowSchemaSha256(node.outputSchema),
          planRevisionBefore: before.revision,
          planRevisionAfter: context.plan.revision,
          recovered: false,
          reused: true,
        },
      },
      context.onEvent,
    );
    await this.ledger.append(
      {
        threadId: context.threadId,
        runId,
        type: "message.assistant",
        category: "message",
        visibility: "hidden",
        payload: {
          role: "assistant",
          text: canonicalJson(output),
          model: "napier/workflow-reuse",
          usage: emptyUsage(),
        },
      },
      context.onEvent,
    );
    await this.ledger.append(
      {
        threadId: context.threadId,
        runId,
        type: "workflow.node.reused",
        category: "plan",
        visibility: "user",
        payload: {
          schemaVersion: WORKFLOW_EVENT_SCHEMA_VERSION,
          planId: context.plan.id,
          nodeId: node.id,
          manifestSha256: context.manifest.contentSha256,
          inputSha256,
          outputSha256,
          sourceThreadId: reused.sourceThreadId,
          sourcePlanId: reused.sourcePlanId,
          sourceRunId: reused.sourceRunId,
          sourceAttempt: reused.sourceAttempt,
          sourceInputSha256: reused.sourceInputSha256,
        },
      },
      context.onEvent,
    );
    await this.ledger.append(
      {
        threadId: context.threadId,
        runId,
        type: "run.completed",
        category: "lifecycle",
        visibility: "debug",
        payload: { status: "completed" },
      },
      context.onEvent,
    );
  }
}
