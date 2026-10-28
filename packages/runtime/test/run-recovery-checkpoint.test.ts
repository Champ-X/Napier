import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import type { RunEvent, RunRecord } from "@napier/contracts";
import { afterEach, expect, it } from "vitest";
import { LocalStore } from "../src/store.js";
import { projectRunRecoveryCheckpoint } from "../src/run-recovery-checkpoint.js";

const roots: string[] = [];
const stores: LocalStore[] = [];
afterEach(async () => {
  stores.splice(0).forEach((store) => store.close());
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
const run = {
  id: "run_source",
  threadId: "thread_source",
  status: "interrupted",
} as RunRecord;
const event = (
  seq: number,
  type: string,
  toolName = "read_file",
  callId = "call_source",
): RunEvent => ({
  id: `event_${seq}`,
  runId: run.id,
  threadId: run.threadId,
  seq,
  type,
  category: "tool",
  visibility: "debug",
  createdAt: "2026-10-29T00:00:00.000Z",
  payload: { callId, toolName },
});

it.each([
  ["read_file", "tool.completed", "completed", "read_completed"],
  ["read_file", "tool.failed", "not_replayable", "read_stopped"],
  ["bash", "tool.completed", "not_replayable", "effect_not_replayable"],
  ["bash", "tool.failed", "needs_reconciliation", "effect_unresolved"],
  [
    "custom_tool",
    "tool.completed",
    "needs_reconciliation",
    "effect_unresolved",
  ],
])("classifies %s / %s conservatively", (tool, terminal, status, reason) => {
  expect(
    projectRunRecoveryCheckpoint(run, [
      event(1, "tool.started", tool),
      event(2, terminal, tool),
    ])?.operations,
  ).toMatchObject([{ status, reason, evidenceSeq: 2 }]);
});

it("does not infer an unexecuted patch from a missing terminal or another Run", () => {
  const foreign = {
    ...event(2, "tool.completed", "apply_patch"),
    runId: "run_foreign",
  };
  expect(
    projectRunRecoveryCheckpoint(run, [
      event(1, "tool.started", "apply_patch"),
      foreign,
    ])?.operations,
  ).toMatchObject([{ status: "needs_reconciliation" }]);
});
it("rejects duplicate starts and duplicate event identities", () => {
  const start = event(1, "tool.started");
  expect(
    projectRunRecoveryCheckpoint(run, [
      start,
      event(2, "tool.started"),
      event(3, "tool.completed"),
    ])?.operations,
  ).toMatchObject([
    { reason: "evidence_missing" },
    { reason: "evidence_missing" },
  ]);
  expect(projectRunRecoveryCheckpoint(run, [start, start])).toMatchObject({
    evidenceLimited: true,
    operations: [],
  });
});
it("bounds display and preserves uncertainty in totals and visible rows", () => {
  const events = Array.from({ length: 140 }, (_, i) => [
    event(i * 2 + 1, "tool.started", "read_file", `call_${i}`),
    event(i * 2 + 2, "tool.completed", "read_file", `call_${i}`),
  ]).flat();
  events.push(event(281, "tool.started", "bash", "call_write"));
  const view = projectRunRecoveryCheckpoint(run, events)!;
  expect(view).toMatchObject({
    total: 141,
    omitted: 13,
    counts: { completed: 140, needs_reconciliation: 1 },
  });
  expect(view.operations[0]?.status).toBe("needs_reconciliation");
  expect(
    projectRunRecoveryCheckpoint(
      run,
      Array.from({ length: 10_001 }, (_, i) => event(i + 1, "tool.started")),
    ),
  ).toMatchObject({ evidenceLimited: true, operations: [] });
});

it.each([
  ["before-effect", "not_executed", "patch_not_committed"],
  ["after-prepared", "not_executed", "patch_not_committed"],
  ["after-commit-marker", "needs_reconciliation", "effect_unresolved"],
  ["after-file", "completed", "patch_reconciled"],
  ["after-settlement", "completed", "patch_settled"],
])(
  "projects real process death at %s without claiming current file validity",
  async (checkpoint, status, reason) => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-recovery-view-"));
    roots.push(root);
    await expect(
      promisify(execFile)(
        process.execPath,
        [
          "--import",
          "tsx",
          fileURLToPath(
            new URL("./fixtures/patch-recovery-crash.ts", import.meta.url),
          ),
          root,
          checkpoint!,
          "create",
          "verified_patches",
        ],
        { timeout: 20000 },
      ),
    ).rejects.toMatchObject({ code: 73 });
    const store = new LocalStore({
      workspaceRoot: path.join(root, "workspace"),
      dataRoot: path.join(root, "data"),
    });
    stores.push(store);
    await store.initialize(true);
    const thread = store
      .listThreads()
      .find((item) => item.title === "Retain settled patch")!;
    const detail = await store.getDetail(thread.id);
    expect(detail.recoveryCheckpoint?.operations).toMatchObject([
      { status, reason },
    ]);
    expect(JSON.stringify(detail.recoveryCheckpoint)).not.toContain(
      "retained.txt",
    );
    expect(JSON.stringify(detail.recoveryCheckpoint)).not.toContain(
      "written once",
    );
    await writeFile(
      path.join(root, "workspace", "retained.txt"),
      "external change\n",
    );
    expect((await store.getDetail(thread.id)).recoveryCheckpoint).toEqual(
      detail.recoveryCheckpoint,
    );
  },
  30000,
);
