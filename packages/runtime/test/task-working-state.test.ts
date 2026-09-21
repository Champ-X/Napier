import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { RunEvent, RunRecord } from "@napier/contracts";
import { afterEach, expect, it } from "vitest";
import { canonicalJson, sha256 } from "../src/ed25519.js";
import { projectTaskWorkingState } from "../src/task-working-state.js";
import {
  workingStateRunLineage,
  prepareAgentWorkingStateContext,
  taskWorkingStateForContext,
} from "../src/agent-working-state-context.js";
import { createWorkspacePathSnapshot } from "../src/workspace-snapshot.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
function event(
  seq: number,
  type: string,
  payload: RunEvent["payload"],
  runId = "run_test",
): RunEvent {
  return {
    id: `event_${seq}`,
    threadId: "thread_test",
    runId,
    seq,
    type,
    category: "system",
    visibility: "debug",
    createdAt: "2026-09-13T00:00:00.000Z",
    payload,
  };
}
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "napier-working-state-"));
  roots.push(root);
  await writeFile(path.join(root, "price.py"), "price = 12\n");
  const snapshot = await createWorkspacePathSnapshot(root, root, {
    includeDirectories: true,
  });
  return { root, snapshot };
}
function check(seq: number, snapshot: string, status = "passed", target = ".") {
  return event(seq, "tool.completed", {
    toolName: "verify_workspace",
    details: {
      kind: "test",
      runtime: "python",
      status,
      cwdPathSha256: sha256("."),
      targetPathSha256: sha256(target),
      workspaceSnapshotSha256: snapshot,
      workspaceSnapshotTruncated: false,
      snapshotStatus: "unchanged",
      resultSha256: sha256(String(seq)),
    },
  });
}

it("retains requirements and artifact versions across repeated conversational compaction", async () => {
  const { snapshot } = await fixture();
  const events = [
    event(1, "message.user", { text: "Change price, preserve validation" }),
    event(2, "message.user", { text: "The new price must be 12" }),
    event(3, "tool.completed", {
      toolName: "apply_patch",
      details: {
        pathSha256: sha256("price.py"),
        afterSha256: sha256("price = 12\n"),
      },
    }),
    check(4, snapshot.sha256),
  ];
  const before = projectTaskWorkingState({
    runId: "run_test",
    events,
    workspace: snapshot,
  });
  expect(before.requirements.map((item) => item.text)).toEqual([
    "Change price, preserve validation",
    "The new price must be 12",
  ]);
  expect(before.artifacts[0]).toMatchObject({
    path: "price.py",
    current: "matches",
  });
  expect(before.verifications[0]?.freshness).toBe("current");
  expect(before.pendingActions).toEqual([]);
  events.push(
    event(5, "context.run_compaction.completed", { summary: "lossy summary" }),
    event(6, "context.run_compaction.completed", {
      summary: "shorter summary",
    }),
  );
  expect(
    projectTaskWorkingState({ runId: "run_test", events, workspace: snapshot }),
  ).toEqual(before);
});

it("preserves selected-test coverage in model context after conversational compaction", async () => {
  const { root, snapshot } = await fixture();
  const receipt = check(1, snapshot.sha256);
  receipt.payload = {
    ...receipt.payload,
    details: {
      ...(receipt.payload as { details: Record<string, unknown> }).details,
      selectionMode: "selected",
      selectedTestCount: 1,
    },
  };
  const context = await prepareAgentWorkingStateContext({
    context: { messages: [] },
    runId: "run_test",
    workspaceRoot: root,
    enabled: true,
    listEvents: async () => [
      receipt,
      event(2, "context.run_compaction.completed", { summary: "Tests passed" }),
    ],
  });
  const projection = taskWorkingStateForContext(context);
  expect(projection).toContain('"freshness":"current"');
  expect(projection).toContain('"selectionMode":"selected"');
  expect(projection).toContain('"selectedTestCount":1');
  expect(projection).toContain('"completion":"not_determined"');
});

it("invalidates verification when files change outside the ledger and accepts a fresh rerun", async () => {
  const { root, snapshot } = await fixture();
  const events = [check(1, snapshot.sha256)];
  await writeFile(path.join(root, "price.py"), "price = 13\n");
  const changed = await createWorkspacePathSnapshot(root, root, {
    includeDirectories: true,
  });
  const stale = projectTaskWorkingState({
    runId: "run_test",
    events,
    workspace: changed,
  });
  expect(stale.verifications[0]?.freshness).toBe("stale");
  expect(stale.pendingActions[0]?.action).toBe("reverify");
  events.push(check(2, changed.sha256));
  const fresh = projectTaskWorkingState({
    runId: "run_test",
    events,
    workspace: changed,
  });
  expect(fresh.verifications).toHaveLength(1);
  expect(fresh.verifications[0]?.freshness).toBe("current");
  expect(fresh.pendingActions).toEqual([]);
});

it("does not substitute another scope or truncated observation for passing evidence", async () => {
  const { snapshot } = await fixture();
  const events = [
    check(1, snapshot.sha256, "failed", "test_a.py"),
    check(2, snapshot.sha256, "passed", "test_b.py"),
  ];
  const state = projectTaskWorkingState({
    runId: "run_test",
    events,
    workspace: snapshot,
  });
  expect(state.verifications).toHaveLength(2);
  expect(state.pendingActions).toHaveLength(1);
  const incomplete = projectTaskWorkingState({
    runId: "run_test",
    events,
    workspace: { ...snapshot, truncated: true },
  });
  expect(incomplete.verifications[1]?.freshness).toBe("unknown");
});

it("isolates runs and records later tool completions without claiming the task is resolved", () => {
  const state = projectTaskWorkingState({
    runId: "run_test",
    events: [
      event(1, "message.user", { text: "foreign secret" }, "run_other"),
      event(2, "tool.failed", {
        toolName: "run_command",
        toolFailure: { disposition: "correct_input" },
      }),
      event(3, "tool.completed", { toolName: "run_command" }),
    ],
  });
  expect(JSON.stringify(state)).not.toContain("foreign secret");
  expect(state.rejectedAttempts[0]?.laterCompletionObserved).toBe(true);
  expect(state.verifications).toEqual([]);
  const { contentSha256, ...content } = state;
  expect(contentSha256).toBe(sha256(canonicalJson(content)));
});

it("reprojects an explicitly linked recovery source while invalidating its stale checks", async () => {
  const { root, snapshot } = await fixture();
  const old = [
    event(1, "message.user", { text: "Preserve validation" }),
    check(2, snapshot.sha256),
  ];
  await writeFile(path.join(root, "price.py"), "price = 14\n");
  const current = await createWorkspacePathSnapshot(root, root, {
    includeDirectories: true,
  });
  const state = projectTaskWorkingState({
    runId: "run_recovery",
    sourceRunIds: ["run_test"],
    events: [
      ...old,
      event(
        3,
        "run.recovery.prompt",
        { text: "Continue from the interrupted run" },
        "run_recovery",
      ),
    ],
    workspace: current,
  });
  expect(state.requirements).toHaveLength(2);
  expect(state.sourceRunIds).toEqual(["run_recovery", "run_test"]);
  expect(state.verifications[0]?.freshness).toBe("stale");
  expect(state.completion).toBe("not_determined");
});

it("adds state to prompt sources without injecting synthetic user messages or replaying tools", async () => {
  const { root } = await fixture();
  const context = {
    messages: [
      { role: "user" as const, content: "Change price", timestamp: 1 },
    ],
  };
  const prepared = await prepareAgentWorkingStateContext({
    context,
    runId: "run_test",
    workspaceRoot: root,
    enabled: true,
    listEvents: async () => [
      event(1, "message.user", { text: "Change price" }),
    ],
  });
  expect(prepared.messages).toBe(context.messages);
  expect(taskWorkingStateForContext(prepared)).toContain(
    "napier.task-working-state",
  );
  expect(taskWorkingStateForContext(context)).toBe("");
});

it("bounds recovery ancestry and refuses cycles or a parent from another thread", () => {
  const run = (id: string, parentRunId?: string, threadId = "thread_test") =>
    ({ id, threadId, parentRunId }) as RunRecord;
  const parent = run("parent");
  const child = run("child", "parent");
  expect(workingStateRunLineage(child, [parent, child])).toEqual([
    "child",
    "parent",
  ]);
  expect(() =>
    workingStateRunLineage(child, [run("parent", undefined, "foreign")]),
  ).toThrow("unavailable");
  expect(() =>
    workingStateRunLineage(child, [run("parent", "child"), child]),
  ).toThrow("invalid");
  const chain = Array.from({ length: 33 }, (_, i) =>
    run(String(i), i < 32 ? String(i + 1) : undefined),
  );
  expect(() => workingStateRunLineage(chain[0]!, chain)).toThrow("limit");
});
