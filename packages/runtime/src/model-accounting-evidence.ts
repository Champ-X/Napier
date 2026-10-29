import { emptyUsage, type JsonObject, type RunEvent, type SubagentTask } from "@napier/contracts";
import type { ModelCallAttributionV1, ModelPhysicalObservationV1 } from "@napier/contracts/model-accounting";
import { validateModelCallAttribution, validateModelPhysicalObservation } from "./model-usage-observation.js";
export const MODEL_ACCOUNTING_EVENT_TYPES = Object.freeze([
  "model.accounting.prepared", "model.accounting.dispatch_intent",
  "model.usage.reconciled", "model.accounting.child_undispatched",
] as const);
export const LEGACY_AUXILIARY_USAGE_TYPES = Object.freeze([
  "context.compaction.completed", "context.compaction.failed", "goal.evaluated",
  "memory.extraction.completed", "memory.extraction.failed", "model.thinking_loop.detected",
  "model.context.overflow", "model.advisor.independent.reviewed",
]);
export const USAGE_TYPES = new Set(["model.response", "message.assistant", ...LEGACY_AUXILIARY_USAGE_TYPES]);

export interface ModelAccountingEvidence {
  attributions: Map<string, ModelCallAttributionV1>;
  observations: Map<string, ModelPhysicalObservationV1>;
  childClosed: Set<string>;
}

export function hasModelAccounting(events: readonly RunEvent[], tasks: readonly SubagentTask[] = []): boolean {
  return tasks.some((task) => !!task.accounting) || events.some((event) =>
    MODEL_ACCOUNTING_EVENT_TYPES.some((type) => type === event.type));
}

/** Public evidence is sufficient for replay, but never supplies native write authority. */
export function readModelAccountingEvidence(events: readonly RunEvent[]): ModelAccountingEvidence {
  const evidence: ModelAccountingEvidence = { attributions: new Map(), observations: new Map(), childClosed: new Set() };
  const entered = new Set<string>();
  for (const event of events) {
    if (event.type === "model.accounting.prepared") prepareEvidence(evidence, events, event);
    else if (event.type === "model.accounting.dispatch_intent" || event.type === "model.usage.reconciled")
      physicalEvidence(evidence, entered, event);
    else if (event.type === "model.accounting.child_undispatched") closeChildEvidence(evidence, events, event);
  }
  for (const event of events) logicalEvidence(evidence, events, event);
  return evidence;
}

function prepareEvidence(evidence: ModelAccountingEvidence, events: readonly RunEvent[], event: RunEvent): void {
  const attribution = validateModelCallAttribution(object(event.payload)["attribution"]);
  if (attribution.owner.kind === "operation" || attribution.owner.runId !== event.runId ||
      attribution.owner.threadId !== event.threadId || evidence.attributions.has(attribution.physicalId))
    fail("prepared invocation owner or identity differs");
  if (attribution.owner.kind === "child") {
    const id = attribution.owner.childInvocationId;
    if (evidence.childClosed.has(id)) fail("prepared child follows undispatched closure");
    const reserved = childReservation(events, event, id);
    if (reserved["taskId"] !== attribution.owner.taskId || reserved["executionId"] !== attribution.owner.executionId ||
        reserved["invocationIndex"] !== attribution.owner.invocationIndex || reserved["phase"] !== attribution.phase ||
        attribution.capture.envelope.turnIndex !== attribution.owner.invocationIndex - 1) fail("child attribution reservation differs");
    if ([...evidence.attributions.values()].some((value) => value.owner.kind === "child" && value.owner.childInvocationId === id))
      fail("child reservation has multiple physical invocations");
  }
  evidence.attributions.set(attribution.physicalId, attribution);
}
function physicalEvidence(evidence: ModelAccountingEvidence, entered: Set<string>, event: RunEvent): void {
  const payload = object(event.payload), id = String(payload["physicalId"]);
  const attribution = evidence.attributions.get(id);
  if (!attribution || attribution.contentSha256 !== payload["attributionSha256"] ||
      attribution.owner.kind === "operation" || attribution.owner.runId !== event.runId ||
      payload["accountingMode"] !== "physical_receipt_v1") fail("physical evidence has no matching attribution");
  if (event.type === "model.accounting.dispatch_intent") {
    if (entered.has(id) || evidence.observations.has(id)) fail("dispatch intent repeats or follows final observation");
    entered.add(id);
  } else {
    const observation = validateModelPhysicalObservation(payload["observation"], attribution);
    if (evidence.observations.has(id) || observation.physicalId !== id ||
        (observation.terminal !== "undispatched" && !entered.has(id))) fail("final observation identity or dispatch differs");
    evidence.observations.set(id, observation);
  }
}
function closeChildEvidence(evidence: ModelAccountingEvidence, events: readonly RunEvent[], event: RunEvent): void {
  const payload = object(event.payload), id = payload["childInvocationId"];
  if (typeof id !== "string" || evidence.childClosed.has(id) || [...evidence.attributions.values()].some((value) =>
    value.owner.kind === "child" && value.owner.childInvocationId === id)) fail("undispatched child disposition differs");
  const reserved = childReservation(events, event, id);
  if (reserved["taskId"] !== payload["taskId"] || reserved["executionId"] !== payload["executionId"])
    fail("undispatched child reservation owner differs");
  evidence.childClosed.add(id);
}
function logicalEvidence(evidence: ModelAccountingEvidence, events: readonly RunEvent[], event: RunEvent): void {
  const payload = object(event.payload);
  if (!USAGE_TYPES.has(event.type)) return;
  if (evidence.childClosed.has(String(payload["childInvocationId"])) && payload["usage"] !== undefined &&
      Object.values(object(payload["usage"])).some((value) => value !== 0)) fail("undispatched child claims positive usage");
  if (!hasPhysicalReference(payload)) return;
  const attribution = evidence.attributions.get(String(payload["physicalId"]));
  if (!attribution || payload["attributionSha256"] !== attribution.contentSha256 ||
      payload["accountingMode"] !== "physical_receipt_v1" || attribution.owner.kind === "operation" ||
      attribution.owner.runId !== event.runId) fail("logical usage reference differs");
  if (!events.some((candidate) => candidate.seq < event.seq && candidate.type === "model.accounting.prepared" &&
      object(object(candidate.payload)["attribution"])["physicalId"] === attribution.physicalId))
    fail("logical usage precedes physical attribution");
  if (attribution.owner.kind === "child" && event.type === "model.response" &&
      payload["childInvocationId"] !== attribution.owner.childInvocationId) fail("logical child reservation differs");
  if (payload["modelContextEnvelopeSha256"] !== undefined &&
      payload["modelContextEnvelopeSha256"] !== attribution.capture.envelope.contentSha256)
    fail("logical capture envelope differs");
}

function childReservation(events: readonly RunEvent[], event: RunEvent, id: string): JsonObject {
  const reservation = events.find((candidate) => candidate.seq < event.seq && candidate.runId === event.runId &&
    candidate.type === "subagent.child.invocation_reserved" && object(candidate.payload)["invocationId"] === id);
  if (!reservation) fail("child evidence lacks preceding logical reservation");
  return object(reservation.payload);
}
export function isUndispatchedModelDiagnostic(payload: JsonObject): boolean {
  if (payload["modelCallDisposition"] === undefined) return false;
  const usage = object(payload["usage"]);
  if (payload["modelCallDisposition"] !== "not_dispatched" || hasPhysicalReference(payload) ||
      Object.keys(usage).length !== Object.keys(emptyUsage()).length || Object.values(usage).some((value) => value !== 0))
    fail("undispatched diagnostic must carry exact empty usage and no physical reference");
  return true;
}


export function hasPhysicalReference(payload: JsonObject): boolean {
  return payload["physicalId"] !== undefined || payload["attributionSha256"] !== undefined || payload["accountingMode"] !== undefined;
}
export function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}
function fail(reason: string): never { throw new Error(`Model accounting evidence ${reason}`); }
