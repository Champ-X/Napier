import type { ThreadDetail } from "@napier/contracts";
import {
  taskArtifactBinding,
  type ToolFileReceiptPayload,
} from "@napier/contracts/task-narrative";
import { describe, expect, it } from "vitest";

import { taskArtifactTargets } from "../src/task-completion-output-paths";
import { isTaskNarrativeProjection } from "../src/task-narrative-protocol";

type Deliverable = NonNullable<
  NonNullable<ThreadDetail["taskNarrative"]>["deliverables"]
>[number] & { toolFile: ToolFileReceiptPayload };

describe("Tool file deliverable consumers", () => {
  it.each([
    ["browser", "download", "produced"],
    ["browser", "save_screenshot", "produced"],
    ["research_source", "verify_report", "observed"],
    ["web_fetch", "save", "produced"],
  ] as const)(
    "accepts a bound %s/%s receipt with %s provenance",
    (toolName, action, materialization) => {
      const entry = deliverable({ toolName, action, materialization });
      expect(isTaskNarrativeProjection(projection(entry))).toBe(true);
      expect(
        isTaskNarrativeProjection(
          projection({
            ...entry,
            verification: "unverified",
            accessibility: "unchecked",
            observation: undefined,
          }),
        ),
      ).toBe(true);
    },
  );

  it("rejects detached receipt, artifact, provenance and Plan identities", () => {
    const entry = deliverable();
    const invalid = [
      { planId: "plan_other" },
      { planRevision: 1 },
      { sourceEventId: "event_other" },
      { path: "other.md" },
      { source: "final_reference" },
      { toolFile: undefined },
      { artifact: { ...entry.artifact, id: "event_other" } },
      { artifact: { ...entry.artifact, path: "other.md" } },
      { artifact: { ...entry.artifact, sourceRunId: "run_other" } },
      { artifact: { ...entry.artifact, sha256: "b".repeat(64) } },
      { artifact: { ...entry.artifact, sizeBytes: 2 } },
      { artifact: { ...entry.artifact, evidence: "Unbound evidence" } },
      { artifact: { ...entry.artifact, status: "candidate" } },
      { toolFile: { ...entry.toolFile, materialization: "produced" } },
      { toolFile: { ...entry.toolFile, action: "download" } },
      { toolFile: { ...entry.toolFile, threadId: "thread_other" } },
      { toolFile: { ...entry.toolFile, path: "../report.md" } },
      { toolFile: { ...entry.toolFile, fileBytes: 8 * 1024 * 1024 + 1 } },
      { toolFile: { ...entry.toolFile, arbitrary: true } },
    ];
    for (const patch of invalid) {
      expect(isTaskNarrativeProjection(projection({ ...entry, ...patch }))).toBe(
        false,
      );
    }
  });

  it("opens a current tool output with its recorded digest and no Plan authority", () => {
    const entry = deliverable();
    expect(taskArtifactTargets([], undefined, [entry])).toEqual([
      {
        path: entry.path,
        artifact: entry.artifact,
        expectedSha256: entry.toolFile.fileSha256,
      },
    ]);
  });

  it.each(["missing", "mismatched"] as const)(
    "retains a %s receipt in the protocol and blocks output-path fallback",
    (status) => {
      const entry = deliverable();
      entry.verification = "unverified";
      entry.accessibility = status === "missing" ? "missing" : "drifted";
      entry.observation = {
        source: "workspace",
        bindingSha256: taskArtifactBinding(entry),
        status,
        ...(status === "mismatched"
          ? { sha256: "b".repeat(64), sizeBytes: 2 }
          : {}),
      };
      expect(isTaskNarrativeProjection(projection(entry))).toBe(true);
      expect(
        taskArtifactTargets([], { outputPaths: [entry.path] }, [entry]),
      ).toEqual([]);
      expect(entry.artifact.sha256).toBe(entry.toolFile.fileSha256);
    },
  );
});

function projection(entry: unknown) {
  return {
    phase: "ended",
    phaseLabel: "Ended",
    currentAction: "Inspect",
    completedItems: [],
    objective: { status: "unverified", reason: "No independent grader", evidence: [] },
    deliverables: [entry],
  };
}

function deliverable(
  provenance: Pick<ToolFileReceiptPayload, "toolName" | "action" | "materialization"> = {
    toolName: "research_source",
    action: "verify_report",
    materialization: "observed",
  },
): Deliverable {
  const toolFile: ToolFileReceiptPayload = {
    operationId: "operation_a",
    threadId: "thread_a",
    runId: "run_a",
    path: "report.md",
    fileSha256: "a".repeat(64),
    fileBytes: 1,
    evidence: "Tool verified the current file bytes.",
    ...provenance,
  };
  const entry: Deliverable = {
    path: toolFile.path,
    source: "tool_file",
    sourceEventId: "event_a",
    toolFile,
    accessibility: "available",
    verification: "integrity_observed",
    previousVersions: [],
    artifact: {
      id: "event_a",
      path: toolFile.path,
      kind: "file",
      status: "verified",
      sourceRunId: toolFile.runId,
      sha256: toolFile.fileSha256,
      sizeBytes: toolFile.fileBytes,
      description: "A verified tool file receipt.",
      evidence: toolFile.evidence,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
  };
  entry.observation = {
    source: "workspace",
    status: "matched",
    bindingSha256: taskArtifactBinding(entry),
    sha256: toolFile.fileSha256,
    sizeBytes: toolFile.fileBytes,
  };
  return entry;
}
