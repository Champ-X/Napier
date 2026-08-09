import { canonicalJson, sha256 } from "./ed25519.js";
import { createId, createProcessLeaseOwnerId } from "./ids.js";
import type { LocalStore } from "./store.js";
import type {
  WorkflowExecutionContext,
  WorkflowSimulatedNode,
} from "./workflow-context.js";
import {
  ExecutionPlanWorkflowLedger,
  isWorkflowRecord,
  WORKFLOW_EVENT_SCHEMA_VERSION,
  WORKFLOW_NODE_COMPLETED_EVENT,
  WORKFLOW_NODE_STARTED_EVENT,
  workflowNodeEventMetadata,
} from "./workflow-ledger.js";
import { completedWorkflowNodeResult } from "./workflow-runtime-model.js";
import { buildWorkflowExecutionNodeInput } from "./workflow-node-input.js";
import {
  assertWorkflowValue,
  MAX_EXECUTION_PLAN_WORKFLOW_NODE_OUTPUT_BYTES,
  workflowSchemaSha256,
} from "./workflow-schemas.js";
import { WORKFLOW_SIMULATION_EXECUTION } from "./workflow-simulation-execution.js";
import {
  WORKFLOW_NODE_SIMULATED_EVENT,
  WORKFLOW_NODE_SIMULATION_REQUESTED_EVENT,
} from "./workflow-simulation-evidence.js";

export interface WorkflowSimulationMaterializerOperations {
  completePlanStep(
    context: WorkflowExecutionContext,
    nodeId: string,
    runId: string,
    outputSha256: string,
  ): Promise<void>;
}

export class ExecutionPlanWorkflowSimulationMaterializer {
  constructor(
    private readonly store: LocalStore,
    private readonly ledger: ExecutionPlanWorkflowLedger,
    private readonly operations: WorkflowSimulationMaterializerOperations,
  ) {}

  async reopenInterrupted(
    context: WorkflowExecutionContext,
    simulatedNodes: WorkflowSimulatedNode[],
  ): Promise<void> {
    for (const simulated of simulatedNodes) {
      context.plan = this.store.getPlan(context.plan.id);
      const step = context.plan.steps.find(
        (candidate) => candidate.id === simulated.nodeId,
      );
      if (!step || step.status !== "blocked") continue;
      const run = step.runId
        ? this.store
            .listRuns(context.threadId)
            .find((candidate) => candidate.id === step.runId)
        : undefined;
      if (
        run?.source !== "workflow_simulation" ||
        run.status !== "interrupted"
      ) {
        throw new Error(
          "Workflow simulated node cannot be recovered as a normal node",
        );
      }
      const before = context.plan;
      context.plan = await this.store.transitionPlanStep(
        context.plan.id,
        simulated.nodeId,
        { action: "reopen" },
      );
      if (context.plan.revision !== before.revision) {
        await this.ledger.appendPlanStepEvent(
          context,
          context.plan,
          simulated.nodeId,
          "reopened",
          createId("runctl"),
        );
        context.nodeResults.delete(simulated.nodeId);
      }
    }
  }

  async materialize(
    context: WorkflowExecutionContext,
    simulatedNodes: WorkflowSimulatedNode[],
  ): Promise<void> {
    const simulatedById = new Map(
      simulatedNodes.map((node) => [node.nodeId, node]),
    );
    if (
      simulatedById.size !== simulatedNodes.length ||
      simulatedNodes.length > 1
    ) {
      throw new Error("Workflow experiment simulation node set is invalid");
    }
    const orderedNodeIds = context.plan.phaseWaves.flatMap(
      (wave) => wave.stepIds,
    );
    for (const nodeId of orderedNodeIds) {
      const simulated = simulatedById.get(nodeId);
      if (!simulated) continue;
      const node = context.manifest.nodes.find(
        (candidate) => candidate.id === nodeId,
      );
      if (!node) {
        throw new Error("Workflow experiment simulation node is unknown");
      }
      assertSimulationOutput(node.outputSchema, simulated);
      const input = buildWorkflowExecutionNodeInput(context, node);
      const inputSha256 = sha256(canonicalJson(input));
      await this.verifyRequested(
        context,
        simulated,
        workflowSchemaSha256(node.outputSchema),
      );

      context.plan = this.store.getPlan(context.plan.id);
      const step = context.plan.steps.find(
        (candidate) => candidate.id === node.id,
      )!;
      if (step.status === "completed") {
        await this.verifyCompleted(context, simulated, inputSha256);
        continue;
      }
      if (context.signal?.aborted) return;
      if (step.status !== "ready") {
        throw new Error("Workflow simulated node is not dependency-ready");
      }
      const lease = await this.store.createLeasedRun(
        {
          threadId: context.threadId,
          agentId: context.agentId,
          agentRevision: context.agentRevision,
          model: { provider: "napier", id: "workflow-simulation" },
          source: "workflow_simulation",
          [WORKFLOW_SIMULATION_EXECUTION]: {
            planId: context.plan.id,
            nodeId: node.id,
            outputSha256: simulated.outputSha256,
          },
        },
        {
          ownerId: createProcessLeaseOwnerId("workflowsim"),
          ttlMs: 10 * 60_000,
        },
      );
      try {
        await this.recordSimulation(
          context,
          node,
          simulated,
          lease.run.id,
          inputSha256,
        );
        await this.store.finishRun(lease.run.id, "completed", {
          leaseToken: lease.token,
        });
        await this.operations.completePlanStep(
          context,
          node.id,
          lease.run.id,
          simulated.outputSha256,
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
              ...workflowNodeEventMetadata(node),
              attempt: 1,
              manifestSha256: context.manifest.contentSha256,
              inputSha256,
              outputSha256: simulated.outputSha256,
              inputSchemaSha256: workflowSchemaSha256(node.inputSchema),
              outputSchemaSha256: workflowSchemaSha256(node.outputSchema),
              recovered: false,
            },
          },
          context.onEvent,
        );
        context.outputs.set(node.id, structuredClone(simulated.output));
        context.nodeResults.set(
          node.id,
          completedWorkflowNodeResult(
            node,
            1,
            lease.run.id,
            inputSha256,
            simulated.output,
          ),
        );
      } catch (error) {
        await this.store
          .finishRun(lease.run.id, "failed", {
            error: "Workflow output simulation failed",
            leaseToken: lease.token,
          })
          .catch(() => undefined);
        throw error;
      }
    }
  }

  private async recordSimulation(
    context: WorkflowExecutionContext,
    node: WorkflowExecutionContext["manifest"]["nodes"][number],
    simulated: WorkflowSimulatedNode,
    runId: string,
    inputSha256: string,
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
          model: "napier/workflow-simulation",
          source: "workflow_simulation",
          configurationSha256: run.configuration?.contentSha256 ?? "",
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
          ...workflowNodeEventMetadata(node),
          attempt: 1,
          manifestSha256: context.manifest.contentSha256,
          inputSha256,
          inputSchemaSha256: workflowSchemaSha256(node.inputSchema),
          outputSchemaSha256: workflowSchemaSha256(node.outputSchema),
          planRevisionBefore: before.revision,
          planRevisionAfter: context.plan.revision,
          recovered: false,
        },
      },
      context.onEvent,
    );
    await this.ledger.append(
      {
        threadId: context.threadId,
        runId,
        type: WORKFLOW_NODE_SIMULATED_EVENT,
        category: "plan",
        visibility: "user",
        payload: {
          schemaVersion: WORKFLOW_EVENT_SCHEMA_VERSION,
          planId: context.plan.id,
          nodeId: node.id,
          manifestSha256: context.manifest.contentSha256,
          inputSha256,
          outputSha256: simulated.outputSha256,
          outputBytes: simulated.outputBytes,
          outputSchemaSha256: workflowSchemaSha256(node.outputSchema),
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

  private async verifyRequested(
    context: WorkflowExecutionContext,
    simulated: WorkflowSimulatedNode,
    outputSchemaSha256: string,
  ): Promise<void> {
    const matches = (await this.store.listEvents(context.threadId)).filter(
      (event) =>
        event.type === WORKFLOW_NODE_SIMULATION_REQUESTED_EVENT &&
        isWorkflowRecord(event.payload) &&
        event.payload["planId"] === context.plan.id &&
        event.payload["nodeId"] === simulated.nodeId,
    );
    const payload =
      matches.length === 1 && isWorkflowRecord(matches[0]!.payload)
        ? matches[0]!.payload
        : undefined;
    if (
      !payload ||
      matches[0]!.visibility !== "hidden" ||
      payload["schemaVersion"] !== WORKFLOW_EVENT_SCHEMA_VERSION ||
      payload["manifestSha256"] !== context.manifest.contentSha256 ||
      payload["outputSha256"] !== simulated.outputSha256 ||
      payload["outputBytes"] !== simulated.outputBytes ||
      payload["outputSchemaSha256"] !== outputSchemaSha256 ||
      canonicalJson(payload["output"]) !== canonicalJson(simulated.output)
    ) {
      throw new Error("Workflow simulation request evidence mismatch");
    }
  }

  private async verifyCompleted(
    context: WorkflowExecutionContext,
    simulated: WorkflowSimulatedNode,
    inputSha256: string,
  ): Promise<void> {
    const step = context.plan.steps.find(
      (candidate) => candidate.id === simulated.nodeId,
    )!;
    const run = step.runId
      ? this.store
          .listRuns(context.threadId)
          .find((candidate) => candidate.id === step.runId)
      : undefined;
    const output = context.outputs.get(simulated.nodeId);
    if (
      !run ||
      run.source !== "workflow_simulation" ||
      run.status !== "completed" ||
      output === undefined ||
      sha256(canonicalJson(output)) !== simulated.outputSha256
    ) {
      throw new Error("Workflow completed simulation evidence mismatch");
    }
    const matches = (await this.store.listEvents(context.threadId)).filter(
      (event) =>
        event.runId === run.id &&
        event.type === WORKFLOW_NODE_SIMULATED_EVENT &&
        isWorkflowRecord(event.payload) &&
        event.payload["planId"] === context.plan.id &&
        event.payload["nodeId"] === simulated.nodeId,
    );
    const payload =
      matches.length === 1 && isWorkflowRecord(matches[0]!.payload)
        ? matches[0]!.payload
        : undefined;
    if (
      !payload ||
      payload["manifestSha256"] !== context.manifest.contentSha256 ||
      payload["inputSha256"] !== inputSha256 ||
      payload["outputSha256"] !== simulated.outputSha256 ||
      payload["outputBytes"] !== simulated.outputBytes
    ) {
      throw new Error("Workflow simulated node evidence mismatch");
    }
  }
}

function assertSimulationOutput(
  schema: WorkflowExecutionContext["manifest"]["nodes"][number]["outputSchema"],
  simulated: WorkflowSimulatedNode,
): void {
  assertWorkflowValue(
    schema,
    simulated.output,
    `Workflow simulated output ${simulated.nodeId}`,
    MAX_EXECUTION_PLAN_WORKFLOW_NODE_OUTPUT_BYTES,
  );
  const encoded = canonicalJson(simulated.output);
  if (
    sha256(encoded) !== simulated.outputSha256 ||
    Buffer.byteLength(encoded, "utf8") !== simulated.outputBytes
  ) {
    throw new Error("Workflow simulated output receipt mismatch");
  }
}
