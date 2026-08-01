import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  subagentWorktreeEventEvidence,
  subagentWorktreeSummaryParts,
} from "../src/subagent-worktree-event-view";
import {
  toolEventTraceSummary,
  toolEventTraceView,
} from "../src/tool-event-view";

const digest = "a".repeat(64);

describe("Subagent worktree event view", () => {
  it("projects strict hash-only merge evidence through the Tool Trace", () => {
    const details = worktreeDetails();
    const evidence = subagentWorktreeEventEvidence(details);

    expect(evidence).toEqual(
      expect.objectContaining({
        subagentWorktreeApplyStatus: "applied",
        subagentWorktreePostcondition: "verified",
        subagentWorktreeTaskId: "task_12345678",
        subagentWorktreeSourceFileCount: 120,
        subagentWorktreeWriteScopeCount: 2,
        subagentWorktreeChangedFileCount: 2,
        subagentWorktreeDiagnosticsStatus: "clean",
        subagentWorktreeCandidateVerificationFreshCount: 2,
        subagentWorktreeCandidateVerificationPassedCount: 1,
        subagentWorktreeCandidateVerificationFailedCount: 1,
        subagentWorktreeCandidateVerificationStaleCount: 1,
        subagentWorktreeCandidateVerificationSetSha256: digest,
        subagentWorktreeOutcomeSha256: digest,
        subagentWorktreeResultSha256: digest,
      }),
    );
    expect(subagentWorktreeSummaryParts(evidence!)).toEqual(
      expect.arrayContaining([
        "worktree applied",
        "postcondition verified",
        "candidate-files 2",
        "write-scopes 2",
        "diagnostics clean",
        "candidate-verification 2 fresh / 1 passed / 1 failed / 1 stale",
      ]),
    );

    const event: RunEvent = {
      id: "event_1",
      threadId: "thread_1",
      runId: "run_1",
      seq: 1,
      type: "tool.completed",
      category: "tool",
      visibility: "user",
      createdAt: "2026-08-01T00:00:00.000Z",
      payload: JSON.parse(
        JSON.stringify({
          toolName: "subagent_worktree_apply",
          status: "completed",
          effect: "write",
          details,
        }),
      ) as RunEvent["payload"],
    };
    expect(toolEventTraceView(event)).toEqual(
      expect.objectContaining({
        toolName: "subagent_worktree_apply",
        subagentWorktreeApplyStatus: "applied",
        subagentWorktreeChangedFileCount: 2,
      }),
    );
    expect(toolEventTraceSummary(event)).toContain(
      "worktree applied / postcondition verified / candidate-files 2",
    );
  });

  it("rejects partial schema-v1 details and never projects live paths", () => {
    const partial = worktreeDetails();
    delete (partial as Record<string, unknown>)["changedFileSetSha256"];
    expect(subagentWorktreeEventEvidence(partial)).toBeUndefined();

    const withLiveFields = {
      ...worktreeDetails(),
      paths: ["private/source.ts"],
      previewId: "subworkpreview_private",
      candidateSource: "secret body",
    };
    const serialized = JSON.stringify(
      subagentWorktreeEventEvidence(withLiveFields),
    );
    expect(serialized).not.toContain("private/source.ts");
    expect(serialized).not.toContain("subworkpreview_private");
    expect(serialized).not.toContain("secret body");
  });

  it("projects rollback evidence without inventing post-write diagnostics", () => {
    const rolledBack = worktreeDetails();
    rolledBack["status"] = "rolled_back";
    rolledBack["sourceBytes"] = 0;
    rolledBack["committedFileCount"] = 0;
    rolledBack["rollbackAttempted"] = true;
    rolledBack["rollbackVerified"] = true;
    delete rolledBack["diagnostics"];

    expect(subagentWorktreeEventEvidence(rolledBack)).toEqual(
      expect.objectContaining({
        subagentWorktreeApplyStatus: "rolled_back",
        subagentWorktreeSourceBytes: 0,
        subagentWorktreeRollbackAttempted: true,
        subagentWorktreeRollbackVerified: true,
      }),
    );
    expect(subagentWorktreeEventEvidence(rolledBack)).not.toHaveProperty(
      "subagentWorktreeDiagnosticsStatus",
    );

    const appliedWithoutDiagnostics = worktreeDetails();
    delete appliedWithoutDiagnostics["diagnostics"];
    expect(
      subagentWorktreeEventEvidence(appliedWithoutDiagnostics),
    ).toBeUndefined();

    const impossibleVerification = worktreeDetails();
    impossibleVerification["candidateVerificationPassedCount"] = 3;
    expect(
      subagentWorktreeEventEvidence(impossibleVerification),
    ).toBeUndefined();
  });
});

function worktreeDetails(): Record<string, unknown> {
  return {
    kind: "napier.subagent-worktree-apply",
    schemaVersion: 1,
    status: "applied",
    postcondition: "verified",
    taskId: "task_12345678",
    outcomeSha256: digest,
    sourceSnapshotSha256: digest,
    sourceFileCount: 120,
    sourceBytes: 4096,
    writeScopeCount: 2,
    writeScopeSetSha256: digest,
    changedFileSetSha256: digest,
    candidateVerificationAttemptCount: 3,
    candidateVerificationFreshCount: 2,
    candidateVerificationPassedCount: 1,
    candidateVerificationFailedCount: 1,
    candidateVerificationStaleCount: 1,
    candidateVerificationSetSha256: digest,
    candidateToolchainSha256: digest,
    sourcePreviewResultSha256: digest,
    planSha256: digest,
    fileCount: 2,
    editCount: 2,
    committedFileCount: 2,
    restoredFileCount: 0,
    recoveryArtifactCount: 0,
    rollbackAttempted: false,
    rollbackVerified: false,
    durable: true,
    cancellationObserved: false,
    beforeFileSetSha256: digest,
    expectedFileSetSha256: digest,
    observedFileSetSha256: digest,
    resourceLimitsSha256: digest,
    diagnostics: {
      kind: "napier.lsp-rename-apply-diagnostics",
      schemaVersion: 1,
      status: "clean",
      fileCount: 2,
      omittedFileCount: 0,
      beforeDiagnosticCount: 0,
      afterDiagnosticCount: 0,
      beforeErrorCount: 0,
      afterErrorCount: 0,
      beforeWarningCount: 0,
      afterWarningCount: 0,
      introducedCount: 0,
      resolvedCount: 0,
      unchangedCount: 0,
      truncated: false,
      beforeResultSetSha256: digest,
      afterResultSetSha256: digest,
      deltaSetSha256: digest,
      durationMs: 1,
      resultSha256: digest,
    },
    resultSha256: digest,
  };
}
