import type { RunRecord, ThreadRecord, ThreadSummary } from "@napier/contracts";
import { createId, nowIso } from "./ids.js";

export function sortedThreads(
  threads: readonly ThreadRecord[],
): ThreadSummary[] {
  return [...threads].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}

export function findThread(
  threads: readonly ThreadRecord[],
  threadId: string,
): ThreadRecord {
  const thread = threads.find((item) => item.id === threadId);
  if (!thread) throw new Error(`Thread not found: ${threadId}`);
  return thread;
}

export function threadRuns(
  runs: readonly RunRecord[],
  threadId: string,
): RunRecord[] {
  return runs.filter((run) => run.threadId === threadId);
}

export function createThreadRecord(input: {
  title: string;
  agentId: string;
  importProvenance?: ThreadRecord["importProvenance"];
}): ThreadRecord {
  const timestamp = nowIso();
  return {
    id: createId("thread"),
    title: input.title,
    agentId: input.agentId,
    status: "idle",
    createdAt: timestamp,
    updatedAt: timestamp,
    lastMessage: "",
    eventCount: 0,
    runIds: [],
    ...(input.importProvenance
      ? { importProvenance: structuredClone(input.importProvenance) }
      : {}),
  };
}
