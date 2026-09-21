import type { VerificationKind } from "./verification-types.js";
import type { VerificationRuntime } from "./verification-runtime.js";
import type { TestRunnerSelection } from "./verification-test-runner.js";
import type { WorkspacePathSnapshot } from "./workspace-snapshot.js";
import type { VerificationWorkspaceDigest } from "./verification-workspace-digest.js";
import { sha256 } from "./ed25519.js";
export function verificationScopeReceipt({
  kind,
  cwdPath,
  targetPath,
  targetSnapshot,
  workspaceSnapshot,
  runtime,
  selection,
}: {
  kind: VerificationKind;
  cwdPath: string;
  targetPath: string | undefined;
  targetSnapshot: WorkspacePathSnapshot | undefined;
  workspaceSnapshot: VerificationWorkspaceDigest;
  runtime: VerificationRuntime;
  selection: TestRunnerSelection | undefined;
}) {
  return {
    kind,
    ...(selection
      ? {
          testRunner: selection.runner,
          testRunnerSourceSha256: selection.sourceSha256,
        }
      : {}),
    cwdPathSha256: sha256(cwdPath),
    ...(targetPath ? { targetPathSha256: sha256(targetPath) } : {}),
    ...(targetSnapshot
      ? {
          targetKind: targetSnapshot.kind,
          targetSnapshotSha256: targetSnapshot.sha256,
          targetSnapshotFileCount: targetSnapshot.fileCount,
          targetSnapshotBytes: targetSnapshot.bytes,
          targetSnapshotTruncated: targetSnapshot.truncated,
        }
      : {}),
    verifierPathSha256: runtime.verifierPathSha256,
    verifierSha256: runtime.verifierSha256,
    toolchainExternal: runtime.toolchainExternal,
    toolchainSha256: runtime.toolchainSha256,
    ...(runtime.verifierVersion
      ? { verifierVersion: runtime.verifierVersion }
      : {}),
    ...(runtime.runtimeIdentitySha256
      ? { runtimeIdentitySha256: runtime.runtimeIdentitySha256 }
      : {}),
    workspaceSnapshotSha256: workspaceSnapshot.sha256,
    workspaceSnapshotFileCount: workspaceSnapshot.fileCount,
    workspaceSnapshotBytes: workspaceSnapshot.bytes,
    workspaceSnapshotTruncated: workspaceSnapshot.truncated,
  };
}
