import type { OsSandboxAdapter } from "./sandbox.js";

export type VerificationKind = "typecheck" | "test" | "format";

export interface VerificationRequest {
  kind: VerificationKind;
  cwd?: string;
  target?: string;
  timeoutMs?: number;
}

export type VerificationStatus =
  | "passed"
  | "failed"
  | "timed_out"
  | "output_capped";

export interface VerificationDetails {
  kind: VerificationKind;
  status: VerificationStatus;
  sandbox: string;
  cwd: string;
  target?: string;
  scopeSha256: string;
  cwdPathSha256: string;
  targetPathSha256?: string;
  targetKind?: "file" | "directory";
  targetSnapshotSha256?: string;
  targetSnapshotFileCount?: number;
  targetSnapshotBytes?: number;
  targetSnapshotTruncated?: boolean;
  verifierPathSha256: string;
  verifierSha256: string;
  verifierVersion?: string;
  toolchainExternal: boolean;
  toolchainSha256: string;
  runtimeIdentitySha256?: string;
  workspaceSnapshotSha256: string;
  workspaceSnapshotFileCount: number;
  workspaceSnapshotBytes: number;
  workspaceSnapshotTruncated: boolean;
  durationMs: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdoutChars: number;
  stderrChars: number;
  stdoutSha256: string;
  stderrSha256: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  resultSha256: string;
}

export interface VerificationResult {
  details: VerificationDetails;
  stdout: string;
  stderr: string;
}

export interface SelectedTestExecutionResult {
  status: VerificationStatus;
  sandbox: string;
  verifierSha256: string;
  verifierVersion?: string;
  toolchainSha256: string;
  runtimeIdentitySha256?: string;
  durationMs: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  stdoutSha256: string;
  stderrSha256: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

export interface VerificationRunnerOptions {
  workspaceRoot: string;
  sandbox: OsSandboxAdapter;
  nodeExecutable?: string;
  toolchainRoot?: string;
}
