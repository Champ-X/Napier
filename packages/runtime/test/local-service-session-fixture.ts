import type { WorkspaceProcessSession } from "@napier/contracts";

export function localServiceSession(owner: {
  threadId: string;
  runId: string;
}): WorkspaceProcessSession {
  const startedAt = new Date(Date.now() - 1_000).toISOString();
  return {
    kind: "napier.workspace-process-session",
    schemaVersion: 8,
    id: "process_local_service",
    ...owner,
    runtime: "node",
    status: "running",
    sandbox: "oci",
    workspaceAccess: "read_only",
    networkAccess: "outbound_denied_loopback_service",
    localService: {
      protocol: "http",
      containerPort: 31_879,
      host: "127.0.0.1",
      hostPort: 45_678,
      url: "http://127.0.0.1:45678/",
      healthPathSha256: "7".repeat(64),
      identitySha256: "8".repeat(64),
      status: "ready",
      readyAt: startedAt,
    },
    argumentCount: 2,
    commandSha256: "1".repeat(64),
    executableSha256: "2".repeat(64),
    environmentSha256: "3".repeat(64),
    resourceLimitsSha256: "4".repeat(64),
    cwdPathSha256: "5".repeat(64),
    timeoutMs: 120_000,
    outputLimitChars: 1_000,
    ioMode: "pipe",
    stdinMode: "closed",
    stdinOpen: false,
    stdinWriteCount: 0,
    stdinBytes: 0,
    stdinSha256: "6".repeat(64),
    workspaceBeforeSha256: "9".repeat(64),
    workspaceBeforeTruncated: false,
    startedAt,
    stdoutChars: 0,
    stderrChars: 0,
    stdoutTruncated: false,
    stderrTruncated: false,
    nextCursor: 0,
    outputAvailable: false,
    workspaceDeltaAvailable: false,
    contentSha256: "a".repeat(64),
  };
}
