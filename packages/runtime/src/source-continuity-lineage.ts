import type { RunRecord, ThreadImportProvenance } from "@napier/contracts";
import { isManualRunRecoveryParent } from "@napier/contracts/manual-run-recovery";

export const SOURCE_CONTINUITY_RETENTION_MS = 24 * 60 * 60 * 1_000;

export interface SourceContinuityStore {
  listRuns(threadId: string): RunRecord[];
  getThread(threadId: string): { importProvenance?: ThreadImportProvenance };
}

export interface SourceContinuityPredecessorOptions {
  allowSettledCurrent?: boolean;
  explicitRunId?: string;
}

export function sourceContinuityPredecessor(
  store: SourceContinuityStore,
  owner: { threadId: string; runId: string },
  options: SourceContinuityPredecessorOptions = {},
): RunRecord | undefined {
  const runs = store.listRuns(owner.threadId);
  const currentIndex = runs.findIndex((run) => run.id === owner.runId);
  const current = runs[currentIndex];
  if (
    !current ||
    (current.status !== "running" &&
      (!options.allowSettledCurrent || current.status === "queued"))
  ) {
    return undefined;
  }
  if (current.source === "recovery") {
    if (options.explicitRunId) {
      throw new Error("Recovery Runs cannot pin Source continuity");
    }
    const parent = runs.find((run) => run.id === current.parentRunId);
    if (
      !parent ||
      parent.agentId !== current.agentId ||
      !isManualRunRecoveryParent(parent)
    ) {
      throw new Error("Source continuity recovery parent is invalid");
    }
    return parent;
  }
  if (options.explicitRunId) {
    return explicitPredecessor(
      store,
      runs,
      current,
      currentIndex,
      options.explicitRunId,
    );
  }
  if (
    (current.source ?? "user") !== "user" ||
    current.parentRunId ||
    store.getThread(owner.threadId).importProvenance
  ) {
    return undefined;
  }
  const predecessor = runs[currentIndex - 1];
  if (
    !predecessor ||
    predecessor.agentId !== current.agentId ||
    predecessor.status !== "completed" ||
    (predecessor.source !== undefined &&
      predecessor.source !== "user" &&
      predecessor.source !== "recovery") ||
    !predecessor.finishedAt ||
    !withinRetention(predecessor.finishedAt, current.startedAt)
  ) {
    return undefined;
  }
  return predecessor;
}

function explicitPredecessor(
  store: SourceContinuityStore,
  runs: RunRecord[],
  current: RunRecord,
  currentIndex: number,
  explicitRunId: string,
): RunRecord {
  if (
    (current.source ?? "user") !== "user" ||
    current.parentRunId ||
    store.getThread(current.threadId).importProvenance
  ) {
    throw new Error("Pinned Source continuity Run is not allowed");
  }
  const pinned = runs.find((candidate) => candidate.id === explicitRunId);
  if (!validExplicitPredecessor(pinned, current, runs, currentIndex)) {
    throw new Error("Pinned Source continuity Run is invalid");
  }
  return pinned;
}

function validExplicitPredecessor(
  pinned: RunRecord | undefined,
  current: RunRecord,
  runs: RunRecord[],
  currentIndex: number,
): pinned is RunRecord {
  return Boolean(
    pinned &&
    pinned.id !== current.id &&
    pinned.threadId === current.threadId &&
    pinned.agentId === current.agentId &&
    pinned.status === "completed" &&
    (pinned.source === undefined ||
      pinned.source === "user" ||
      pinned.source === "recovery") &&
    pinned.finishedAt &&
    withinRetention(pinned.finishedAt, current.startedAt) &&
    runs.indexOf(pinned) < currentIndex,
  );
}

function withinRetention(finishedAt: string, startedAt: string): boolean {
  const elapsed = Date.parse(startedAt) - Date.parse(finishedAt);
  return (
    Number.isFinite(elapsed) &&
    elapsed >= 0 &&
    elapsed <= SOURCE_CONTINUITY_RETENTION_MS
  );
}
