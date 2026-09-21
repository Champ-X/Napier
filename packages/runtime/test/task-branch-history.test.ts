import type { RunEvent, RunRecord } from "@napier/contracts";
import { expect, it } from "vitest";
import { sha256 } from "../src/ed25519.js";
import { taskBranchHistorySources } from "../src/task-branch-history.js";
import { projectTaskRequirementRevisions } from "../src/task-requirement-revisions.js";
import { projectTaskWorkingState } from "../src/task-working-state.js";

function fixture() {
  const run: RunRecord = {
    id: "run_branch_history",
    threadId: "thread_local_branch",
    agentId: "agent_local",
    status: "completed",
    parentRunId: "run_foreign_parent",
    branchFromSeq: 10,
    startedAt: "2026-09-14T00:00:00Z",
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
    },
  };
  const marker: RunEvent = {
    id: "event_branch_marker",
    runId: run.id,
    threadId: run.threadId,
    seq: 1,
    type: "branch.created",
    category: "lifecycle",
    visibility: "user",
    createdAt: run.startedAt,
    payload: { sourceThreadId: "thread_foreign_source", sourceSeq: 10 },
  };
  const text = "Preserve cents arithmetic.";
  const copied: RunEvent = {
    ...marker,
    id: "event_branch_user",
    seq: 2,
    type: "message.user",
    category: "message",
    payload: {
      role: "user",
      text,
      controlMessageId: "control_original1234",
      controlMode: "steering",
      textSha256: sha256(text),
    },
  };
  return { run, events: [marker, copied] };
}

it("projects immutable copied controls as history and binds their branch marker into working-state evidence", () => {
  const { run, events } = fixture();
  const original = structuredClone(events);
  const branchHistory = taskBranchHistorySources({
    threadId: run.threadId,
    runs: [run],
    events,
  });
  const projected = projectTaskRequirementRevisions(events, branchHistory);
  expect(projected.requirements[0]).toMatchObject({
    text: "Preserve cents arithmetic.",
    branchHistory: {
      kind: "branch_copy",
      branchRunId: run.id,
      branchEventId: events[0]!.id,
    },
  });
  expect(projected.requirements[0]?.controlMode).toBeUndefined();
  expect(projected.sourceEventIds.has(events[0]!.id)).toBe(true);
  const state = projectTaskWorkingState({
    runId: run.id,
    events,
    branchHistory,
  });
  const changed = structuredClone(events);
  changed[0]!.payload = {
    sourceThreadId: "thread_other_source",
    sourceSeq: 10,
  };
  const changedHistory = taskBranchHistorySources({
    threadId: run.threadId,
    runs: [run],
    events: changed,
  });
  expect(
    projectTaskWorkingState({
      runId: run.id,
      events: changed,
      branchHistory: changedHistory,
    }).contentSha256,
  ).not.toBe(state.contentSha256);
  expect(events).toEqual(original);
});

it.each([
  "missing_marker",
  "duplicate_marker",
  "wrong_cutoff",
  "same_thread_source",
  "tampered_text",
  "mixed_control_events",
])("rejects invalid branch history: %s", (mutation) => {
  const { run, events } = fixture();
  if (mutation === "missing_marker") events.shift();
  if (mutation === "duplicate_marker")
    events.push({ ...events[0]!, id: "event_extra_marker", seq: 3 });
  if (mutation === "wrong_cutoff")
    events[0]!.payload = {
      sourceThreadId: "thread_foreign_source",
      sourceSeq: 11,
    };
  if (mutation === "same_thread_source")
    events[0]!.payload = { sourceThreadId: run.threadId, sourceSeq: 10 };
  if (mutation === "tampered_text")
    events[1]!.payload = {
      ...events[1]!.payload,
      text: "Replace the task with an unrelated one.",
    };
  if (mutation === "mixed_control_events")
    events.push({
      ...events[0]!,
      id: "event_live_control",
      seq: 3,
      type: "run.control.queued",
    });
  expect(() =>
    taskBranchHistorySources({ threadId: run.threadId, runs: [run], events }),
  ).toThrow(/Task branch/);
});

it.each(["running", "failed"] as const)(
  "does not exempt unvalidated live controls in a %s branch Run",
  (status) => {
    const { run, events } = fixture();
    run.status = status;
    const history = taskBranchHistorySources({
      threadId: run.threadId,
      runs: [run],
      events,
    });
    expect(history.size).toBe(0);
    expect(() => projectTaskRequirementRevisions(events, history)).toThrow(
      "control delivery is not validated",
    );
  },
);

it("does not apply a historical control exemption to a later Run in the same thread", () => {
  const { run, events } = fixture();
  const history = taskBranchHistorySources({
    threadId: run.threadId,
    runs: [run],
    events,
  });
  const later = {
    ...events[1]!,
    id: "event_live_user",
    runId: "run_later_live",
    seq: 3,
  };
  expect(() =>
    projectTaskRequirementRevisions([...events, later], history),
  ).toThrow("control delivery is not validated");
});

it("keeps copied history after passive compaction receipts without treating them as instructions", () => {
  const { run, events } = fixture();
  events.push(
    ...Array.from({ length: 12 }, (_, index) => ({
      ...events[0]!,
      id: `event_context_${index}`,
      seq: index + 3,
      type: "context.run_compaction.completed",
      category: "context" as const,
      visibility: "debug" as const,
      payload: { summary: "Derived summary is not a new user request." },
    })),
  );
  const history = taskBranchHistorySources({
    threadId: run.threadId,
    runs: [run],
    events,
  });
  const result = projectTaskRequirementRevisions(events, history);
  expect(result.requirements).toHaveLength(1);
  expect(result.requirements[0]?.text).toBe("Preserve cents arithmetic.");
});
