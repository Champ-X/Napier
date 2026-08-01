import type { JsonValue } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { canonicalJson, sha256 } from "../src/ed25519.js";
import {
  createWorkspaceProcessRecoveryManifest,
  parseWorkspaceProcessRecoveryManifest,
} from "../src/workspace-process-recovery-manifest.js";
import {
  parseWorkspaceProcessRollbackAttempt,
  parseWorkspaceProcessRollbackResult,
} from "../src/workspace-process-rollback-events.js";
import {
  createWorkspaceProcessRollbackAttempt,
  createWorkspaceProcessRollbackResult,
} from "../src/workspace-process-rollback-evidence.js";

describe("Workspace Process recovery protocol", () => {
  it("rejects unknown fields and non-durable terminal claims", () => {
    const manifest = createWorkspaceProcessRecoveryManifest({
      processId: "process_protocoltest",
      threadId: "thread_protocoltest",
      runId: "run_protocoltest",
      writePreviewSha256: sha256("preview"),
      writeScopeSetSha256: sha256("scopes"),
      workspaceBeforeSha256: sha256("before"),
      scopes: [
        {
          relativePath: "target.txt",
          relativePathSha256: sha256("target.txt"),
          backupName: "scope-00",
          entryKind: "file",
          snapshotSha256: sha256("snapshot"),
          modeSetSha256: sha256("modes"),
          fileCount: 1,
          directoryCount: 0,
          bytes: 6,
        },
      ],
      totals: {
        scopeCount: 1,
        fileCount: 1,
        directoryCount: 0,
        bytes: 6,
      },
      createdAt: "2026-08-01T00:00:00.000Z",
    });
    expect(
      parseWorkspaceProcessRecoveryManifest(withExtraField(manifest)),
    ).toBe(undefined);

    const attempt = createWorkspaceProcessRollbackAttempt({
      id: "processrollback_protocoltest",
      threadId: manifest.threadId,
      runId: manifest.runId,
      processId: manifest.processId,
      previewSha256: sha256("rollback-preview"),
      recoverySnapshotSha256: manifest.contentSha256,
      expectedWorkspaceSha256: sha256("after"),
      scopeCount: 1,
      fileCount: 1,
      directoryCount: 0,
      bytes: 6,
      attemptedAt: "2026-08-01T00:01:00.000Z",
    });
    expect(parseWorkspaceProcessRollbackAttempt(withExtraField(attempt))).toBe(
      undefined,
    );

    const result = createWorkspaceProcessRollbackResult({
      attempt,
      status: "reverted",
      observedWorkspaceSha256: attempt.expectedWorkspaceSha256,
      restoredScopeCount: 0,
      rollbackVerified: false,
      durable: true,
      cancellationObserved: false,
      appliedAt: "2026-08-01T00:02:00.000Z",
      error: new Error("rollback reverted"),
    });
    expect(parseWorkspaceProcessRollbackResult(withExtraField(result))).toBe(
      undefined,
    );
    expect(
      parseWorkspaceProcessRollbackResult(
        withContentHash({ ...withoutContentHash(result), durable: false }),
      ),
    ).toBe(undefined);
  });
});

function withExtraField(value: { contentSha256: string }): unknown {
  return withContentHash({
    ...withoutContentHash(value),
    unexpected: true,
  });
}

function withoutContentHash<T extends { contentSha256: string }>(
  value: T,
): Omit<T, "contentSha256"> {
  const { contentSha256: _contentSha256, ...content } = value;
  return content;
}

function withContentHash(content: object): unknown {
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content as JsonValue)),
  };
}
