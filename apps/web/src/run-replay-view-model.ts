import type { RunReplaySnapshot, ThreadReplayBundle } from "@napier/contracts";

export function runReplaySnapshotFilename(
  snapshot: Pick<RunReplaySnapshot, "contentSha256" | "run">,
): string {
  const safeRunId = safeFilenameSegment(snapshot.run.id, "run");
  return `napier-${safeRunId}-replay-${snapshot.contentSha256.slice(0, 12)}.json`;
}

export function threadReplayBundleFilename(
  bundle: Pick<ThreadReplayBundle, "contentSha256" | "thread">,
): string {
  const safeThreadId = safeFilenameSegment(bundle.thread.id, "thread");
  return `napier-thread-${safeThreadId}-${bundle.contentSha256.slice(0, 12)}.json`;
}

function safeFilenameSegment(value: string, fallback: string): string {
  const normalized = value.replace(/[^A-Za-z0-9._-]/g, "_");
  return normalized.length > 0 ? normalized : fallback;
}
