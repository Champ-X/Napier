import type { ThreadDetail } from "@napier/contracts";
import { taskArtifactBinding } from "@napier/contracts/task-narrative";
import { expect, it } from "vitest";
import { taskArtifactTargets } from "../src/task-completion-output-paths";
import {
  toolFilePreviewBinding,
  toolFilePreviewForTarget,
  toolFilePreviewBindingForTarget,
  toolFilePreviewSelectionKey,
} from "../src/tool-file-preview-binding";

type Deliverable = NonNullable<
  NonNullable<ThreadDetail["taskNarrative"]>["deliverables"]
>[number];
function deliverable(): Deliverable {
  const receipt = {
    threadId: "thread_one",
    runId: "run_one",
    operationId: "call_one",
    path: "report.txt",
    fileSha256: "a".repeat(64),
    fileBytes: 1,
    toolName: "research_source" as const,
    action: "verify_report" as const,
    materialization: "observed" as const,
    evidence: "Report bytes verified.",
  };
  const entry: Deliverable = {
    path: receipt.path,
    source: "tool_file",
    sourceEventId: "event_one",
    toolFile: receipt,
    accessibility: "available",
    verification: "integrity_observed",
    previousVersions: [],
    artifact: {
      id: "event_one",
      kind: "file",
      status: "verified",
      path: receipt.path,
      sha256: receipt.fileSha256,
      sizeBytes: receipt.fileBytes,
      sourceRunId: receipt.runId,
      evidence: receipt.evidence,
      description: "Verified report",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
  };
  entry.observation = {
    source: "workspace",
    bindingSha256: taskArtifactBinding(entry),
    status: "matched",
    sha256: receipt.fileSha256,
    sizeBytes: receipt.fileBytes,
  };
  return entry;
}
it("carries only a currently observed tool receipt into the file target", () => {
  const entry = deliverable();
  const target = taskArtifactTargets([], undefined, [entry])[0]!;
  const selected = toolFilePreviewBindingForTarget([entry], target);
  expect(selected).toEqual({
    sourceEventId: entry.sourceEventId,
    receipt: entry.toolFile,
  });
  expect(selected!.receipt).not.toBe(entry.toolFile);
  expect(
    toolFilePreviewSelectionKey(selected, {
      path: entry.path,
      threadId: "thread_one",
      expectedSha256: entry.artifact.sha256,
    }),
  ).toBeDefined();
});
it.each(["final_reference", "unobserved", "corrupt"])(
  "does not transfer %s as recorded tool integrity",
  (kind) => {
    const entry = deliverable();
    if (kind === "final_reference") entry.source = "final_reference";
    if (kind === "unobserved") delete entry.observation;
    if (kind === "corrupt") entry.artifact.sourceRunId = "run_other";
    expect(toolFilePreviewBinding(entry)).toBeUndefined();
    expect(
      toolFilePreviewBindingForTarget(
        [entry],
        taskArtifactTargets([], undefined, [entry])[0],
      ),
    ).toBeUndefined();
  },
);
it("keys the entire receipt identity and refuses wrong scopes or malformed provenance", () => {
  const entry = deliverable(),
    bound = toolFilePreviewBinding(entry)!,
    scope = {
      path: entry.path,
      threadId: "thread_one",
      expectedSha256: entry.artifact.sha256,
    };
  const initial = toolFilePreviewSelectionKey(bound, scope);
  for (const field of ["runId", "operationId"] as const)
    expect(
      toolFilePreviewSelectionKey(
        { ...bound, receipt: { ...bound.receipt, [field]: "different" } },
        scope,
      ),
    ).not.toBe(initial);
  expect(
    toolFilePreviewSelectionKey(
      { ...bound, sourceEventId: "event_other" },
      scope,
    ),
  ).not.toBe(initial);
  for (const wrong of [
    { ...scope, threadId: "thread_other" },
    { ...scope, path: "other.txt" },
    { ...scope, expectedSha256: "b".repeat(64) },
  ])
    expect(toolFilePreviewSelectionKey(bound, wrong)).toBeUndefined();
  expect(
    toolFilePreviewSelectionKey(
      { ...bound, receipt: { ...bound.receipt, materialization: "produced" } },
      scope,
    ),
  ).toBeUndefined();
});

it("refuses duplicate or changed target provenance", () => {
  const entry = deliverable();
  const target = taskArtifactTargets([], undefined, [entry])[0]!;
  expect(
    toolFilePreviewBindingForTarget([entry, entry], target),
  ).toBeUndefined();
  expect(
    toolFilePreviewBindingForTarget([entry], { ...target, planId: "plan_one" }),
  ).toBeUndefined();
  expect(
    toolFilePreviewBindingForTarget([entry], { ...target, path: "other.txt" }),
  ).toBeUndefined();
  expect(
    toolFilePreviewBindingForTarget([entry], {
      ...target,
      artifact: { ...entry.artifact, sourceRunId: "run_other" },
    }),
  ).toBeUndefined();
});
it("resolves a new invocation from current deliverables even when path and bytes stay the same", () => {
  const initial = deliverable();
  const next = deliverable();
  next.sourceEventId = next.artifact.id = "event_two";
  next.toolFile!.operationId = "call_two";
  next.toolFile!.runId = next.artifact.sourceRunId = "run_two";
  next.observation!.bindingSha256 = taskArtifactBinding(next);
  const resolve = (entry: Deliverable) =>
    toolFilePreviewForTarget(
      [entry],
      taskArtifactTargets([], undefined, [entry])[0],
      initial.artifact.sha256,
    );
  expect(resolve(initial).binding?.receipt.runId).toBe("run_one");
  expect(resolve(next).binding?.receipt.runId).toBe("run_two");
  expect(resolve(next).binding?.receipt.operationId).toBe("call_two");
  expect(resolve(next).expectedSha256).toBe(initial.artifact.sha256);
});

it.each(["missing", "drifted", "reference"])(
  "retains the App selected digest fence when current provenance is %s",
  (kind) => {
    const entry = deliverable();
    const selectedSha256 = entry.artifact.sha256;
    if (kind === "drifted") entry.observation!.status = "mismatched";
    if (kind === "reference") entry.source = "final_reference";
    const current = kind === "missing" ? [] : [entry];
    const projected = toolFilePreviewForTarget(
      current,
      taskArtifactTargets([], undefined, current)[0],
      selectedSha256,
    );
    expect(projected.binding).toBeUndefined();
    expect(projected.expectedSha256).toBe(selectedSha256);
  },
);
