import type { RunEvent, RunRecord, SubagentTask } from "@napier/contracts";
import type {
  HarnessLedgerEventEvidence,
  HarnessLedgerRunEvidence,
  HarnessSubagentRestartSnapshot,
} from "@napier/contracts/agent-harness-acceptance";

import { canonicalJson, sha256 } from "./ed25519.js";

const TERMINAL = new Set([
  "completed",
  "failed",
  "cancelled",
  "timed_out",
  "orphaned",
]);

export function createHarnessLedgerRunEvidence(
  run: Pick<RunRecord, "id" | "threadId" | "status">,
  events: readonly RunEvent[],
): HarnessLedgerRunEvidence {
  if (run.status === "queued" || run.status === "interrupted") {
    throw new Error("Agent Harness acceptance Run status is invalid");
  }
  const selected = events
    .filter(
      (event) => event.runId === run.id && event.threadId === run.threadId,
    )
    .sort((left, right) => left.seq - right.seq)
    .map(createLedgerEventEvidence);
  const content = {
    threadId: run.threadId,
    runId: run.id,
    status: run.status,
    events: selected,
    eventStreamSha256: sha256(
      selected.map((event) => event.eventSha256).join("\n"),
    ),
  };
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}

export function createSubagentRestartSnapshot(
  task: SubagentTask,
): HarnessSubagentRestartSnapshot {
  if (
    !TERMINAL.has(task.status) ||
    !task.supervisorStatus ||
    !task.stopReason ||
    !task.finishedAt
  ) {
    throw new Error("Subagent restart snapshot is not terminal");
  }
  const content = {
    taskId: task.id,
    status: task.status as HarnessSubagentRestartSnapshot["status"],
    supervisorStatus: task.supervisorStatus,
    stopReason: task.stopReason,
    revision: task.revision,
    finishedAt: task.finishedAt,
  };
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}

function createLedgerEventEvidence(
  event: RunEvent,
): HarnessLedgerEventEvidence {
  const content = {
    id: event.id,
    threadId: event.threadId,
    runId: event.runId,
    seq: event.seq,
    type: event.type,
    category: event.category,
    visibility: event.visibility,
    createdAt: event.createdAt,
    payload: structuredClone(event.payload),
    payloadSha256: sha256(canonicalJson(event.payload)),
  };
  return { ...content, eventSha256: sha256(canonicalJson(content)) };
}
