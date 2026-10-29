import { emptyUsage, type JsonObject, type RunEvent, type RunRecord, type Usage } from "@napier/contracts";
import { canonicalJson } from "./ed25519.js";
import { bindChildInvocationCapture } from "./subagent-child-invocation-capture.js";
import { validateModelContextEnvelopeReceipt } from "./model-context-envelope.js";
import { foldModelAccounting, hasModelAccounting } from "./model-accounting-fold.js";

const PHASES = new Set(["subagent_turn", "typed_repair", "outcome_repair", "context_compaction"]);
const USAGE_KEYS = Object.keys(emptyUsage()) as Array<keyof Usage>;
interface Reservation { event: RunEvent; payload: JsonObject }

/** Child request indexes are durable reservations: a failed capture leaves a real gap. */
export function assertChildModelEvidence(run: RunRecord, events: readonly RunEvent[]): void {
  const reservations = collectReservations(run, events);
  const settled = new Set<string>();
  const total = emptyUsage();
  let knownCount = 0;
  for (const [index, event] of events.entries()) {
    if (event.type === "context.model_invocation") invalid("cannot claim main invocation evidence");
    if (event.type === "context.model_adapter" && events[index - 1]?.type !== "context.model_envelope")
      invalid("adapter has no adjacent envelope");
    if (event.type === "context.model_envelope") assertCaptureSequence(events, index);
    if (event.type !== "model.response") continue;
    const payload = record(event.payload);
    const id = String(payload["childInvocationId"]);
    const reserved = reservations.get(id);
    if (!reserved || settled.has(id) || event.seq <= reserved.event.seq ||
        payload["invocationIndex"] !== reserved.payload["invocationIndex"] ||
        payload["subagentPhase"] !== reserved.payload["phase"] ||
        payload["subagentTaskId"] !== run.subagent!.taskId ||
        payload["subagentExecutionId"] !== run.subagent!.executionId)
      invalid("response reservation binding is invalid");
    settled.add(id);
    assertResponseCapture(events, index, payload, Number(reserved.payload["invocationIndex"]), reserved.event.seq);
    if (addResponseUsage(total, payload)) knownCount += 1;
  }
  const accounting = hasModelAccounting(events) ? foldModelAccounting(events, [], run.accounting) : undefined;
  const status = accounting?.summary.usageStatus ?? (knownCount === reservations.size ? "complete" : "incomplete");
  if (run.usageStatus !== status || canonicalJson(run.usage) !== canonicalJson(accounting?.usage ?? total) ||
    (accounting && canonicalJson(run.accounting) !== canonicalJson(accounting.summary)))
    invalid("usage does not match reserved invocation receipts");
}

function collectReservations(run: RunRecord, events: readonly RunEvent[]): Map<string, Reservation> {
  const reservations = new Map<string, Reservation>();
  const requests = new Set<string>();
  for (const event of events) {
    if (event.type !== "subagent.child.invocation_reserved") continue;
    const payload = record(event.payload);
    const id = payload["invocationId"];
    const request = payload["requestId"];
    if (typeof id !== "string" || !/^childinv_[a-f0-9]{64}$/u.test(id) || reservations.has(id) ||
        typeof request !== "string" || !/^[a-zA-Z0-9_.:-]{1,160}$/u.test(request) || requests.has(request) ||
        payload["invocationIndex"] !== reservations.size + 1 || !PHASES.has(String(payload["phase"])) ||
        payload["taskId"] !== run.subagent!.taskId || payload["executionId"] !== run.subagent!.executionId)
      invalid("reservation identity or sequence is invalid");
    reservations.set(id, { event, payload });
    requests.add(request);
  }
  if (reservations.size !== run.subagent!.nextInvocationIndex)
    invalid("reservation count conflicts with child counter");
  return reservations;
}

function assertCaptureSequence(events: readonly RunEvent[], index: number): void {
  const next = events[index + 1];
  const terminal = next?.type === "context.model_adapter" ? events[index + 2] : next;
  if (terminal?.type !== "model.response") invalid("capture has no adjacent response");
}

function assertResponseCapture(events: readonly RunEvent[], index: number,
  payload: JsonObject, invocationIndex: number, reservationSeq: number): void {
  const previous = events[index - 1];
  const adapter = previous?.type === "context.model_adapter" ? record(previous.payload) : undefined;
  const candidate = adapter ? events[index - 2] : previous;
  const envelope = candidate?.type === "context.model_envelope"
    ? validateModelContextEnvelopeReceipt(candidate.payload) : undefined;
  if (envelope && candidate!.seq <= reservationSeq) invalid("capture predates reservation");
  const binding = bindChildInvocationCapture({ payload,
    ...(envelope ? { capture: { envelope, ...(adapter ? { adapter } : {}) } } : {}) }, invocationIndex);
  if (canonicalJson(binding.payload) !== canonicalJson(payload)) invalid("capture hash binding is invalid");
}

function addResponseUsage(total: Usage, payload: JsonObject): boolean {
  if (payload["usageStatus"] === "unknown") {
    if (payload["usage"] !== undefined) invalid("unknown response carries known usage");
    return false;
  }
  if (payload["usageStatus"] !== "known") invalid("response usage status is invalid");
  const usage = record(payload["usage"]);
  for (const key of USAGE_KEYS) {
    const value = usage[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) invalid("response usage is invalid");
    total[key] = Number(total[key]) + value;
  }
  return true;
}
function record(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("payload is invalid");
  return value as JsonObject;
}
function invalid(message: string): never { throw new Error(`Thread replay bundle child model evidence ${message}`); }
