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
  failureRecovery?: "restore_scopes";
  compensationStatus?: WorkspaceProcessSession["workspaceCompensationStatus"];
  limitLabel: string;
  outputLabel: string;
  outputAvailable: boolean;
  stdinState: "unavailable" | "closed" | "open";
  stdinCanClose: boolean;
  stdinLabel: string;
  stdinHash?: string;
  workspaceDeltaState:
    | "pending"
    | "unchanged"
    | "changed"
    | "indeterminate"
    | "unavailable";
  workspaceDeltaLabel: string;
  workspaceDeltaAvailable: boolean;
  workspaceDeltaHashes?: string;
  commandHash: string;
  resultHashes?: string;
  interruptionReason?: string;
}

export function workspaceProcessCardView(
  session: WorkspaceProcessSession,
): WorkspaceProcessCardView {
  const terminalLabel =
    session.ioMode === "pty"
      ? ` · PTY ${session.terminalColumns}×${session.terminalRows} · ${session.terminalResizeCount ?? 0} resize${session.terminalResizeCount === 1 ? "" : "s"}`
      : "";
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
    runtimeLabel: `${session.runtime} · ${session.sandbox}${terminalLabel}`,
    scopeLabel:
      session.sandbox === "host-direct"
        ? "Host direct · no workspace, network, or resource isolation"
        : session.workspaceAccess === "scoped_write"
          ? `Workspace scoped write · ${session.writeScopeCount ?? 0} scope${session.writeScopeCount === 1 ? "" : "s"} · ${session.writeScopeSetSha256?.slice(0, 12) ?? "unavailable"} · Network denied`
          : "Workspace read-only · Network denied",
    ...(session.failureRecovery
      ? {
          failureRecovery: session.failureRecovery,
          ...(session.workspaceCompensationStatus
            ? { compensationStatus: session.workspaceCompensationStatus }
            : {}),
        }
      : {}),
    limitLabel: `${Math.round(session.timeoutMs / 1_000)}s · ${session.outputLimitChars.toLocaleString()} chars/stream`,
    outputLabel:
      session.ioMode === "pty"
        ? `${session.stdoutChars.toLocaleString()} merged terminal chars · cursor ${session.nextCursor}`
        : `${session.stdoutChars.toLocaleString()} stdout · ${session.stderrChars.toLocaleString()} stderr · cursor ${session.nextCursor}`,
    outputAvailable: session.outputAvailable,
    ...stdinView(session),
    ...workspaceDeltaView(session),
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

export function workspaceProcessRequestIsCurrent(
  token: { threadId: string; sequence: number },
  activeThreadId: string,
  activeSequence: number,
): boolean {
  return token.threadId === activeThreadId && token.sequence === activeSequence;
}

export function workspaceProcessSelectionRequestIsCurrent(
  token: { threadId: string; processId: string; sequence: number },
  activeThreadId: string,
  activeProcessId: string | undefined,
  activeSequence: number,
): boolean {
  return (
    workspaceProcessRequestIsCurrent(token, activeThreadId, activeSequence) &&
    token.processId === activeProcessId
  );
}

function stdinView(
  session: WorkspaceProcessSession,
): Pick<
  WorkspaceProcessCardView,
  "stdinState" | "stdinCanClose" | "stdinLabel" | "stdinHash"
> {
  if (session.stdinMode === undefined) {
    return {
      stdinState: "unavailable",
      stdinCanClose: false,
      stdinLabel: "Input metadata unavailable for this session version",
    };
  }
  return {
    stdinState: session.stdinOpen ? "open" : "closed",
    stdinCanClose: session.ioMode !== "pty" && session.stdinOpen === true,
    stdinLabel:
      session.stdinMode === "interactive"
        ? `${session.stdinWriteCount ?? 0} writes · ${(session.stdinBytes ?? 0).toLocaleString()} bytes · ${session.stdinOpen ? "open" : "closed"}`
        : "Closed at launch",
    ...(session.stdinSha256
      ? { stdinHash: session.stdinSha256.slice(0, 12) }
      : {}),
  };
}

function workspaceDeltaView(
  session: WorkspaceProcessSession,
): Pick<
  WorkspaceProcessCardView,
  | "workspaceDeltaState"
  | "workspaceDeltaLabel"
  | "workspaceDeltaAvailable"
  | "workspaceDeltaHashes"
> {
  const workspaceDeltaHashes =
    session.workspaceBeforeSha256 && session.workspaceAfterSha256
      ? [
          session.workspaceBeforeSha256.slice(0, 12),
          session.workspaceAfterSha256.slice(0, 12),
          session.workspaceChangedPathSetSha256?.slice(0, 12),
        ]
          .filter(Boolean)
          .join(" / ")
      : undefined;
  if (session.status === "running") {
    return {
      workspaceDeltaState: "pending",
      workspaceDeltaLabel:
        session.workspaceAccess === "scoped_write"
          ? "Scoped write comparison pending settlement"
          : "Comparison pending settlement",
      workspaceDeltaAvailable: false,
      ...(workspaceDeltaHashes ? { workspaceDeltaHashes } : {}),
    };
  }
  if (session.workspaceDeltaStatus === "unchanged") {
    return {
      workspaceDeltaState: "unchanged",
      workspaceDeltaLabel:
        session.workspaceAccess === "scoped_write"
          ? "No workspace changes observed"
          : "No workspace drift observed",
      workspaceDeltaAvailable: Boolean(session.workspaceDeltaAvailable),
      ...(workspaceDeltaHashes ? { workspaceDeltaHashes } : {}),
    };
  }
  if (session.workspaceDeltaStatus === "changed") {
    const count = session.workspaceChangedFileCount ?? 0;
    return {
      workspaceDeltaState: "changed",
      workspaceDeltaLabel:
        session.workspaceAccess === "scoped_write"
          ? session.workspaceWriteScopeStatus === "within_scope"
            ? `${count.toLocaleString()} path${count === 1 ? "" : "s"} changed within approved scope`
            : `${count.toLocaleString()} observed path change${count === 1 ? "" : "s"} include unverified scope`
          : `${count.toLocaleString()} file${count === 1 ? "" : "s"} drifted during window`,
      workspaceDeltaAvailable: Boolean(session.workspaceDeltaAvailable),
      ...(workspaceDeltaHashes ? { workspaceDeltaHashes } : {}),
    };
  }
  if (session.workspaceDeltaStatus === "indeterminate") {
    return {
      workspaceDeltaState: "indeterminate",
      workspaceDeltaLabel:
        session.workspaceAccess === "scoped_write"
          ? "Scoped write verification indeterminate"
          : "Workspace comparison indeterminate",
      workspaceDeltaAvailable: Boolean(session.workspaceDeltaAvailable),
      ...(workspaceDeltaHashes ? { workspaceDeltaHashes } : {}),
    };
  }
  return {
    workspaceDeltaState: "unavailable",
    workspaceDeltaLabel: "Workspace comparison unavailable",
    workspaceDeltaAvailable: false,
    ...(workspaceDeltaHashes ? { workspaceDeltaHashes } : {}),
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
