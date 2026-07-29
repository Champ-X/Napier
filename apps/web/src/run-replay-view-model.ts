import type { RunReplaySnapshot } from "@napier/contracts";

export function runReplaySnapshotFilename(
  snapshot: Pick<RunReplaySnapshot, "contentSha256" | "run">,
): string {
  const safeRunId = safeFilenameSegment(snapshot.run.id);
  return `napier-${safeRunId}-replay-${snapshot.contentSha256.slice(0, 12)}.json`;
}

function safeFilenameSegment(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9._-]/g, "_");
  return normalized.length > 0 ? normalized : "run";
}
