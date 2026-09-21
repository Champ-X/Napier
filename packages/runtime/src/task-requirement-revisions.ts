import type { RunEvent } from "@napier/contracts";
import { sha256 } from "./ed25519.js";
import { projectRunControlEpochs } from "./run-progress-control-epoch-codec.js";
import type { TaskBranchHistorySource } from "./task-branch-history.js";

const INPUT_TYPES = new Set([
  "message.user",
  "workflow.node.prompt",
  "goal.continuation.prompt",
  "run.recovery.prompt",
]);

export interface TaskRequirementRevision {
  eventId: string;
  seq: number;
  sourceRunId: string;
  kind: "user_instruction" | "workflow_input" | "runtime_continuation";
  instructionRevision: number;
  previousInstructionEventId?: string;
  controlMode?: "steering" | "follow_up";
  branchHistory?: TaskBranchHistorySource;
  text: string;
  textSha256: string;
  truncated: boolean;
}

/** Preserve provenance and chronology; do not infer that an entire earlier
 * request was replaced. Runtime continuation hints do not revise user scope. */
export function projectTaskRequirementRevisions(
  events: readonly RunEvent[],
  branchHistory?: ReadonlyMap<string, TaskBranchHistorySource>,
) {
  const controlMessages = new Map<string, { boundarySeq: number }>();
  for (const [runId, runEvents] of eventsByRun(events))
    for (const epoch of projectRunControlEpochs(runEvents)) {
      controlMessages.set(`${runId}:${epoch.controlMessageId}`, epoch);
    }
  const sources = new Set<string>();
  const all: TaskRequirementRevision[] = [];
  let revision = 0;
  let previousInstructionEventId: string | undefined;
  let latestInstructionSeq = 0;
  for (const event of events) {
    if (event.type.startsWith("run.control.")) sources.add(event.id);
    if (!INPUT_TYPES.has(event.type) || !event.runId) continue;
    const payload = event.payload;
    if (
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      typeof payload.text !== "string"
    )
      continue;
    const control = payload.controlMessageId;
    const inherited = branchHistory?.get(event.id);
    if (
      !inherited &&
      control !== undefined &&
      (typeof control !== "string" ||
        controlMessages.get(`${event.runId}:${control}`)?.boundarySeq !==
          event.seq)
    ) {
      throw new Error("Task requirement control delivery is not validated");
    }
    const kind =
      event.type === "message.user"
        ? ("user_instruction" as const)
        : event.type === "workflow.node.prompt"
          ? ("workflow_input" as const)
          : ("runtime_continuation" as const);
    if (kind === "user_instruction") {
      revision++;
      latestInstructionSeq = event.seq;
    }
    const entry: TaskRequirementRevision = {
      eventId: event.id,
      seq: event.seq,
      sourceRunId: event.runId,
      kind,
      instructionRevision: revision,
      ...(inherited ? { branchHistory: inherited } : {}),
      ...(previousInstructionEventId ? { previousInstructionEventId } : {}),
      ...liveControlMetadata(payload.controlMode, inherited),
      text: payload.text.slice(0, 4000),
      textSha256: sha256(payload.text),
      truncated: payload.text.length > 4000,
    };
    all.push(entry);
    sources.add(event.id);
    if (inherited) sources.add(inherited.branchEventId);
    if (kind === "user_instruction") previousInstructionEventId = event.id;
  }
  const requirements = retainRequirements(all);
  return {
    requirements,
    sourceEventIds: sources,
    totalCount: all.length,
    omittedCount: all.length - requirements.length,
    instructionRevision: revision,
    latestInstructionEventId: previousInstructionEventId,
    latestInstructionSeq,
    truncated: all.length > 8 || all.some((entry) => entry.truncated),
  };
}

function eventsByRun(events: readonly RunEvent[]): Map<string, RunEvent[]> {
  const grouped = new Map<string, RunEvent[]>();
  // Preserve first-seen Run order and each Run's original ledger order. Do
  // not rescan the entire thread for every Run or combine control lifecycles.
  for (const event of events) {
    if (!event.runId) continue;
    const group = grouped.get(event.runId);
    if (group) group.push(event);
    else grouped.set(event.runId, [event]);
  }
  return grouped;
}

function liveControlMetadata(
  mode: unknown,
  inherited: TaskBranchHistorySource | undefined,
): Pick<TaskRequirementRevision, "controlMode"> {
  if (inherited) return {};
  return mode === "steering" || mode === "follow_up"
    ? { controlMode: mode }
    : {};
}

function retainRequirements(all: readonly TaskRequirementRevision[]) {
  // Keep the original user constraints even after many compactions/continuations.
  const anchor =
    all.find((entry) => entry.kind === "user_instruction") ?? all[0];
  // Continuation volume must not displace the latest actual user amendments.
  // Retain the original plus recent user instructions before lower-priority hints.
  const retained = anchor ? [anchor] : [];
  for (const kind of [
    "user_instruction",
    "workflow_input",
    "runtime_continuation",
  ] as const)
    for (const entry of all.toReversed())
      if (retained.length < 8 && entry !== anchor && entry.kind === kind)
        retained.push(entry);
  return retained.sort((a, b) => a.seq - b.seq);
}
