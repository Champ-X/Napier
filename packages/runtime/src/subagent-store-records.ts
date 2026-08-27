import type {
  JsonValue,
  SubagentOutcome,
  SubagentRole,
  SubagentStopReason,
  SubagentSupervisorStatus,
  SubagentTask,
  SubagentTaskStatus,
  WorkflowValueSchema,
} from "@napier/contracts";
import { emptyUsage } from "@napier/contracts";

import { assertSubagentOutcomeBinding } from "./subagent-outcomes.js";

export interface CreateSubagentTaskInput {
  threadId: string;
  runId: string;
  role: SubagentRole;
  description: string;
  prompt: string;
  model: SubagentTask["model"];
  providerId?: string;
  executionId?: string;
  outputSchema?: WorkflowValueSchema;
  outputSchemaSha256?: string;
  writePaths?: string[];
  routePlanId?: string;
  revivedFromTaskId?: string;
  failureContextSha256?: string;
}

export interface FinishSubagentTaskInput {
  status: Exclude<SubagentTaskStatus, "pending" | "running">;
  stopReason: SubagentStopReason;
  result?: string;
  outcome?: SubagentOutcome;
  output?: JsonValue;
  error?: string;
  usage?: SubagentTask["usage"];
}

export function createSubagentTaskRecord(
  input: CreateSubagentTaskInput,
  id: string,
  timestamp: string,
): SubagentTask {
  return {
    id,
    threadId: input.threadId,
    runId: input.runId,
    role: input.role,
    description: input.description,
    prompt: input.prompt,
    status: "pending",
    model: structuredClone(input.model),
    ...(input.providerId ? { providerId: input.providerId } : {}),
    ...(input.executionId ? { executionId: input.executionId } : {}),
    supervisorStatus: "queued",
    ...(input.outputSchema
      ? { outputSchema: structuredClone(input.outputSchema) }
      : {}),
    ...(input.outputSchemaSha256
      ? { outputSchemaSha256: input.outputSchemaSha256 }
      : {}),
    ...(input.writePaths ? { writePaths: [...input.writePaths] } : {}),
    ...(input.routePlanId ? { routePlanId: input.routePlanId } : {}),
    ...(input.revivedFromTaskId
      ? { revivedFromTaskId: input.revivedFromTaskId }
      : {}),
    ...(input.failureContextSha256
      ? { failureContextSha256: input.failureContextSha256 }
      : {}),
    stepCount: 0,
    turnCount: 0,
    usage: emptyUsage(),
    createdAt: timestamp,
    revision: 1,
  };
}

export function startSubagentTaskRecord(
  task: SubagentTask,
  timestamp: string,
): void {
  if (task.status !== "pending") {
    throw new Error(`Cannot start subagent task in ${task.status} state`);
  }
  task.status = "running";
  task.supervisorStatus = "running";
  task.startedAt = timestamp;
  task.revision += 1;
}

export function finishSubagentTaskRecord(
  task: SubagentTask,
  input: FinishSubagentTaskInput,
  timestamp: string,
): void {
  if (input.outcome !== undefined && input.status !== "completed") {
    throw new Error("Only completed subagent tasks may carry an outcome");
  }
  const outcome =
    input.outcome === undefined
      ? undefined
      : assertSubagentOutcomeBinding(input.outcome, task);
  task.status = input.status;
  task.stopReason = input.stopReason;
  if (input.result !== undefined) task.result = input.result;
  if (outcome !== undefined) task.outcome = outcome;
  if (input.output !== undefined) task.output = structuredClone(input.output);
  if (input.error !== undefined) task.error = input.error;
  if (input.usage) task.usage = structuredClone(input.usage);
  task.finishedAt = timestamp;
  task.supervisorStatus = input.status;
  task.revision += 1;
}

export function setSubagentSupervisorStatusRecord(
  task: SubagentTask,
  status: SubagentSupervisorStatus,
): void {
  task.supervisorStatus = status;
  task.revision += 1;
}
