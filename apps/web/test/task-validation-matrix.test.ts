import type { ArtifactManifestEntry, ExecutionPlan, RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { taskValidationMatrix } from "../src/task-validation-matrix";

describe("taskValidationMatrix", () => {
  it("keeps every check unknown when no direct evidence exists", () => {
    expect(taskValidationMatrix([], [])).toEqual([
      { id: "typecheck", status: "unknown", source: "receipt" },
      { id: "tests", status: "unknown", source: "receipt" },
      { id: "diagnostics", status: "unknown", source: "lsp" },
      { id: "artifact", status: "unknown", source: "ledger" },
    ]);
  });

  it("projects explicit verification, diagnostics, and artifact facts", () => {
    const rows = taskValidationMatrix(
      [
        verification(1, "typecheck", "passed", 0),
        verification(2, "test", "failed", 2),
        lsp(3, { diagnosticCount: 2, errorCount: 0, warningCount: 2 }),
      ],
      [plan([artifact("verified"), artifact("produced", "bundle")])],
    );

    expect(rows).toEqual([
      expect.objectContaining({
        id: "typecheck",
        status: "passed",
        source: "receipt",
        eventSeq: 1,
        exitCode: 0,
        durationMs: 420,
      }),
      expect.objectContaining({
        id: "tests",
        status: "failed",
        source: "receipt",
        eventSeq: 2,
        exitCode: 2,
      }),
      expect.objectContaining({
        id: "diagnostics",
        status: "warning",
        source: "lsp",
        diagnosticCount: 2,
        errorCount: 0,
        warningCount: 2,
      }),
      expect.objectContaining({
        id: "artifact",
        status: "warning",
        source: "ledger",
        artifactCount: 2,
        verifiedArtifactCount: 1,
        producedArtifactCount: 1,
        missingArtifactCount: 0,
      }),
    ]);
  });

  it("marks old successful evidence stale after a later workspace write", () => {
    const rows = taskValidationMatrix(
      [
        verification(1, "typecheck", "passed", 0),
        event(2, "tool.completed", {
          toolName: "apply_patch",
          effect: "write",
        }),
      ],
      [],
    );

    expect(rows[0]).toEqual(
      expect.objectContaining({
        id: "typecheck",
        status: "warning",
        stale: true,
      }),
    );
  });
});

function verification(
  seq: number,
  kind: "typecheck" | "test",
  status: "passed" | "failed",
  exitCode: number,
): RunEvent {
  return event(seq, "tool.completed", {
    toolName: "verify_workspace",
    status: "completed",
    details: { kind, status, exitCode, durationMs: 420 },
  });
}

function lsp(
  seq: number,
  counts: { diagnosticCount: number; errorCount: number; warningCount: number },
): RunEvent {
  return event(seq, "tool.completed", {
    toolName: "lsp_diagnostics",
    status: "completed",
    details: {
      kind: "napier.lsp-diagnostics",
      schemaVersion: 1,
      status: counts.diagnosticCount === 0 ? "clean" : "diagnostics",
      language: "typescript",
      durationMs: 82,
      ...counts,
    },
  });
}

function event(
  seq: number,
  type: string,
  payload: Record<string, unknown>,
): RunEvent {
  return {
    id: `event_${seq}`,
    threadId: "thread_1",
    runId: "run_1",
    seq,
    type,
    category: "tool",
    visibility: "user",
    createdAt: "2026-08-26T00:00:00.000Z",
    payload: payload as RunEvent["payload"],
  };
}

function artifact(
  status: ArtifactManifestEntry["status"],
  id = "report",
): ArtifactManifestEntry {
  return {
    id,
    path: `${id}.md`,
    kind: "file",
    description: id,
    status,
    evidence: "ledger evidence",
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
  };
}

function plan(artifacts: ArtifactManifestEntry[]): ExecutionPlan {
  return {
    id: "plan_1",
    threadId: "thread_1",
    status: "active",
    artifacts,
  } as ExecutionPlan;
}
