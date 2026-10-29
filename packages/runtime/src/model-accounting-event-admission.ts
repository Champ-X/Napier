import type { RunEvent, RunRecord } from "@napier/contracts";
import { USAGE_TYPES, hasPhysicalReference, isUndispatchedModelDiagnostic, object, readModelAccountingEvidence } from "./model-accounting-evidence.js";
import type { LedgerModelAccountingPort } from "./sqlite-model-accounting.js";

/** Runs inside Store's optimistic mutation queue; commit CAS fences concurrent activation. */
export function assertModelAccountingEventAppend(ledger: LedgerModelAccountingPort, added: readonly RunEvent[]): void {
  const runIds = new Set(added.filter((event) => USAGE_TYPES.has(event.type)).map((event) => event.runId));
  for (const runId of runIds) {
    const view = ledger.readRunAccountingView(runId);
    const run = (view.snapshot ? JSON.parse(view.snapshot.stateJson).runs as RunRecord[] : []).find((value) => value.id === runId);
    const events = added.filter((event) => event.runId === runId);
    const evidence = readModelAccountingEvidence([...view.events, ...events]);
    for (const event of events) {
      const payload = object(event.payload);
      if (!USAGE_TYPES.has(event.type) || isUndispatchedModelDiagnostic(payload) || hasPhysicalReference(payload) ||
          evidence.childClosed.has(String(payload["childInvocationId"]))) continue;
      if (run?.accounting && payload["usage"] !== undefined)
        throw new Error("Accounting Run usage requires a physical attribution reference");
    }
  }
}
