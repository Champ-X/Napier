import { emptyUsage, type JsonObject, type RunEvent, type Usage } from "@napier/contracts";
import { canonicalJson, sha256 } from "./ed25519.js";
import type { SubagentChildRunHost } from "./subagent-child-run-host.js";
import { assertChildRunFence, childRunState } from "./subagent-child-run-fence.js";
import { bindChildInvocationCapture } from "./subagent-child-invocation-capture.js";
import { refreshRunAccounting } from "./model-accounting-projection.js";
import { readModelAccountingEvidence } from "./model-accounting-fold.js";
import { claimChildThinkingSuppression } from "./subagent-response-disposition.js";
export { assertChildLogicalInvocationsSettled } from "./model-accounting-fold.js";
import type { ReserveSubagentChildInvocationInput, SettleSubagentChildInvocationInput,
  SubagentChildInvocationReservation, SubagentChildRunState } from "./subagent-child-run-types.js";

const PHASES = new Set(["subagent_turn", "typed_repair", "outcome_repair", "context_compaction"]);
const USAGE_KEYS = Object.keys(emptyUsage()) as Array<keyof Usage>;

export async function reserveChildInvocation(host: SubagentChildRunHost,
  input: ReserveSubagentChildInvocationInput): Promise<SubagentChildInvocationReservation> {
  input = { ...input };
  host.assertInitialized();
  if (!/^[a-zA-Z0-9_.:-]{1,160}$/u.test(input.requestId) || !PHASES.has(input.phase))
    throw new Error("Child invocation request identity or phase is invalid");
  return host.stateQueue.run(async () => {
    const { run, task } = assertChildRunFence(host, input, { checkRevision: false });
    if (task.completionReservation) throw new Error("Child completion is reserved; new model invocations are fenced");
    const invocationId = `childinv_${sha256(canonicalJson({ runId: run.id,
      executionId: input.executionId, requestId: input.requestId }))}`;
    const existing = reservation(host.requireLedger().listRunEvents(run.id), invocationId);
    if (existing) {
      if (existing["phase"] !== input.phase) throw new Error("Child invocation reservation conflicts");
      host.assertInitialized();
      const current = assertChildRunFence(host, input, { checkRevision: false });
      return { invocationId, invocationIndex: Number(existing["invocationIndex"]),
        executionRevision: current.run.subagent!.executionRevision };
    }
    assertChildRunFence(host, input);
    const invocationIndex = ++run.subagent!.nextInvocationIndex;
    run.subagent!.executionRevision += 1;
    run.usageStatus = "incomplete";
    task.usageStatus = "incomplete";
    const events = host.appendEventsToThread(host.mutableThread(run.threadId), [{
      threadId: run.threadId, runId: run.id, type: "subagent.child.invocation_reserved",
      category: "subagent", visibility: "debug", payload: {
        taskId: input.taskId, executionId: input.executionId, invocationId,
        invocationIndex, phase: input.phase, requestId: input.requestId,
      },
    }]);
    refreshRunAccounting(host, run.id, events);
    await host.persistState(events);
    return { invocationId, invocationIndex, executionRevision: run.subagent!.executionRevision, events };
  });
}

export async function settleChildInvocation(host: SubagentChildRunHost,
  input: SettleSubagentChildInvocationInput): Promise<SubagentChildRunState> {
  input = { ...input, payload: structuredClone(input.payload), ...(input.usage ? { usage: { ...input.usage } } : {}),
    ...(input.capture ? { capture: structuredClone(input.capture) } : {}) };
  canonicalJson(input.payload);
  host.assertInitialized();
  const usage = validateUsage(input.usage, input.usageStatus ?? "known");
  if (input.payload["usage"] !== undefined && canonicalJson(input.payload["usage"]) !== canonicalJson(usage))
    throw new Error("Child invocation payload usage conflicts with canonical usage");
  return host.stateQueue.run(async () => {
    const { run, task } = assertChildRunFence(host, input, { requireParentActive: false, checkRevision: false });
    const events = host.requireLedger().listRunEvents(run.id);
    const reserved = reservation(events, input.invocationId);
    if (!reserved) throw new Error("Child invocation has no durable reservation");
    const capture = bindChildInvocationCapture(input, Number(reserved["invocationIndex"]));
    const payload: JsonObject = { ...capture.payload, childInvocationId: input.invocationId,
      subagentTaskId: task.id, subagentExecutionId: input.executionId,
      subagentPhase: reserved["phase"]!, invocationIndex: reserved["invocationIndex"]!,
      usageStatus: usage ? "known" : "unknown", ...(usage ? { usage } : {}) };
    claimChildThinkingSuppression(input.thinkingSuppression, payload, { threadId: run.threadId, runId: run.id });
    const previous = events.find((event) => event.type === "model.response" &&
      record(event.payload)?.["childInvocationId"] === input.invocationId);
    if (previous) {
      if (canonicalJson(previous.payload) !== canonicalJson(payload))
        throw new Error("Child invocation settlement conflicts with durable response");
      host.assertInitialized();
      const current = assertChildRunFence(host, input, { requireParentActive: false, checkRevision: false });
      return childRunState(current.run, current.task);
    }
    assertChildRunFence(host, input, { requireParentActive: false });
    const accounting = readModelAccountingEvidence(events);
    const attributed = [...accounting.attributions.values()].find((value) => value.owner.kind === "child" &&
      value.owner.childInvocationId === input.invocationId);
    if (attributed && (payload["physicalId"] !== attributed.physicalId ||
      payload["attributionSha256"] !== attributed.contentSha256 || payload["accountingMode"] !== "physical_receipt_v1"))
      throw new Error("Child logical response lacks its physical accounting reference");
    if (attributed && (!input.capture || canonicalJson(input.capture.envelope) !== canonicalJson(attributed.capture.envelope) ||
      canonicalJson(input.capture.adapter ?? null) !== canonicalJson(attributed.capture.adapter)))
      throw new Error("Child logical response capture differs from its physical attribution");
    if (run.accounting && !attributed && !accounting.childClosed.has(input.invocationId) && usage)
      throw new Error("Accounting child response cannot introduce unattributed usage");
    if (usage && !attributed && !accounting.childClosed.has(input.invocationId)) {
      run.usage = addUsage(run.usage, usage);
      task.usage = structuredClone(run.usage);
    }
    task.revision += 1;
    run.subagent!.executionRevision += 1;
    const appended = host.appendEventsToThread(host.mutableThread(run.threadId), [
      ...capture.events.map((event) => ({ threadId: run.threadId, runId: run.id, ...event,
        category: "model" as const, visibility: "debug" as const })), {
      threadId: run.threadId, runId: run.id, type: "model.response",
      category: "model", visibility: "debug", payload,
    }]);
    const allEvents = [...events, ...appended];
    const known = new Set(allEvents.filter((event) => event.type === "model.response" &&
      record(event.payload)?.["usageStatus"] === "known").map((event) => record(event.payload)?.["childInvocationId"]));
    run.usageStatus = allEvents.some((event) => event.type === "subagent.child.invocation_reserved" &&
      !known.has(record(event.payload)?.["invocationId"])) ? "incomplete" : "complete";
    task.usageStatus = run.usageStatus;
    refreshRunAccounting(host, run.id, appended);
    await host.persistState(appended);
    return { ...childRunState(run, task), events: appended };
  });
}

function reservation(events: readonly RunEvent[], invocationId: string): JsonObject | undefined {
  return events.flatMap((event) => {
    const payload = record(event.payload);
    return event.type === "subagent.child.invocation_reserved" &&
      payload?.["invocationId"] === invocationId ? [payload] : [];
  })[0];
}
function record(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined;
}
function validateUsage(value: Usage | undefined, status: "known" | "unknown"): Usage | undefined {
  if (status === "unknown") {
    if (value !== undefined) throw new Error("Unknown physical usage must not carry known usage");
    return undefined;
  }
  if (!value || USAGE_KEYS.some((key) => typeof value[key] !== "number" ||
      !Number.isFinite(value[key]) || Number(value[key]) < 0))
    throw new Error("Child invocation usage is invalid");
  return Object.fromEntries(USAGE_KEYS.map((key) => [key, value[key]])) as Usage;
}
function addUsage(left: Usage, right: Usage): Usage {
  return Object.fromEntries(USAGE_KEYS.map((key) => [key, Number(left[key]) + Number(right[key])])) as Usage;
}
