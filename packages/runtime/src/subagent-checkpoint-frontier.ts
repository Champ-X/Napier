import type { RunEvent, RunRecord, SubagentTask } from "@napier/contracts";
import { canonicalJson, sha256 } from "./ed25519.js";
import { assertChildModelEvidence } from "./subagent-child-evidence-validation.js";
import { liveToolEffectAuthoritiesFromEvents } from "./sqlite-tool-effect-authority.js";
import { toolOperationLedgerState } from "./tool-operation-ledger-support.js";
import type { SubagentCheckpointFrontier } from "./subagent-working-set-types.js";

/** A durable context boundary never asserts completion of unresolved physical work. */
export function subagentCheckpointFrontier(run: RunRecord, task: SubagentTask,
  events: readonly RunEvent[]): SubagentCheckpointFrontier {
  if (run.usageStatus !== "complete") throw new Error("Child checkpoint has unresolved model usage");
  assertChildModelEvidence(run, events);
  assertSettledToolFrontier(events);
  return { threadId: run.threadId, runId: run.id, taskId: task.id, executionId: task.executionId!,
    parentRunId: run.parentRunId!, parentConfigurationSha256: run.subagent!.parentConfigurationSha256,
    configurationSha256: run.configuration!.contentSha256,
    executionRevision: run.subagent!.executionRevision, checkpointRevision: run.subagent!.checkpoint?.revision ?? 0,
    runHeadSeq: events.at(-1)?.seq ?? 0, nextInvocationIndex: run.subagent!.nextInvocationIndex,
    usageSha256: sha256(canonicalJson(run.usage)), turnCount: task.turnCount, stepCount: task.stepCount };
}

function assertSettledToolFrontier(events: readonly RunEvent[]): void {
  if (liveToolEffectAuthoritiesFromEvents(events).length > 0)
    throw new Error("Child checkpoint has live tool effect authority");
  const operationIds = new Set(events.flatMap((event) => {
    const payload = record(event.payload);
    return event.type.startsWith("tool.operation.") && typeof payload["operationId"] === "string"
      ? [payload["operationId"]] : [];
  }));
  for (const operationId of operationIds) {
    const state = toolOperationLedgerState(events, operationId);
    if (state.effectIndeterminate || (state.admission === "admitted" && !state.settled))
      throw new Error("Child checkpoint has an unsettled tool operation");
  }
  for (const start of events.filter((event) => event.type === "tool.started")) {
    const payload = record(start.payload);
    const terminals = events.filter((event) => (event.type === "tool.completed" || event.type === "tool.failed") &&
      record(event.payload)["callId"] === payload["callId"]);
    if (terminals.length !== 1 || terminals[0]!.seq <= start.seq ||
        record(terminals[0]!.payload)["toolName"] !== payload["toolName"])
      throw new Error("Child checkpoint has an incomplete tool exchange");
  }
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
