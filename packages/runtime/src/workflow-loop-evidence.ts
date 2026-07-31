import type {
  ExecutionPlanWorkflowLoopNode,
  JsonValue,
  ModelRef,
  RunEvent,
  RunRecord,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import { executionPlanWorkflowConditionSha256 } from "./workflow-condition-model.js";
import {
  evaluateWorkflowLoopUntil,
  workflowLoopIterationContext,
  workflowLoopIterationInputSha256,
  workflowLoopNodeConfigurationSha256,
} from "./workflow-loop-model.js";
import {
  parseExecutionPlanWorkflowNodeOutput,
  workflowSchemaSha256,
} from "./workflow-schemas.js";

export const WORKFLOW_LOOP_ITERATION_STARTED_EVENT =
  "workflow.loop.iteration.started";
export const WORKFLOW_LOOP_ITERATION_COMPLETED_EVENT =
  "workflow.loop.iteration.completed";
export const WORKFLOW_LOOP_ITERATION_FAILED_EVENT =
  "workflow.loop.iteration.failed";
export const WORKFLOW_LOOP_CHECKPOINT_REUSED_EVENT =
  "workflow.loop.checkpoint.reused";
export const WORKFLOW_LOOP_COMPLETED_EVENT = "workflow.loop.completed";

export interface WorkflowLoopCheckpointIteration {
  iterationIndex: number;
  coordinatorRunId: string;
  childRunId: string;
  iterationInputSha256: string;
  output: JsonValue;
  outputSha256: string;
  untilSubjectSha256: string;
  matched: boolean;
  completedEventSeq: number;
}

export interface WorkflowLoopCheckpoint {
  iterations: WorkflowLoopCheckpointIteration[];
  output?: JsonValue;
  matched: boolean;
  checkpointSha256: string;
}

export function hasWorkflowLoopCompletionEvent(
  events: RunEvent[],
  planId: string,
  nodeId: string,
  runId: string,
): boolean {
  return events.some(
    (event) =>
      event.runId === runId &&
      event.type === WORKFLOW_LOOP_COMPLETED_EVENT &&
      record(event.payload)?.["planId"] === planId &&
      record(event.payload)?.["nodeId"] === nodeId,
  );
}

export function recoverWorkflowLoopCheckpoint(options: {
  events: RunEvent[];
  runs: RunRecord[];
  node: ExecutionPlanWorkflowLoopNode;
  planId: string;
  manifestSha256: string;
  nodeInput: JsonValue;
  nodeInputSha256: string;
  agentId: string;
  agentRevision: number;
  model: ModelRef;
  maxEventSeq?: number;
}): WorkflowLoopCheckpoint {
  const events = options.events.filter(
    (event) =>
      options.maxEventSeq === undefined || event.seq <= options.maxEventSeq,
  );
  const runById = new Map(options.runs.map((run) => [run.id, run]));
  const iterations: WorkflowLoopCheckpointIteration[] = [];
  let previousOutput: JsonValue | undefined;
  for (
    let iterationIndex = 0;
    iterationIndex < options.node.maxIterations;
    iterationIndex += 1
  ) {
    const context = workflowLoopIterationContext(
      options.node,
      options.nodeInput,
      previousOutput,
      iterationIndex,
    );
    const iterationInputSha256 = workflowLoopIterationInputSha256(
      options.nodeInputSha256,
      context,
    );
    const candidates = events.filter(
      (event) =>
        event.type === WORKFLOW_LOOP_ITERATION_COMPLETED_EVENT &&
        record(event.payload)?.["planId"] === options.planId &&
        record(event.payload)?.["nodeId"] === options.node.id &&
        record(event.payload)?.["iterationIndex"] === iterationIndex &&
        record(event.payload)?.["iterationInputSha256"] ===
          iterationInputSha256,
    );
    const validated = candidates.map((event) =>
      validateIterationCompletion({
        ...options,
        events,
        runById,
        event,
        iterationIndex,
        iterationInputSha256,
      }),
    );
    const selected = validated.sort(
      (left, right) => right.completedEventSeq - left.completedEventSeq,
    )[0];
    if (!selected) break;
    iterations.push(selected);
    previousOutput = selected.output;
    if (selected.matched) break;
  }
  const matched = iterations.at(-1)?.matched === true;
  return {
    iterations,
    ...(previousOutput !== undefined
      ? { output: structuredClone(previousOutput) }
      : {}),
    matched,
    checkpointSha256: workflowLoopCheckpointSha256(iterations),
  };
}

export function readWorkflowLoopOutputEvidence(options: {
  events: RunEvent[];
  runs: RunRecord[];
  node: ExecutionPlanWorkflowLoopNode;
  runId: string;
  planId: string;
  manifestSha256: string;
  input: JsonValue;
  inputSha256: string;
  agentId: string;
  agentRevision: number;
  model: ModelRef;
  attempt: number;
  assistantOutput: string;
}): JsonValue {
  const completions = options.events.filter(
    (event) =>
      event.runId === options.runId &&
      event.type === WORKFLOW_LOOP_COMPLETED_EVENT &&
      record(event.payload)?.["planId"] === options.planId &&
      record(event.payload)?.["nodeId"] === options.node.id,
  );
  const completion = completions.length === 1 ? completions[0] : undefined;
  const payload = record(completion?.payload);
  if (!completion || !payload) {
    throw new Error("Workflow Loop output evidence is unavailable");
  }
  const output = parseExecutionPlanWorkflowNodeOutput(
    options.assistantOutput,
    options.node.outputSchema,
  );
  const serializedOutput = canonicalJson(output);
  const checkpoint = recoverWorkflowLoopCheckpoint({
    events: options.events,
    runs: options.runs,
    node: options.node,
    planId: options.planId,
    manifestSha256: options.manifestSha256,
    nodeInput: options.input,
    nodeInputSha256: options.inputSha256,
    agentId: options.agentId,
    agentRevision: options.agentRevision,
    model: options.model,
    maxEventSeq: completion.seq,
  });
  const finalIteration = checkpoint.iterations.at(-1);
  const childRunIds = checkpoint.iterations.map(
    (iteration) => iteration.childRunId,
  );
  const reusedIterationCount = checkpoint.iterations.filter(
    (iteration) => iteration.coordinatorRunId !== options.runId,
  ).length;
  if (
    payload["schemaVersion"] !== 1 ||
    payload["manifestSha256"] !== options.manifestSha256 ||
    payload["attempt"] !== options.attempt ||
    payload["loopConfigurationSha256"] !==
      workflowLoopNodeConfigurationSha256(options.node) ||
    payload["inputSha256"] !== options.inputSha256 ||
    payload["outputSha256"] !== sha256(serializedOutput) ||
    payload["outputBytes"] !== Buffer.byteLength(serializedOutput, "utf8") ||
    payload["outputSchemaSha256"] !==
      workflowSchemaSha256(options.node.outputSchema) ||
    payload["iterationCount"] !== checkpoint.iterations.length ||
    payload["reusedIterationCount"] !== reusedIterationCount ||
    payload["maxIterations"] !== options.node.maxIterations ||
    payload["iterationRunSetSha256"] !== sha256(canonicalJson(childRunIds)) ||
    payload["checkpointSha256"] !== checkpoint.checkpointSha256 ||
    payload["untilSubjectSha256"] !== finalIteration?.untilSubjectSha256 ||
    payload["termination"] !== "condition_matched" ||
    !checkpoint.matched ||
    checkpoint.output === undefined ||
    canonicalJson(checkpoint.output) !== serializedOutput
  ) {
    throw new Error("Workflow Loop output evidence mismatch");
  }
  return output;
}

export function workflowLoopCheckpointSha256(
  iterations: readonly WorkflowLoopCheckpointIteration[],
): string {
  return sha256(
    canonicalJson(
      iterations.map((iteration) => ({
        iterationIndex: iteration.iterationIndex,
        coordinatorRunId: iteration.coordinatorRunId,
        childRunId: iteration.childRunId,
        iterationInputSha256: iteration.iterationInputSha256,
        outputSha256: iteration.outputSha256,
        untilSubjectSha256: iteration.untilSubjectSha256,
        matched: iteration.matched,
      })),
    ),
  );
}

function validateIterationCompletion(options: {
  events: RunEvent[];
  runById: ReadonlyMap<string, RunRecord>;
  node: ExecutionPlanWorkflowLoopNode;
  planId: string;
  manifestSha256: string;
  nodeInputSha256: string;
  agentId: string;
  agentRevision: number;
  model: ModelRef;
  event: RunEvent;
  iterationIndex: number;
  iterationInputSha256: string;
}): WorkflowLoopCheckpointIteration {
  const payload = record(options.event.payload);
  const coordinatorRunId = payload?.["coordinatorRunId"];
  const coordinator =
    typeof coordinatorRunId === "string"
      ? options.runById.get(coordinatorRunId)
      : undefined;
  const child = options.runById.get(options.event.runId);
  const starts = options.events.filter(
    (event) =>
      event.runId === options.event.runId &&
      event.type === WORKFLOW_LOOP_ITERATION_STARTED_EVENT &&
      record(event.payload)?.["planId"] === options.planId &&
      record(event.payload)?.["nodeId"] === options.node.id,
  );
  const started = starts.length === 1 ? record(starts[0]!.payload) : undefined;
  const childCompletions = options.events.filter(
    (event) =>
      event.runId === options.event.runId &&
      event.type === WORKFLOW_LOOP_ITERATION_COMPLETED_EVENT &&
      record(event.payload)?.["planId"] === options.planId &&
      record(event.payload)?.["nodeId"] === options.node.id,
  );
  const coordinatorStarts =
    typeof coordinatorRunId === "string"
      ? options.events.filter(
          (event) =>
            event.runId === coordinatorRunId &&
            event.type === "workflow.node.started" &&
            record(event.payload)?.["planId"] === options.planId &&
            record(event.payload)?.["nodeId"] === options.node.id,
        )
      : [];
  const coordinatorStarted =
    coordinatorStarts.length === 1
      ? record(coordinatorStarts[0]!.payload)
      : undefined;
  const attempt = payload?.["attempt"];
  if (
    !payload ||
    !started ||
    !coordinatorStarted ||
    !Number.isSafeInteger(attempt) ||
    Number(attempt) < 1 ||
    Number(attempt) > options.node.maxAttempts ||
    payload["schemaVersion"] !== 1 ||
    payload["manifestSha256"] !== options.manifestSha256 ||
    payload["loopConfigurationSha256"] !==
      workflowLoopNodeConfigurationSha256(options.node) ||
    payload["iterationIndex"] !== options.iterationIndex ||
    payload["iterationInputSha256"] !== options.iterationInputSha256 ||
    payload["outputSchemaSha256"] !==
      workflowSchemaSha256(options.node.outputSchema) ||
    childCompletions.length !== 1 ||
    starts[0]!.seq >= options.event.seq ||
    started["schemaVersion"] !== 1 ||
    started["attempt"] !== attempt ||
    started["coordinatorRunId"] !== coordinatorRunId ||
    started["manifestSha256"] !== options.manifestSha256 ||
    started["loopConfigurationSha256"] !==
      workflowLoopNodeConfigurationSha256(options.node) ||
    started["iterationIndex"] !== options.iterationIndex ||
    started["maxIterations"] !== options.node.maxIterations ||
    started["iterationInputSha256"] !== options.iterationInputSha256 ||
    started["outputSchemaSha256"] !==
      workflowSchemaSha256(options.node.outputSchema) ||
    coordinatorStarted["schemaVersion"] !== 1 ||
    coordinatorStarted["manifestSha256"] !== options.manifestSha256 ||
    coordinatorStarted["nodeType"] !== "loop" ||
    coordinatorStarted["loopConfigurationSha256"] !==
      workflowLoopNodeConfigurationSha256(options.node) ||
    coordinatorStarted["attempt"] !== attempt ||
    coordinatorStarted["inputSha256"] !== options.nodeInputSha256 ||
    coordinatorStarted["inputSchemaSha256"] !==
      workflowSchemaSha256(options.node.inputSchema) ||
    coordinatorStarted["outputSchemaSha256"] !==
      workflowSchemaSha256(options.node.outputSchema) ||
    !coordinatorConditionMatches(options.node, coordinatorStarted) ||
    coordinatorStarts[0]!.seq >= starts[0]!.seq ||
    !coordinator ||
    coordinator.threadId !== child?.threadId ||
    coordinator.source !== "workflow" ||
    coordinator.workflowPlanId !== options.planId ||
    coordinator.parentRunId !== undefined ||
    coordinator.agentId !== options.agentId ||
    coordinator.agentRevision !== options.agentRevision ||
    !coordinator.configuration ||
    coordinator.configuration.schemaVersion === 1 ||
    coordinator.configuration.executionMode !== "standard" ||
    coordinator.configuration.model.provider !== options.model.provider ||
    coordinator.configuration.model.id !== options.model.id ||
    !child ||
    child.parentRunId !== coordinator.id ||
    child.workflowPlanId !== options.planId ||
    child.source !== "workflow" ||
    child.status !== "completed" ||
    child.agentId !== options.agentId ||
    child.agentRevision !== options.agentRevision ||
    !child.configuration ||
    child.configuration.schemaVersion === 1 ||
    child.configuration.executionMode !== "workflow_loop_read_only" ||
    child.configuration.model.provider !== options.model.provider ||
    child.configuration.model.id !== options.model.id
  ) {
    throw new Error("Workflow Loop iteration evidence is invalid");
  }
  const output = parseExecutionPlanWorkflowNodeOutput(
    assistantText(options.events, child.id),
    options.node.outputSchema,
  );
  const serializedOutput = canonicalJson(output);
  const evaluation = evaluateWorkflowLoopUntil(options.node, output);
  if (
    payload["outputSha256"] !== sha256(serializedOutput) ||
    payload["outputBytes"] !== Buffer.byteLength(serializedOutput, "utf8") ||
    payload["untilSubjectSha256"] !== evaluation.subjectSha256 ||
    payload["matched"] !== evaluation.matched
  ) {
    throw new Error("Workflow Loop iteration output evidence mismatch");
  }
  return {
    iterationIndex: options.iterationIndex,
    coordinatorRunId: coordinator.id,
    childRunId: child.id,
    iterationInputSha256: options.iterationInputSha256,
    output,
    outputSha256: sha256(serializedOutput),
    untilSubjectSha256: evaluation.subjectSha256,
    matched: evaluation.matched,
    completedEventSeq: options.event.seq,
  };
}

function coordinatorConditionMatches(
  node: ExecutionPlanWorkflowLoopNode,
  payload: Record<string, unknown>,
): boolean {
  if (!node.when || node.skipOutput === undefined) {
    return (
      payload["conditionSha256"] === undefined &&
      payload["skipOutputSha256"] === undefined
    );
  }
  return (
    payload["conditionSha256"] ===
      executionPlanWorkflowConditionSha256(node.when) &&
    payload["skipOutputSha256"] === sha256(canonicalJson(node.skipOutput))
  );
}

function assistantText(events: RunEvent[], runId: string): string {
  const messages = events.filter(
    (event) =>
      event.runId === runId &&
      event.type === "message.assistant" &&
      record(event.payload)?.["role"] === "assistant" &&
      typeof record(event.payload)?.["text"] === "string",
  );
  const text = record(messages.at(-1)?.payload)?.["text"];
  if (typeof text !== "string") {
    throw new Error("Workflow Loop iteration assistant output is unavailable");
  }
  return text;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
