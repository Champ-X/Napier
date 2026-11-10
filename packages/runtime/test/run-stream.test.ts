import { createHash } from "node:crypto";
import type { SubagentTask, ThreadDetail } from "@napier/contracts";
import { expect, it } from "vitest";
import { streamSnapshotFrame } from "../src/run-stream.js";

it("keeps private child completion capabilities out of public snapshots without changing recovery state", () => {
  const reservation = {
    kind: "napier.subagent-completion-reservation",
    candidate: { id: "subworkpreview_private", sourceSha256: "a".repeat(64) },
  };
  const task = {
    id: "task_child",
    status: "completed",
    startedAt: "2026-11-07T00:00:00.000Z",
    finishedAt: "2026-11-07T00:00:01.000Z",
    writePaths: ["private/path.txt"],
    completionReservation: reservation,
    completion: { reservation, contentSha256: "b".repeat(64) },
  } as unknown as SubagentTask;
  const detail = { subagents: [task], events: [] } as unknown as ThreadDetail;
  const frame = streamSnapshotFrame(detail);
  expect(frame.detail.subagents).toEqual([
    {
      id: task.id,
      status: task.status,
      startedAt: task.startedAt,
      finishedAt: task.finishedAt,
    },
  ]);
  expect(JSON.stringify(frame)).not.toContain("subworkpreview_private");
  expect(JSON.stringify(frame)).not.toContain("private/path.txt");
  expect(detail.subagents[0]).toBe(task);
  expect(task.completion?.reservation.candidate?.id).toBe(
    "subworkpreview_private",
  );
  const serialized = JSON.stringify(frame.detail);
  expect(frame.detailBytes).toBe(Buffer.byteLength(serialized, "utf8"));
  expect(frame.detailSha256).toBe(
    createHash("sha256").update(serialized).digest("hex"),
  );
});
