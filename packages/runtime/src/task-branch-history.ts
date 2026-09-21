import type { RunEvent, RunRecord } from "@napier/contracts";
import { sha256 } from "./ed25519.js";

export interface TaskBranchHistorySource {
  kind: "branch_copy";
  branchRunId: string;
  branchEventId: string;
  sourceThreadId: string;
  sourceSeq: number;
}

/** A completed branch owns copied conversation, not a replayed control queue.
 * Preserve source/copy bytes and never treat inherited metadata as a new delivery. */
export function taskBranchHistorySources(input: {
  threadId: string;
  runs: readonly RunRecord[];
  events: readonly RunEvent[];
}): ReadonlyMap<string, TaskBranchHistorySource> {
  const result = new Map<string, TaskBranchHistorySource>();
  for (const run of input.runs) {
    if (
      run.threadId !== input.threadId ||
      run.branchFromSeq === undefined ||
      run.status !== "completed"
    )
      continue;
    const events = input.events
      .filter(
        (event) => event.runId === run.id && event.threadId === input.threadId,
      )
      .sort((a, b) => a.seq - b.seq);
    // Working-state-only callers may supply just a recovery subset.
    if (!events.length) continue;
    const source = branchSource(run, events);
    for (const event of events) {
      if (event.type !== "message.user") continue;
      validateCopiedUser(event);
      result.set(event.id, source);
    }
  }
  return result;
}

function branchSource(
  run: RunRecord,
  events: readonly RunEvent[],
): TaskBranchHistorySource {
  const markers = events.filter((event) => event.type === "branch.created");
  const marker = markers[0];
  const payload = marker?.payload;
  if (
    !Number.isSafeInteger(run.branchFromSeq) ||
    run.branchFromSeq! < 1 ||
    markers.length !== 1 ||
    events[0] !== marker ||
    marker?.category !== "lifecycle" ||
    marker.visibility !== "user" ||
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    Object.keys(payload).length !== 2 ||
    typeof payload.sourceThreadId !== "string" ||
    !/^[a-z][a-z0-9_]{2,80}$/u.test(payload.sourceThreadId) ||
    payload.sourceThreadId === run.threadId ||
    payload.sourceSeq !== run.branchFromSeq
  )
    throw new Error("Task branch history provenance is invalid");
  // Completed Runs may gain compaction/projection receipts. These are derived
  // metadata, not additional copied instructions or a live control lifecycle.
  const copiedEvents = events
    .slice(1)
    .filter((event) => !event.type.startsWith("context."));
  if (
    copiedEvents.length > run.branchFromSeq! ||
    copiedEvents.some(
      (event) =>
        ![
          "message.user",
          "message.assistant",
          "goal.continuation.prompt",
        ].includes(event.type),
    )
  )
    throw new Error("Task branch history contains non-copy events");
  return {
    kind: "branch_copy",
    branchRunId: run.id,
    branchEventId: marker.id,
    sourceThreadId: payload.sourceThreadId,
    sourceSeq: run.branchFromSeq!,
  };
}

function validateCopiedUser(event: RunEvent): void {
  const body = event.payload;
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    body.role !== "user" ||
    typeof body.text !== "string"
  )
    throw new Error("Task branch user history is invalid");
  if (body.controlMessageId === undefined) return;
  if (
    typeof body.controlMessageId !== "string" ||
    !/^control_[a-z0-9]{8,80}$/u.test(body.controlMessageId) ||
    !["steering", "follow_up"].includes(String(body.controlMode)) ||
    body.textSha256 !== sha256(body.text)
  )
    throw new Error("Task branch control history is invalid");
}
