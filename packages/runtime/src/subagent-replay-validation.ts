import type { RunEvent, RunRecord, SubagentTask } from "@napier/contracts";
import { assertModelRequestEvidenceBindings } from "./model-prompt-evidence-bindings.js";
import { validateChildCheckpointEvents } from "./subagent-checkpoint-validation.js";
import { assertChildModelEvidence } from "./subagent-child-evidence-validation.js";
import { assertAccountingProjection } from "./model-accounting-projection.js";
import { validateSubagentChildRunState } from "./subagent-child-run-validation.js";
import { SUBAGENT_WORKTREE_POLICY } from "./subagent-worktree-policy.js";
import { assertSubagentFailureContext } from "./subagent-failure-context.js";
import {
  normalizeSubagentOutputSchema,
  subagentOutputSchemaSha256,
} from "./subagent-output-schema.js";

const RESOURCE_ID = /^[a-z][a-z0-9_]{2,80}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SUPERVISOR_STATUSES = new Set([
  "queued",
  "starting",
  "running",
  "waiting_input",
  "reviewing",
  "completed",
  "failed",
  "cancelled",
  "timed_out",
  "orphaned",
]);

export function validateSubagentSupervisorReplayTask(
  task: Record<string, unknown>,
  index: number,
): void {
  const label = `subagents[${index}]`;
  if (task["providerId"] !== undefined) {
    assertBoundedString(task["providerId"], `${label}.providerId`);
  }
  if (task["executionId"] !== undefined) {
    assertResourceId(task["executionId"], `${label}.executionId`);
  }
  if (task["childRunId"] !== undefined) {
    assertResourceId(task["childRunId"], `${label}.childRunId`);
    if (task["executionId"] === undefined)
      invalid(`${label} child Run requires an execution identity`);
  }
  if ((task["providerId"] === undefined) !== (task["executionId"] === undefined)) {
    invalid(`${label} provider binding is incomplete`);
  }
  if (task["supervisorStatus"] !== undefined) {
    if (typeof task["supervisorStatus"] !== "string" || !SUPERVISOR_STATUSES.has(task["supervisorStatus"])) {
      invalid(`${label}.supervisorStatus is invalid`);
    }
  }
  if (task["routePlanId"] !== undefined) {
    assertResourceId(task["routePlanId"], `${label}.routePlanId`);
  }
  if (task["revivedFromTaskId"] !== undefined) {
    assertResourceId(task["revivedFromTaskId"], `${label}.revivedFromTaskId`);
  }
  if (task["writePaths"] !== undefined) {
    const writePaths = task["writePaths"];
    if (
      !Array.isArray(writePaths) ||
      writePaths.length < 1 ||
      writePaths.length > SUBAGENT_WORKTREE_POLICY.maxWriteFiles ||
      writePaths.some(
        (value) =>
          typeof value !== "string" || !value.trim() || value.length > 500,
      )
    ) {
      invalid(`${label}.writePaths is invalid`);
    }
    if (task["role"] !== "coder") {
      invalid(`${label}.writePaths requires coder role`);
    }
  }
  validateTypedOutputBinding(task, label);
  assertSubagentFailureContext(task, label);
}

function validateTypedOutputBinding(
  task: Record<string, unknown>,
  label: string,
): void {
  if (task["outputSchema"] === undefined) {
    if (task["outputSchemaSha256"] !== undefined || task["output"] !== undefined) {
      invalid(`${label} typed output binding is incomplete`);
    }
    return;
  }
  const schema = normalizeSubagentOutputSchema(task["outputSchema"]);
  const digest = task["outputSchemaSha256"];
  if (typeof digest !== "string" || !SHA256.test(digest)) {
    invalid(`${label}.outputSchemaSha256 is invalid`);
  }
  if (subagentOutputSchemaSha256(schema) !== digest) {
    invalid(`${label} output schema binding is invalid`);
  }
}

function assertResourceId(value: unknown, label: string): void {
  const id = assertBoundedString(value, label);
  if (!RESOURCE_ID.test(id)) invalid(`${label} is invalid`);
}

function assertBoundedString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value || value.length > 80) {
    invalid(`${label} is invalid`);
  }
  return value as string;
}

function invalid(message: string): never {
  throw new Error(`Thread replay bundle ${message}`);
}

export function assertReplaySubagentBindings(runs: readonly RunRecord[], tasks: readonly SubagentTask[],
  events: readonly RunEvent[], currentRunId: unknown): void {
  validateSubagentChildRunState(runs, tasks);
  const childIds = new Set(runs.filter((run) => run.source === "subagent").map((run) => run.id));
  if (typeof currentRunId === "string" && childIds.has(currentRunId))
    invalid("child Run cannot be currentRunId");
  assertModelRequestEvidenceBindings(events.filter((event) => !childIds.has(event.runId)), {
    knownRunIds: new Set(runs.map((run) => run.id)), label: "Thread replay bundle",
  });
  for (const run of runs) {
    assertAccountingProjection(run, tasks.filter((task) => task.runId === run.id), events.filter((event) => event.runId === run.id));
    if (childIds.has(run.id)) {
      const childEvents = events.filter((event) => event.runId === run.id);
      assertChildModelEvidence(run, childEvents);
      validateChildCheckpointEvents(run, childEvents);
    }
  }
}
