import type {
  WorkspaceProcessOutput,
  WorkspaceProcessSession,
} from "@napier/contracts";

export interface WorkspaceProcessCardView {
  id: string;
  status: WorkspaceProcessSession["status"];
  statusLabel: string;
  running: boolean;
  startedAt: string;
  settledAt?: string;
  durationLabel: string;
  runtimeLabel: string;
  scopeLabel: string;
  limitLabel: string;
  outputLabel: string;
  outputAvailable: boolean;
  commandHash: string;
  resultHashes?: string;
  interruptionReason?: string;
}

export function workspaceProcessCardView(
  session: WorkspaceProcessSession,
): WorkspaceProcessCardView {
  return {
    id: session.id,
    status: session.status,
    statusLabel: statusLabel(session.status),
    running: session.status === "running",
    startedAt: session.startedAt,
    ...(session.settledAt ? { settledAt: session.settledAt } : {}),
    durationLabel:
      session.durationMs === undefined
        ? "In progress"
        : `${session.durationMs.toLocaleString()} ms`,
    runtimeLabel: `${session.runtime} · ${session.sandbox}`,
    scopeLabel: "Workspace read-only · Network denied",
    limitLabel: `${Math.round(session.timeoutMs / 1_000)}s · ${session.outputLimitChars.toLocaleString()} chars/stream`,
    outputLabel: `${session.stdoutChars.toLocaleString()} stdout · ${session.stderrChars.toLocaleString()} stderr · cursor ${session.nextCursor}`,
    outputAvailable: session.outputAvailable,
    commandHash: session.commandSha256.slice(0, 12),
    ...(session.stdoutSha256 && session.stderrSha256
      ? {
          resultHashes: `${session.stdoutSha256.slice(0, 12)} / ${session.stderrSha256.slice(0, 12)}`,
        }
      : {}),
    ...(session.interruptionReason
      ? { interruptionReason: session.interruptionReason }
      : {}),
  };
}

export function appendWorkspaceProcessOutput(
  current: WorkspaceProcessOutput["chunks"],
  incoming: WorkspaceProcessOutput,
): WorkspaceProcessOutput["chunks"] {
  const byCursor = new Map(current.map((chunk) => [chunk.cursor, chunk]));
  for (const chunk of incoming.chunks) byCursor.set(chunk.cursor, chunk);
  return [...byCursor.values()]
    .sort((left, right) => left.cursor - right.cursor)
    .slice(-256);
}

function statusLabel(status: WorkspaceProcessSession["status"]): string {
  if (status === "running") return "Running";
  if (status === "succeeded") return "Succeeded";
  if (status === "failed") return "Failed";
  if (status === "timed_out") return "Timed out";
  if (status === "output_capped") return "Output capped";
  if (status === "cancelled") return "Cancelled";
  return "Interrupted";
}
