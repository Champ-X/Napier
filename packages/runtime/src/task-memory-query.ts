import type { RunEvent } from "@napier/contracts";
import { sha256 } from "./ed25519.js";
import { projectTaskRequirementRevisions } from "./task-requirement-revisions.js";
import type { TaskBranchHistorySource } from "./task-branch-history.js";

/** A retrieval query is derived context, not instruction authority. Transcript
 * role=user also carries runtime hints and cannot establish user provenance. */
export function taskMemoryQueryFromEvents(input: {
  events: readonly RunEvent[];
  threadId: string;
  sourceRunIds: readonly string[];
  branchHistory?: ReadonlyMap<string, TaskBranchHistorySource>;
}) {
  const runs = new Set(input.sourceRunIds);
  const events = input.events
    .filter(
      (event) =>
        event.threadId === input.threadId &&
        event.runId &&
        runs.has(event.runId),
    )
    .sort((a, b) => a.seq - b.seq);
  // Reuse control-delivery validation and retention of the original request
  // plus recent actual amendments across thread turns, compaction and recovery.
  const state = projectTaskRequirementRevisions(events, input.branchHistory);
  const requirements = state.requirements
    .filter((entry) => entry.kind !== "runtime_continuation")
    .sort((a, b) => b.seq - a.seq);
  const text = requirements.map((entry) => entry.text).join("\n");
  return {
    text,
    receipt: {
      kind: "task-requirement-events-v1",
      sourceEventIds: requirements.map((entry) => entry.eventId),
      sourceRunIds: [
        ...new Set(requirements.map((entry) => entry.sourceRunId)),
      ],
      instructionRevision: state.instructionRevision,
      branchCopies: requirements.flatMap((entry) =>
        entry.branchHistory
          ? [{ eventId: entry.eventId, ...entry.branchHistory }]
          : [],
      ),
      textSha256: sha256(text),
      truncated: state.truncated,
    },
  };
}
