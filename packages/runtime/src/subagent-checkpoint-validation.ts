import type { JsonObject, RunEvent, RunRecord, SubagentTask } from "@napier/contracts";
import type { SubagentCheckpointFrontier, SubagentWorkingSetBinding } from "./subagent-working-set-types.js";
import { canonicalJson } from "./ed25519.js";

type Reference = NonNullable<NonNullable<RunRecord["subagent"]>["checkpoint"]>;
const POINTER_KEYS = ["schemaVersion", "revision", "capsuleSha256", "capsuleBytes", "messageCount",
  "messageSetSha256", "throughSeq", "mailboxConsumedCount", "mailboxConsumedThroughSeq", "storage"];
const IDENTITY_KEYS = ["threadId", "runId", "taskId", "executionId", "parentRunId",
  "parentConfigurationSha256", "configurationSha256"] as const;

export function validateChildCheckpointReference(run: RunRecord, task: SubagentTask): void {
  const reference = run.subagent?.checkpoint;
  if (!reference) {
    if (task.mailboxConsumedCount !== undefined || task.mailboxConsumedThroughSeq !== undefined)
      throw new Error("Subagent consumed mailbox requires its checkpoint");
    return;
  }
  if (!reference || typeof reference !== "object" || Object.keys(reference).sort().join() !== [...POINTER_KEYS].sort().join() ||
      reference.schemaVersion !== 1 || !hash(reference.capsuleSha256) || !hash(reference.messageSetSha256) ||
      ![reference.revision, reference.capsuleBytes, reference.messageCount, reference.throughSeq,
        reference.mailboxConsumedCount, reference.mailboxConsumedThroughSeq].every(integer))
    throw new Error("Subagent checkpoint reference is invalid");
  if (reference.revision < 1 || reference.capsuleBytes < 1 || reference.capsuleBytes > 16 * 1024 * 1024 ||
      reference.mailboxConsumedCount > reference.messageCount ||
      !["local_only", "not_imported"].includes(reference.storage) ||
      task.mailboxConsumedCount !== reference.mailboxConsumedCount ||
      task.mailboxConsumedThroughSeq !== reference.mailboxConsumedThroughSeq)
    throw new Error("Subagent checkpoint consumption binding is invalid");
}

export function assertPreviousChildCheckpoint(frontier: SubagentCheckpointFrontier,
  reference: Reference | undefined, previous: SubagentWorkingSetBinding | undefined): void {
  if (!reference && !previous) return;
  if (!reference || !previous || reference.storage !== "local_only" ||
      reference.revision !== previous.frontier.checkpointRevision + 1 ||
      IDENTITY_KEYS.some((key) => frontier[key] !== previous.frontier[key]) ||
      ["schemaVersion", "capsuleSha256", "capsuleBytes", "messageCount", "messageSetSha256"].some((key) =>
        (reference as unknown as JsonObject)[key] !== (previous.receipt as unknown as JsonObject)[key]))
    throw new Error("Subagent checkpoint private capsule association is invalid");
}

export function validateChildCheckpointEvents(run: RunRecord, events: readonly RunEvent[]): void {
  const starts = events.filter((event) => event.type === "subagent.child.continuation_started");
  const continuation = run.subagent?.continuation;
  if (continuation ? starts.length !== 1 || canonicalJson(starts[0]!.payload) !== canonicalJson(continuation) : starts.length !== 0)
    throw new Error("Child continuation receipt differs from its durable event");
  const commits = events.filter((event) => event.type === "subagent.child.checkpoint_committed");
  const reference = run.subagent?.checkpoint;
  if (!reference && commits.length === 0) return;
  if (!reference || commits.length !== reference.revision) throw new Error("Child checkpoint event count is invalid");
  let previous = run.subagent?.continuation?.sourceCapsuleSha256 ?? "";
  for (const [index, event] of commits.entries()) {
    const payload = record(event.payload);
    if (payload["revision"] !== index + 1 || payload["previousCapsuleSha256"] !== previous ||
        payload["taskId"] !== run.subagent!.taskId || payload["executionId"] !== run.subagent!.executionId ||
        payload["configurationSha256"] !== run.configuration?.contentSha256 || !hash(payload["capsuleSha256"]) ||
        (reference.storage === "local_only" && Number(payload["throughSeq"]) >= event.seq))
      throw new Error("Child checkpoint event binding is invalid");
    previous = String(payload["capsuleSha256"]);
  }
  const latest = record(commits.at(-1)!.payload);
  if (POINTER_KEYS.filter((key) => key !== "storage").some((key) =>
      latest[key] !== (reference as unknown as JsonObject)[key]))
    throw new Error("Child checkpoint pointer differs from its durable event");
}
function record(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}
function integer(value: unknown): boolean { return Number.isSafeInteger(value) && Number(value) >= 0; }
function hash(value: unknown): boolean { return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value); }
