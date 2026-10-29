import type { SubagentCompletionReceipt, SubagentCompletionReservation, SubagentTask } from "@napier/contracts";
import { canonicalJson, sha256 } from "./ed25519.js";
import type { FinishSubagentTaskInput } from "./subagent-completion-types.js";

export function subagentCompletionPayloadSha256(task: SubagentTask, input: FinishSubagentTaskInput): string {
  return sha256(canonicalJson({ status: input.status, stopReason: input.stopReason,
    result: input.result ?? null, outcome: input.outcome ?? null,
    output: input.output === undefined ? { absent: true } : { value: input.output },
    outputSchemaSha256: task.outputSchemaSha256 ?? null,
    error: input.error ?? null, usage: input.usage ?? task.usage }));
}
export function completionReservationIdentity(reservation: SubagentCompletionReservation): string {
  const { candidate: _candidate, ...identity } = reservation;
  return canonicalJson(identity);
}
export function createSubagentCompletionReceipt(reservation: SubagentCompletionReservation, committedAt: string): SubagentCompletionReceipt {
  const content = { kind: "napier.subagent-completion" as const, schemaVersion: 1 as const,
    reservation: structuredClone(reservation), committedAt };
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}
export function assertSubagentCompletionReceipt(task: SubagentTask): SubagentCompletionReceipt {
  const receipt = task.completion;
  if (!receipt) throw new Error("Subagent durable completion is unavailable");
  const { contentSha256, ...content } = receipt;
  const reservation = receipt.reservation;
  if (receipt.kind !== "napier.subagent-completion" || receipt.schemaVersion !== 1 ||
      task.status !== "completed" || task.finishedAt !== receipt.committedAt ||
      sha256(canonicalJson(content)) !== contentSha256 ||
      canonicalJson(task.completionReservation) !== canonicalJson(reservation) ||
      reservation.producerTaskId !== task.id || reservation.producerRunId !== task.childRunId ||
      reservation.producerExecutionId !== task.executionId ||
      reservation.logicalCompletionKey !== sha256(canonicalJson({ logicalTaskId: reservation.logicalTaskId,
        rootChildRunId: reservation.rootChildRunId, rootIntentSha256: reservation.rootIntentSha256 })) ||
      reservation.payloadSha256 !== subagentCompletionPayloadSha256(task, {
        status: "completed", stopReason: task.stopReason!, ...(task.result !== undefined ? { result: task.result } : {}),
        ...(task.outcome !== undefined ? { outcome: task.outcome } : {}),
        ...(task.output !== undefined ? { output: task.output } : {}),
        ...(task.error !== undefined ? { error: task.error } : {}), usage: task.usage,
      })) throw new Error("Subagent durable completion binding changed");
  return structuredClone(receipt);
}
