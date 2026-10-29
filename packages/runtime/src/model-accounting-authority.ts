import { timingSafeEqual } from "node:crypto";
import type { RunRecord } from "@napier/contracts";
import type { ModelUsagePreparationOwner } from "./model-call-attribution.js";
import { sha256 } from "./ed25519.js";
import { assertChildRunFence } from "./subagent-child-run-fence.js";
import { durableTerminalRunStatus } from "./run-event-admission.js";
import { threadImportProvenanceLocalCutoff } from "./thread-import-provenance-validation.js";
import type { ModelAccountingHost } from "./model-accounting-host.js";

export function assertModelPreparationOwner(host: ModelAccountingHost, owner: ModelUsagePreparationOwner): void {
  if (owner.kind === "operation") return;
  const run = host.mutableRun(owner.runId);
  if (run.threadId !== owner.threadId) throw new Error("Model accounting owner Thread differs");
  assertNativeAccountingRun(host, run);
  if (owner.kind === "child") {
    const { task } = assertChildRunFence(host, owner);
    if (task.completionReservation || run.parentRunId !== owner.parentRunId)
      throw new Error("Model accounting child completion is sealed");
    const reserved = host.requireLedger().listRunEvents(run.id).find((event) => event.type === "subagent.child.invocation_reserved" &&
      record(event.payload)["invocationId"] === owner.childInvocationId);
    if (!reserved || record(reserved.payload)["invocationIndex"] !== owner.invocationIndex ||
        host.requireLedger().modelChildInvocationClosed(owner.childInvocationId))
      throw new Error("Model accounting child reservation is unavailable");
    return;
  }
  if (run.subagent || run.status !== "running" || !run.lease || Date.parse(run.lease.expiresAt) <= Date.now() ||
      durableTerminalRunStatus(host.requireLedger().listRunEvents(run.id), run.threadId, run.id))
    throw new Error("Model accounting Run execution is not active");
  const expected = Buffer.from(host.mutableRun(run.id).leaseTokenSha256 ?? "", "hex");
  const supplied = Buffer.from(sha256(owner.token), "hex");
  if (!owner.token || expected.length !== supplied.length || !timingSafeEqual(expected, supplied))
    throw new Error("Model accounting Run lease is invalid");
}

export function assertNativeAccountingRun(host: ModelAccountingHost, run: RunRecord): void {
  const thread = host.getThread(run.threadId);
  if (!thread.importProvenance) return;
  const cutoff = threadImportProvenanceLocalCutoff(thread.importProvenance);
  const events = host.requireLedger().listRunEvents(run.id);
  const nativeEvidence = events.some((event) => event.seq > cutoff &&
    (event.type === "run.started" || event.type === "model.accounting.prepared"));
  const nativeLease = !!run.lease && !!host.mutableRun(run.id).leaseTokenSha256;
  if ((!nativeEvidence && !nativeLease) || events.some((event) => event.seq <= cutoff))
    throw new Error("Imported historical Run has no native model accounting authority");
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
