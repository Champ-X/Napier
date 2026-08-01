import type {
  ExecutionPlan,
  ExecutionPlanWorkflowApprovalNode,
  ExecutionPlanWorkflowBreakpoint,
  ExecutionPlanWorkflowManifest,
  ExecutionPlanWorkflowNode,
  JsonValue,
  OperatorDecision,
  RunEvent,
} from "@napier/contracts";

import type { EventSink } from "./agent-runtime.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import { createId } from "./ids.js";
import type { LocalStore } from "./store.js";
import { validateExecutionPlanWorkflowBreakpointNodeIds } from "./workflow-breakpoint-model.js";
import {
  resolveWorkflowApproval,
  workflowApprovalDecisionContractMatches,
} from "./workflow-approval-model.js";
import {
  hasWorkflowDeterministicCompletionEvent,
  readWorkflowDeterministicOutputEvidence,
} from "./workflow-deterministic-evidence.js";
import {
  hasWorkflowMapCompletionEvent,
  readWorkflowMapOutputEvidence,
} from "./workflow-map-evidence.js";
import {
  hasWorkflowLoopCompletionEvent,
  readWorkflowLoopOutputEvidence,
} from "./workflow-loop-evidence.js";
import {
  hasWorkflowJavascriptCompletionEvent,
  readWorkflowJavascriptOutputEvidence,
} from "./workflow-javascript-evidence.js";
import {
  hasWorkflowReduceCompletionEvent,
  readWorkflowReduceOutputEvidence,
} from "./workflow-reduce-evidence.js";
import {
  workflowNodeEventMetadata,
  workflowNodeEventMetadataMatches,
} from "./workflow-node-evidence.js";
import { workflowPlanStepPayload } from "./workflow-runtime-model.js";
import {
  assertWorkflowValue,
  parseExecutionPlanWorkflowNodeOutput,
  workflowSchemaSha256,
} from "./workflow-schemas.js";
import {
  WORKFLOW_NODE_SIMULATED_EVENT,
  WORKFLOW_NODE_SIMULATION_REQUESTED_EVENT,
} from "./workflow-simulation-evidence.js";

export const WORKFLOW_EVENT_SCHEMA_VERSION = 1;
export const WORKFLOW_STARTED_EVENT = "workflow.started";
export const WORKFLOW_NODE_STARTED_EVENT = "workflow.node.started";
export const WORKFLOW_NODE_COMPLETED_EVENT = "workflow.node.completed";
export const WORKFLOW_NODE_SKIPPED_EVENT = "workflow.node.skipped";
export const WORKFLOW_NODE_FAILED_EVENT = "workflow.node.failed";
export const WORKFLOW_APPROVAL_REQUESTED_EVENT = "workflow.approval.requested";
export const WORKFLOW_COMPLETED_EVENT = "workflow.completed";
export const WORKFLOW_WAITING_EVENT = "workflow.waiting";
export const WORKFLOW_PAUSED_EVENT = "workflow.paused";
export const WORKFLOW_BLOCKED_EVENT = "workflow.blocked";
export const WORKFLOW_CANCELLED_EVENT = "workflow.cancelled";

export {
  workflowNodeEventMetadata,
  workflowNodeEventMetadataMatches,
} from "./workflow-node-evidence.js";

export interface WorkflowLedgerContext {
  threadId: string;
  manifest: ExecutionPlanWorkflowManifest;
  plan: ExecutionPlan;
  onEvent?: EventSink;
}

export interface RecoveredWorkflowStart {
  input: JsonValue;
  agentId: string;
  agentRevision: number;
  breakBeforeNodeIds: string[];
}

export class ExecutionPlanWorkflowLedger {
  constructor(private readonly store: LocalStore) {}

  async recoverWorkflowStart(
    threadId: string,
    planId: string,
    manifest: ExecutionPlanWorkflowManifest,
    maxConcurrency = 1,
    expectedManifestSha256 = manifest.contentSha256,
  ): Promise<RecoveredWorkflowStart> {
    const events = await this.store.listEvents(threadId);
    const started = events.find(
      (event) =>
        event.type === WORKFLOW_STARTED_EVENT &&
        isWorkflowRecord(event.payload) &&
        event.payload["planId"] === planId,
    );
    if (
      !started ||
      !isWorkflowRecord(started.payload) ||
      started.payload["schemaVersion"] !== WORKFLOW_EVENT_SCHEMA_VERSION ||
      started.payload["manifestSha256"] !== expectedManifestSha256 ||
      started.payload["input"] === undefined ||
      typeof started.payload["inputSha256"] !== "string" ||
      (started.payload["maxConcurrency"] ?? 1) !== maxConcurrency ||
      typeof started.payload["agentId"] !== "string" ||
      !/^[a-z][a-z0-9_]{2,80}$/u.test(started.payload["agentId"]) ||
      !positiveInteger(started.payload["agentRevision"])
    ) {
      throw new Error("Workflow start evidence is unavailable or mismatched");
    }
    const input = structuredClone(started.payload["input"]) as JsonValue;
    if (sha256(canonicalJson(input)) !== started.payload["inputSha256"]) {
      throw new Error("Workflow input evidence hash mismatch");
    }
    const breakBeforeNodeIds = validateExecutionPlanWorkflowBreakpointNodeIds(
      manifest,
      started.payload["breakBeforeNodeIds"],
    );
    return {
      input,
      agentId: started.payload["agentId"],
      agentRevision: Number(started.payload["agentRevision"]),
      breakBeforeNodeIds,
    };
  }

  async nodeAssistantOutput(threadId: string, runId: string): Promise<string> {
    const events = await this.store.listEvents(threadId);
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index]!;
      if (
        event.runId === runId &&
        event.type === "message.assistant" &&
        isWorkflowRecord(event.payload) &&
        typeof event.payload["text"] === "string"
      ) {
        return event.payload["text"];
      }
    }
    throw new Error("Workflow node assistant output is unavailable");
  }

  async nodeOutput(
    context: WorkflowLedgerContext,
    node: ExecutionPlanWorkflowNode,
    runId: string,
    inputSha256: string,
    input: JsonValue,
  ): Promise<JsonValue> {
    const run = this.store
      .listRuns(context.threadId)
      .find((candidate) => candidate.id === runId);
    if (!run) throw new Error("Workflow node Run is missing");
    if (
      run.source !== "workflow" &&
      run.source !== "workflow_reuse" &&
      run.source !== "workflow_simulation"
    ) {
      throw new Error("Workflow node Run source is invalid");
    }
    if (run.source === "workflow_simulation") {
      return this.nodeSimulationOutput(context, node, runId, inputSha256);
    }
    if (run.source === "workflow_reuse" || node.type === "agent") {
      return parseExecutionPlanWorkflowNodeOutput(
        await this.nodeAssistantOutput(context.threadId, runId),
        node.outputSchema,
      );
    }
    if (node.type === "approval") {
      const { decision } = await this.approvalDecision(
        context,
        node,
        runId,
        inputSha256,
      );
      if (decision.status !== "continued") {
        throw new Error("Workflow approval decision is not continued");
      }
      const resolution = resolveWorkflowApproval(node, decision);
      if (resolution.status !== "approved") {
        throw new Error("Workflow approval output is unavailable");
      }
      assertWorkflowValue(
        node.outputSchema,
        resolution.output,
        `Workflow approval output ${node.id}`,
      );
      return resolution.output;
    }
    if (node.type === "deterministic") {
      const attempt = await this.attemptForRun(
        context.threadId,
        context.plan.id,
        node.id,
        runId,
      );
      return readWorkflowDeterministicOutputEvidence({
        events: await this.store.listEvents(context.threadId),
        node,
        runId,
        planId: context.plan.id,
        manifestSha256: context.manifest.contentSha256,
        inputSha256,
        input,
        attempt,
        assistantOutput: await this.nodeAssistantOutput(
          context.threadId,
          runId,
        ),
      });
    }
    if (node.type === "map") {
      const attempt = await this.attemptForRun(
        context.threadId,
        context.plan.id,
        node.id,
        runId,
      );
      return readWorkflowMapOutputEvidence({
        events: await this.store.listEvents(context.threadId),
        runs: this.store.listRuns(context.threadId),
        node,
        runId,
        planId: context.plan.id,
        manifestSha256: context.manifest.contentSha256,
        input,
        inputSha256,
        attempt,
        assistantOutput: await this.nodeAssistantOutput(
          context.threadId,
          runId,
        ),
      });
    }
    if (node.type === "loop") {
      const attempt = await this.attemptForRun(
        context.threadId,
        context.plan.id,
        node.id,
        runId,
      );
      if (!run.configuration || run.agentRevision === undefined) {
        throw new Error("Workflow Loop coordinator configuration is missing");
      }
      return readWorkflowLoopOutputEvidence({
        events: await this.store.listEvents(context.threadId),
        runs: this.store.listRuns(context.threadId),
        node,
        runId,
        planId: context.plan.id,
        manifestSha256: context.manifest.contentSha256,
        input,
        inputSha256,
        agentId: run.agentId,
        agentRevision: run.agentRevision,
        model: run.configuration.model,
        attempt,
        assistantOutput: await this.nodeAssistantOutput(
          context.threadId,
          runId,
        ),
      });
    }
    if (node.type === "reduce") {
      const attempt = await this.attemptForRun(
        context.threadId,
        context.plan.id,
        node.id,
        runId,
      );
      return readWorkflowReduceOutputEvidence({
        events: await this.store.listEvents(context.threadId),
        node,
        runId,
        planId: context.plan.id,
        manifestSha256: context.manifest.contentSha256,
        input,
        inputSha256,
        attempt,
        assistantOutput: await this.nodeAssistantOutput(
          context.threadId,
          runId,
        ),
      });
    }
    if (node.type === "javascript") {
      const attempt = await this.attemptForRun(
        context.threadId,
        context.plan.id,
        node.id,
        runId,
      );
      return readWorkflowJavascriptOutputEvidence({
        events: await this.store.listEvents(context.threadId),
        node,
        runId,
        planId: context.plan.id,
        manifestSha256: context.manifest.contentSha256,
        inputSha256,
        attempt,
        assistantOutput: await this.nodeAssistantOutput(
          context.threadId,
          runId,
        ),
      });
    }
    const completions = (await this.store.listEvents(context.threadId)).filter(
      (event) =>
        event.runId === runId &&
        event.type === "tool.completed" &&
        isWorkflowRecord(event.payload) &&
        event.payload["workflowPlanId"] === context.plan.id &&
        event.payload["workflowNodeId"] === node.id,
    );
    const completed = completions.length === 1 ? completions[0] : undefined;
    if (
      !completed ||
      !isWorkflowRecord(completed.payload) ||
      completed.payload["toolName"] !== node.tool ||
      completed.payload["effect"] !== node.effect ||
      completed.payload["workflowInputSha256"] !== inputSha256 ||
      completed.payload["workflowOutput"] === undefined ||
      typeof completed.payload["workflowOutputSha256"] !== "string"
    ) {
      throw new Error("Workflow tool output evidence is unavailable");
    }
    const output = structuredClone(
      completed.payload["workflowOutput"],
    ) as JsonValue;
    assertWorkflowValue(
      node.outputSchema,
      output,
      `Workflow tool output ${node.id}`,
    );
    if (
      sha256(canonicalJson(output)) !==
      completed.payload["workflowOutputSha256"]
    ) {
      throw new Error("Workflow tool output evidence hash mismatch");
    }
    return output;
  }

  private async nodeSimulationOutput(
    context: WorkflowLedgerContext,
    node: ExecutionPlanWorkflowNode,
    runId: string,
    inputSha256: string,
  ): Promise<JsonValue> {
    const events = await this.store.listEvents(context.threadId);
    const requested = events.filter(
      (event) =>
        event.type === WORKFLOW_NODE_SIMULATION_REQUESTED_EVENT &&
        event.visibility === "hidden" &&
        isWorkflowRecord(event.payload) &&
        event.payload["planId"] === context.plan.id &&
        event.payload["nodeId"] === node.id,
    );
    const simulated = events.filter(
      (event) =>
        event.runId === runId &&
        event.type === WORKFLOW_NODE_SIMULATED_EVENT &&
        event.visibility === "user" &&
        isWorkflowRecord(event.payload) &&
        event.payload["planId"] === context.plan.id &&
        event.payload["nodeId"] === node.id,
    );
    const requestedPayload =
      requested.length === 1 && isWorkflowRecord(requested[0]!.payload)
        ? requested[0]!.payload
        : undefined;
    const simulatedPayload =
      simulated.length === 1 && isWorkflowRecord(simulated[0]!.payload)
        ? simulated[0]!.payload
        : undefined;
    const output = requestedPayload?.["output"];
    if (
      !requestedPayload ||
      !simulatedPayload ||
      requestedPayload["schemaVersion"] !== WORKFLOW_EVENT_SCHEMA_VERSION ||
      simulatedPayload["schemaVersion"] !== WORKFLOW_EVENT_SCHEMA_VERSION ||
      requestedPayload["manifestSha256"] !== context.manifest.contentSha256 ||
      simulatedPayload["manifestSha256"] !== context.manifest.contentSha256 ||
      simulatedPayload["inputSha256"] !== inputSha256 ||
      requestedPayload["outputSha256"] !== simulatedPayload["outputSha256"] ||
      requestedPayload["outputBytes"] !== simulatedPayload["outputBytes"] ||
      requestedPayload["outputSchemaSha256"] !==
        workflowSchemaSha256(node.outputSchema) ||
      simulatedPayload["outputSchemaSha256"] !==
        workflowSchemaSha256(node.outputSchema) ||
      output === undefined
    ) {
      throw new Error("Workflow simulation output evidence is unavailable");
    }
    assertWorkflowValue(
      node.outputSchema,
      output,
      `Workflow simulated output ${node.id}`,
    );
    const encoded = canonicalJson(output);
    if (
      sha256(encoded) !== requestedPayload["outputSha256"] ||
      Buffer.byteLength(encoded, "utf8") !== requestedPayload["outputBytes"]
    ) {
      throw new Error("Workflow simulation output evidence hash mismatch");
    }
    return structuredClone(output);
  }

  async approvalDecision(
    context: WorkflowLedgerContext,
    node: ExecutionPlanWorkflowApprovalNode,
    runId: string,
    inputSha256: string,
  ): Promise<{ decision: OperatorDecision; expiresAt: string }> {
    const events = await this.store.listEvents(context.threadId);
    const bindings = events.filter(
      (event) =>
        event.runId === runId &&
        event.type === WORKFLOW_APPROVAL_REQUESTED_EVENT &&
        isWorkflowRecord(event.payload) &&
        event.payload["planId"] === context.plan.id &&
        event.payload["nodeId"] === node.id,
    );
    const binding = bindings.length === 1 ? bindings[0] : undefined;
    if (!binding || !isWorkflowRecord(binding.payload)) {
      throw new Error("Workflow approval request evidence is unavailable");
    }
    const attempt = await this.attemptForRun(
      context.threadId,
      context.plan.id,
      node.id,
      runId,
    );
    const decisionId = binding.payload["decisionId"];
    const requestedEventSeq = binding.payload["requestedEventSeq"];
    const decisionRequestSha256 = binding.payload["decisionRequestSha256"];
    const expiresAt = binding.payload["expiresAt"];
    const decision = (
      await this.store.listOperatorDecisions(context.threadId, runId)
    ).find((candidate) => candidate.id === decisionId);
    const requested = events.find(
      (event) =>
        event.seq === requestedEventSeq &&
        event.runId === runId &&
        event.type === "operator.decision.requested",
    );
    if (
      binding.payload["schemaVersion"] !== WORKFLOW_EVENT_SCHEMA_VERSION ||
      binding.payload["manifestSha256"] !== context.manifest.contentSha256 ||
      binding.payload["attempt"] !== attempt ||
      binding.payload["inputSha256"] !== inputSha256 ||
      binding.payload["inputSchemaSha256"] !==
        workflowSchemaSha256(node.inputSchema) ||
      binding.payload["outputSchemaSha256"] !==
        workflowSchemaSha256(node.outputSchema) ||
      !workflowNodeEventMetadataMatches(node, binding.payload) ||
      typeof decisionId !== "string" ||
      !/^decision_[a-z0-9]{8,80}$/u.test(decisionId) ||
      !positiveInteger(requestedEventSeq) ||
      !hash(decisionRequestSha256) ||
      typeof expiresAt !== "string" ||
      !Number.isFinite(Date.parse(expiresAt)) ||
      new Date(expiresAt).toISOString() !== expiresAt ||
      !decision ||
      expiresAt !==
        new Date(
          Date.parse(decision.requestedAt) + node.timeoutMs,
        ).toISOString() ||
      decision.runId !== runId ||
      decision.requestedEventSeq !== requestedEventSeq ||
      !workflowApprovalDecisionContractMatches(node, decision) ||
      !requested ||
      !isWorkflowRecord(requested.payload) ||
      requested.payload["decisionId"] !== decisionId ||
      requested.payload["requestSha256"] !== decisionRequestSha256
    ) {
      throw new Error("Workflow approval request evidence mismatch");
    }
    return { decision, expiresAt };
  }

  async hasNodeToolCompletionEvent(
    context: WorkflowLedgerContext,
    node: ExecutionPlanWorkflowNode,
    runId: string,
  ): Promise<boolean> {
    if (node.type !== "tool") return false;
    return (await this.store.listEvents(context.threadId)).some(
      (event) =>
        event.runId === runId &&
        event.type === "tool.completed" &&
        isWorkflowRecord(event.payload) &&
        event.payload["workflowPlanId"] === context.plan.id &&
        event.payload["workflowNodeId"] === node.id,
    );
  }

  async hasNodeDeterministicCompletionEvent(
    context: WorkflowLedgerContext,
    node: ExecutionPlanWorkflowNode,
    runId: string,
  ): Promise<boolean> {
    if (node.type !== "deterministic") return false;
    return hasWorkflowDeterministicCompletionEvent(
      await this.store.listEvents(context.threadId),
      context.plan.id,
      node.id,
      runId,
    );
  }

  async hasNodeMapCompletionEvent(
    context: WorkflowLedgerContext,
    node: ExecutionPlanWorkflowNode,
    runId: string,
  ): Promise<boolean> {
    if (node.type !== "map") return false;
    return hasWorkflowMapCompletionEvent(
      await this.store.listEvents(context.threadId),
      context.plan.id,
      node.id,
      runId,
    );
  }

  async hasNodeLoopCompletionEvent(
    context: WorkflowLedgerContext,
    node: ExecutionPlanWorkflowNode,
    runId: string,
  ): Promise<boolean> {
    if (node.type !== "loop") return false;
    return hasWorkflowLoopCompletionEvent(
      await this.store.listEvents(context.threadId),
      context.plan.id,
      node.id,
      runId,
    );
  }

  async hasNodeReduceCompletionEvent(
    context: WorkflowLedgerContext,
    node: ExecutionPlanWorkflowNode,
    runId: string,
  ): Promise<boolean> {
    if (node.type !== "reduce") return false;
    return hasWorkflowReduceCompletionEvent(
      await this.store.listEvents(context.threadId),
      context.plan.id,
      node.id,
      runId,
    );
  }

  async hasNodeJavascriptCompletionEvent(
    context: WorkflowLedgerContext,
    node: ExecutionPlanWorkflowNode,
    runId: string,
  ): Promise<boolean> {
    if (node.type !== "javascript") return false;
    return hasWorkflowJavascriptCompletionEvent(
      await this.store.listEvents(context.threadId),
      context.plan.id,
      node.id,
      runId,
    );
  }

  async verifyOrRecoverNodeCompletedEvent(
    context: WorkflowLedgerContext,
    node: ExecutionPlanWorkflowNode,
    runId: string,
    inputSha256: string,
    outputSha256: string,
  ): Promise<void> {
    const events = await this.store.listEvents(context.threadId);
    const attempt = await this.attemptForRun(
      context.threadId,
      context.plan.id,
      node.id,
      runId,
    );
    const completed = events.find(
      (event) =>
        event.type === WORKFLOW_NODE_COMPLETED_EVENT &&
        event.runId === runId &&
        isWorkflowRecord(event.payload) &&
        event.payload["planId"] === context.plan.id &&
        event.payload["nodeId"] === node.id,
    );
    if (completed) {
      if (
        !isWorkflowRecord(completed.payload) ||
        completed.payload["schemaVersion"] !== WORKFLOW_EVENT_SCHEMA_VERSION ||
        completed.payload["manifestSha256"] !==
          context.manifest.contentSha256 ||
        completed.payload["attempt"] !== attempt ||
        completed.payload["inputSha256"] !== inputSha256 ||
        completed.payload["outputSha256"] !== outputSha256 ||
        completed.payload["inputSchemaSha256"] !==
          workflowSchemaSha256(node.inputSchema) ||
        completed.payload["outputSchemaSha256"] !==
          workflowSchemaSha256(node.outputSchema) ||
        !workflowNodeEventMetadataMatches(node, completed.payload) ||
        typeof completed.payload["recovered"] !== "boolean"
      ) {
        throw new Error("Workflow node completion evidence mismatch");
      }
      return;
    }
    await this.append(
      {
        threadId: context.threadId,
        runId,
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
          recovered: true,
        },
      },
      context.onEvent,
    );
  }

  async appendNodeSkippedEvent(
    context: WorkflowLedgerContext,
    node: ExecutionPlanWorkflowNode,
    inputSha256: string,
    conditionSubjectSha256: string,
    recovered: boolean,
    reused = false,
  ): Promise<void> {
    if (!node.when || node.skipOutput === undefined) {
      throw new Error("Workflow skipped node has no condition");
    }
    await this.append(
      {
        threadId: context.threadId,
        runId: createId("runctl"),
        type: WORKFLOW_NODE_SKIPPED_EVENT,
        category: "plan",
        visibility: "user",
        payload: {
          schemaVersion: WORKFLOW_EVENT_SCHEMA_VERSION,
          planId: context.plan.id,
          nodeId: node.id,
          ...workflowNodeEventMetadata(node),
          attempt: 0,
          manifestSha256: context.manifest.contentSha256,
          inputSha256,
          outputSha256: sha256(canonicalJson(node.skipOutput)),
          conditionSubjectSha256,
          inputSchemaSha256: workflowSchemaSha256(node.inputSchema),
          outputSchemaSha256: workflowSchemaSha256(node.outputSchema),
          planRevision: context.plan.revision,
          matched: false,
          recovered,
          reused,
        },
      },
      context.onEvent,
    );
  }

  async verifyOrRecoverNodeSkippedEvent(
    context: WorkflowLedgerContext,
    node: ExecutionPlanWorkflowNode,
    inputSha256: string,
    conditionSubjectSha256: string,
    reused = false,
  ): Promise<void> {
    if (!node.when || node.skipOutput === undefined) {
      throw new Error("Workflow skipped node has no condition");
    }
    const events = (await this.store.listEvents(context.threadId)).filter(
      (event) =>
        event.type === WORKFLOW_NODE_SKIPPED_EVENT &&
        isWorkflowRecord(event.payload) &&
        event.payload["planId"] === context.plan.id &&
        event.payload["nodeId"] === node.id,
    );
    if (events.length > 1) {
      throw new Error("Workflow node skip evidence is ambiguous");
    }
    const event = events[0];
    if (event && isWorkflowRecord(event.payload)) {
      await this.verifyNodeSkippedEvent(
        context,
        node,
        inputSha256,
        conditionSubjectSha256,
        reused,
      );
      return;
    }
    await this.appendNodeSkippedEvent(
      context,
      node,
      inputSha256,
      conditionSubjectSha256,
      true,
      reused,
    );
  }

  async verifyNodeSkippedEvent(
    context: WorkflowLedgerContext,
    node: ExecutionPlanWorkflowNode,
    inputSha256: string,
    conditionSubjectSha256: string,
    expectedReused?: boolean,
  ): Promise<{ reused: boolean }> {
    const events = (await this.store.listEvents(context.threadId)).filter(
      (event) =>
        event.type === WORKFLOW_NODE_SKIPPED_EVENT &&
        isWorkflowRecord(event.payload) &&
        event.payload["planId"] === context.plan.id &&
        event.payload["nodeId"] === node.id,
    );
    const event = events.length === 1 ? events[0] : undefined;
    if (
      !event ||
      !isWorkflowRecord(event.payload) ||
      !workflowNodeSkippedEventMatches(
        context,
        node,
        event.payload,
        inputSha256,
        conditionSubjectSha256,
      ) ||
      (expectedReused !== undefined &&
        event.payload["reused"] !== expectedReused)
    ) {
      throw new Error(
        events.length > 1
          ? "Workflow node skip evidence is ambiguous"
          : "Workflow node skip evidence mismatch",
      );
    }
    return { reused: event.payload["reused"] === true };
  }

  async ensureNodeStartedEvent(
    context: WorkflowLedgerContext,
    node: ExecutionPlanWorkflowNode,
    runId: string,
    inputSha256: string,
  ): Promise<void> {
    const events = await this.store.listEvents(context.threadId);
    const started = events.find(
      (event) =>
        event.type === WORKFLOW_NODE_STARTED_EVENT &&
        event.runId === runId &&
        isWorkflowRecord(event.payload) &&
        event.payload["planId"] === context.plan.id &&
        event.payload["nodeId"] === node.id,
    );
    if (started && isWorkflowRecord(started.payload)) {
      const before = started.payload["planRevisionBefore"];
      const after = started.payload["planRevisionAfter"];
      if (
        started.payload["schemaVersion"] !== WORKFLOW_EVENT_SCHEMA_VERSION ||
        started.payload["manifestSha256"] !== context.manifest.contentSha256 ||
        !workflowAttempt(started.payload["attempt"]) ||
        Number(started.payload["attempt"]) > node.maxAttempts ||
        started.payload["inputSha256"] !== inputSha256 ||
        started.payload["inputSchemaSha256"] !==
          workflowSchemaSha256(node.inputSchema) ||
        started.payload["outputSchemaSha256"] !==
          workflowSchemaSha256(node.outputSchema) ||
        !workflowNodeEventMetadataMatches(node, started.payload) ||
        !positiveInteger(before) ||
        !positiveInteger(after) ||
        Number(after) < Number(before) ||
        typeof started.payload["recovered"] !== "boolean"
      ) {
        throw new Error("Workflow node start evidence mismatch");
      }
      return;
    }
    const attempt = await this.nextAttempt(
      context.threadId,
      context.plan.id,
      node.id,
    );
    await this.append(
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
          attempt,
          manifestSha256: context.manifest.contentSha256,
          inputSha256,
          inputSchemaSha256: workflowSchemaSha256(node.inputSchema),
          outputSchemaSha256: workflowSchemaSha256(node.outputSchema),
          planRevisionBefore: context.plan.revision,
          planRevisionAfter: context.plan.revision,
          recovered: true,
        },
      },
      context.onEvent,
    );
  }

  async nextAttempt(
    threadId: string,
    planId: string,
    nodeId: string,
  ): Promise<number> {
    const events = await this.store.listEvents(threadId);
    const attempts = events.flatMap((event) => {
      if (
        (event.type !== WORKFLOW_NODE_STARTED_EVENT &&
          event.type !== WORKFLOW_NODE_FAILED_EVENT) ||
        !isWorkflowRecord(event.payload) ||
        event.payload["planId"] !== planId ||
        event.payload["nodeId"] !== nodeId ||
        !Number.isSafeInteger(event.payload["attempt"])
      ) {
        return [];
      }
      return [Number(event.payload["attempt"])];
    });
    return Math.max(0, ...attempts) + 1;
  }

  async attemptForRun(
    threadId: string,
    planId: string,
    nodeId: string,
    runId: string,
  ): Promise<number> {
    const event = (await this.store.listEvents(threadId)).find(
      (candidate) =>
        candidate.type === WORKFLOW_NODE_STARTED_EVENT &&
        candidate.runId === runId &&
        isWorkflowRecord(candidate.payload) &&
        candidate.payload["planId"] === planId &&
        candidate.payload["nodeId"] === nodeId,
    );
    if (
      !event ||
      !isWorkflowRecord(event.payload) ||
      !workflowAttempt(event.payload["attempt"])
    ) {
      throw new Error("Workflow node attempt evidence is unavailable");
    }
    return Number(event.payload["attempt"]);
  }

  async hasTerminalEvent(input: {
    threadId: string;
    planId: string;
    eventType: string;
    manifestSha256: string;
    blueprintSha256: string;
    status: string;
    planRevision: number;
    nodeResultCount: number;
    completedNodeCount: number;
    skippedNodeCount: number;
    breakpoint?: ExecutionPlanWorkflowBreakpoint;
    outputSha256?: string;
  }): Promise<boolean> {
    const terminals = (await this.store.listEvents(input.threadId)).filter(
      (event) =>
        event.type === input.eventType &&
        isWorkflowRecord(event.payload) &&
        event.payload["planId"] === input.planId,
    );
    const current = terminals.find(
      (event) =>
        isWorkflowRecord(event.payload) &&
        event.payload["planRevision"] === input.planRevision,
    );
    if (current && isWorkflowRecord(current.payload)) {
      if (!workflowTerminalEventMatches(current.payload, input, true)) {
        throw new Error("Workflow terminal evidence mismatch");
      }
      return true;
    }
    const legacy =
      terminals.length === 1 &&
      isWorkflowRecord(terminals[0]?.payload) &&
      terminals[0].payload["planRevision"] === undefined
        ? terminals[0]
        : undefined;
    if (
      legacy &&
      isWorkflowRecord(legacy.payload) &&
      workflowTerminalEventMatches(legacy.payload, input, false)
    ) {
      return true;
    }
    return false;
  }

  async appendPlanStepEvent(
    context: WorkflowLedgerContext,
    plan: ExecutionPlan,
    nodeId: string,
    suffix: "started" | "completed" | "blocked" | "skipped" | "reopened",
    runId: string,
  ): Promise<void> {
    const step = plan.steps.find((candidate) => candidate.id === nodeId)!;
    await this.append(
      {
        threadId: context.threadId,
        runId,
        type: `plan.step.${suffix}`,
        category: "plan",
        visibility: "user",
        payload: workflowPlanStepPayload(plan, step),
      },
      context.onEvent,
    );
  }

  async ensurePlanStepEvent(
    context: WorkflowLedgerContext,
    plan: ExecutionPlan,
    nodeId: string,
    suffix: "completed" | "blocked" | "skipped",
    runId: string,
  ): Promise<void> {
    const events = await this.store.listEvents(context.threadId);
    if (
      events.some(
        (event) =>
          event.type === `plan.step.${suffix}` &&
          isWorkflowRecord(event.payload) &&
          event.payload["planId"] === plan.id &&
          event.payload["stepId"] === nodeId,
      )
    ) {
      return;
    }
    await this.appendPlanStepEvent(context, plan, nodeId, suffix, runId);
  }

  async append(
    input: Parameters<LocalStore["appendEvent"]>[0],
    sink?: EventSink,
  ): Promise<RunEvent> {
    const event = await this.store.appendEvent(input);
    if (sink) {
      try {
        await sink(event);
      } catch {
        // Workflow evidence must remain durable if a stream consumer disconnects.
      }
    }
    return event;
  }
}

function workflowTerminalEventMatches(
  payload: Record<string, JsonValue>,
  input: {
    manifestSha256: string;
    blueprintSha256: string;
    status: string;
    planRevision: number;
    nodeResultCount: number;
    completedNodeCount: number;
    skippedNodeCount: number;
    breakpoint?: ExecutionPlanWorkflowBreakpoint;
    outputSha256?: string;
  },
  requirePlanRevision: boolean,
): boolean {
  if (
    payload["schemaVersion"] !== WORKFLOW_EVENT_SCHEMA_VERSION ||
    payload["manifestSha256"] !== input.manifestSha256 ||
    payload["blueprintSha256"] !== input.blueprintSha256 ||
    payload["status"] !== input.status ||
    (requirePlanRevision && payload["planRevision"] !== input.planRevision) ||
    payload["nodeResultCount"] !== input.nodeResultCount ||
    payload["completedNodeCount"] !== input.completedNodeCount ||
    (payload["skippedNodeCount"] ?? 0) !== input.skippedNodeCount ||
    payload["breakpointNodeId"] !== input.breakpoint?.nodeId ||
    payload["breakpointIndex"] !== input.breakpoint?.breakpointIndex ||
    payload["breakpointCount"] !== input.breakpoint?.breakpointCount ||
    payload["breakpointReachedEventSeq"] !==
      input.breakpoint?.reachedEventSeq ||
    payload["breakpointBindingContextSha256"] !==
      input.breakpoint?.bindingContextSha256 ||
    payload["outputSha256"] !== input.outputSha256 ||
    !hash(payload["resultSha256"])
  ) {
    return false;
  }
  return true;
}

function workflowNodeSkippedEventMatches(
  context: WorkflowLedgerContext,
  node: ExecutionPlanWorkflowNode,
  payload: Record<string, JsonValue>,
  inputSha256: string,
  conditionSubjectSha256: string,
): boolean {
  return (
    node.when !== undefined &&
    node.skipOutput !== undefined &&
    payload["schemaVersion"] === WORKFLOW_EVENT_SCHEMA_VERSION &&
    payload["planId"] === context.plan.id &&
    payload["nodeId"] === node.id &&
    payload["attempt"] === 0 &&
    payload["manifestSha256"] === context.manifest.contentSha256 &&
    payload["inputSha256"] === inputSha256 &&
    payload["outputSha256"] === sha256(canonicalJson(node.skipOutput)) &&
    payload["conditionSubjectSha256"] === conditionSubjectSha256 &&
    payload["inputSchemaSha256"] === workflowSchemaSha256(node.inputSchema) &&
    payload["outputSchemaSha256"] === workflowSchemaSha256(node.outputSchema) &&
    workflowNodeEventMetadataMatches(node, payload) &&
    positiveInteger(payload["planRevision"]) &&
    payload["matched"] === false &&
    typeof payload["recovered"] === "boolean" &&
    typeof payload["reused"] === "boolean"
  );
}

export function isWorkflowRecord(
  value: unknown,
): value is Record<string, JsonValue> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function workflowAttempt(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 3
  );
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}

function hash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}
