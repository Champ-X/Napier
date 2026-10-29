import type { RunRecord, SubagentTask } from "@napier/contracts";
import { canonicalJson, sha256 } from "./ed25519.js";
import { assertSubagentCompletionReceipt } from "./subagent-completion-receipt.js";
import { resolveSubagentLogicalIdentity } from "./subagent-continuation-lineage.js";

/** Public state validation cannot grant private candidate authority on import. */
export function assertSubagentCompletionState(runs: readonly RunRecord[], tasks: readonly SubagentTask[]): void {
  const logical = new Set<string>();
  for (const task of tasks) {
    const reservation = task.completionReservation;
    if (task.completion) assertSubagentCompletionReceipt(task);
    if (!reservation) continue;
    const identity = resolveSubagentLogicalIdentity(runs, tasks, task.childRunId!);
    if (reservation.kind !== "napier.subagent-completion-reservation" || reservation.schemaVersion !== 1 ||
        !Number.isFinite(Date.parse(reservation.createdAt)) || !/^[a-f0-9]{64}$/u.test(reservation.payloadSha256) ||
        reservation.producerTaskId !== task.id || reservation.producerRunId !== task.childRunId ||
        reservation.producerExecutionId !== task.executionId ||
        Object.entries(identity).some(([key, value]) => reservation[key as keyof typeof identity] !== value) ||
        reservation.logicalCompletionKey !== sha256(canonicalJson({ logicalTaskId: identity.logicalTaskId,
          rootChildRunId: identity.rootChildRunId, rootIntentSha256: identity.rootIntentSha256 })) ||
        logical.has(reservation.logicalCompletionKey) ||
        (task.completion && task.role === "coder" && !reservation.candidate) ||
        (reservation.candidate && task.role !== "coder") ||
        (reservation.candidate && (!/^subworkpreview_[a-f0-9]{64}$/u.test(reservation.candidate.id) ||
          !/^[a-f0-9]{64}$/u.test(reservation.candidate.sourceSha256))))
      throw new Error("Subagent completion reservation state binding is invalid or duplicated");
    logical.add(reservation.logicalCompletionKey);
  }
}
