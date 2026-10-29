import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  taskArtifactBinding,
  type TaskArtifactSelection,
} from "@napier/contracts/task-narrative";
import type { ThreadDetail } from "@napier/contracts";
import {
  artifactSelectionCurrentFact,
  assertArtifactReceiptVersion,
} from "../src/artifact-version-binding";

const selection: TaskArtifactSelection = {
  threadId: "thread_1",
  planId: "plan_1",
  planRevision: 3,
  artifact: {
    id: "report",
    path: "report.md",
    kind: "file",
    status: "verified",
    description: "Report",
    evidence: "Recorded",
    sha256: "a".repeat(64),
    sizeBytes: 16,
    createdAt: "2026-10-30T00:00:00Z",
    updatedAt: "2026-10-30T00:00:00Z",
  },
};
const receipt = {
  threadId: "thread_1",
  planId: "plan_1",
  planRevision: 3,
  artifactId: "report",
  status: "verified",
  artifactKind: "file",
  pathSha256: createHash("sha256").update("report.md").digest("hex"),
  sha256: "a".repeat(64),
  sizeBytes: 16,
};
type Deliverable = NonNullable<
  NonNullable<ThreadDetail["taskNarrative"]>["deliverables"]
>[number];

describe("artifact version receipt binding", () => {
  it("requires content fields based on the caller and keeps digest-free diffs inspectable", () => {
    const { sha256: _sha256, sizeBytes: _sizeBytes, ...identity } = receipt;
    const diff = { ...identity, kind: "napier.plan-artifact-diff-preview" };
    expect(() =>
      assertArtifactReceiptVersion(selection, diff, "identity"),
    ).not.toThrow();
    expect(() =>
      assertArtifactReceiptVersion(selection, diff, "content"),
    ).toThrow("different artifact version");
    expect(() =>
      assertArtifactReceiptVersion(selection, diff, "expected"),
    ).toThrow("different artifact version");
    expect(() =>
      assertArtifactReceiptVersion(
        selection,
        { ...identity, sha256: receipt.sha256 },
        "content",
      ),
    ).toThrow("different artifact version");
  });

  it("rejects a text-preview receipt that omits the selected file digest and size", () => {
    const { sha256: _sha256, sizeBytes: _sizeBytes, ...identity } = receipt;
    expect(() =>
      assertArtifactReceiptVersion(selection, {
        ...identity,
        kind: "napier.plan-artifact-text-preview",
      }),
    ).toThrow("different artifact version");
  });

  it("accepts matching current reads and a drift report bound to the selected expected digest", () => {
    expect(() =>
      assertArtifactReceiptVersion(selection, receipt),
    ).not.toThrow();
    const { sha256: _hash, sizeBytes: _size, ...identity } = receipt;
    expect(() =>
      assertArtifactReceiptVersion(selection, {
        ...identity,
        expectedSha256: selection.artifact.sha256!,
        sizeBytes: 20,
      }),
    ).not.toThrow();
  });

  it.each([
    { planRevision: 4 },
    { planId: "other" },
    { threadId: "other" },
    { artifactId: "other" },
    { artifactKind: "directory" },
    { status: "produced" },
    { pathSha256: "b".repeat(64) },
    { sha256: "b".repeat(64) },
    { sizeBytes: 15 },
  ])("rejects a receipt with a different selected version: %j", (change) => {
    expect(() =>
      assertArtifactReceiptVersion(selection, { ...receipt, ...change }),
    ).toThrow("different artifact version");
  });

  it.each([
    ["matched", "integrity_observed"],
    ["mismatched", "drifted"],
    ["missing", "missing"],
    ["unchecked", "unchecked"],
    ["observed", "available"],
  ] as const)("uses exact-bound %s observations", (status, expected) => {
    const entry = deliverable();
    entry.observation = {
      source: "workspace",
      bindingSha256: taskArtifactBinding(entry),
      status,
      sha256: entry.artifact.sha256!,
      sizeBytes: entry.artifact.sizeBytes!,
    };
    expect(artifactSelectionCurrentFact(selection, [entry])).toBe(expected);
    expect(
      artifactSelectionCurrentFact({ ...selection, planRevision: 4 }, [entry]),
    ).toBe("unchecked");
    entry.artifact.description = "Replaced declaration";
    expect(
      artifactSelectionCurrentFact({ ...selection, artifact: entry.artifact }, [
        entry,
      ]),
    ).toBe("unchecked");
  });

  it("keeps metadata-only verification and malformed matching bytes unchecked", () => {
    const entry = deliverable();
    expect(artifactSelectionCurrentFact(selection, [entry])).toBe("unchecked");
    entry.observation = {
      source: "workspace",
      bindingSha256: taskArtifactBinding(entry),
      status: "matched",
      sha256: "b".repeat(64),
      sizeBytes: 16,
    };
    expect(artifactSelectionCurrentFact(selection, [entry])).toBe("unchecked");
  });
});

function deliverable(): Deliverable {
  return {
    artifact: { ...selection.artifact },
    path: selection.artifact.path,
    planId: selection.planId,
    planRevision: selection.planRevision!,
    source: "plan",
    accessibility: "unchecked",
    verification: "integrity_recorded",
    previousVersions: [],
  };
}
