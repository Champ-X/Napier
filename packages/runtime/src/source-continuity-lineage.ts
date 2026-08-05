import type { RunRecord, ThreadImportProvenance } from "@napier/contracts";

export const SOURCE_CONTINUITY_RETENTION_MS = 24 * 60 * 60 * 1_000;

export interface SourceContinuityStore {
  listRuns(threadId: string): RunRecord[];
  getThread(threadId: string): { importProvenance?: ThreadImportProvenance };
}

export interface SourceContinuityPredecessorOptions {
  allowSettledCurrent?: boolean;
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
    const parent = runs.find((run) => run.id === current.parentRunId);
    if (
      !parent ||
      parent.agentId !== current.agentId ||
      parent.status !== "interrupted"
    ) {
      throw new Error("Source continuity recovery parent is invalid");
    }
    return parent;
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

function withinRetention(finishedAt: string, startedAt: string): boolean {
  const elapsed = Date.parse(startedAt) - Date.parse(finishedAt);
  return (
    Number.isFinite(elapsed) &&
    elapsed >= 0 &&
    elapsed <= SOURCE_CONTINUITY_RETENTION_MS
  );
}
