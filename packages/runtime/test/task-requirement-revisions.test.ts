import type { RunEvent } from "@napier/contracts";
import { expect, it } from "vitest";
import { projectTaskRequirementRevisions } from "../src/task-requirement-revisions.js";
import { projectTaskWorkingState } from "../src/task-working-state.js";
import {
  createRunControlMessageQueuedPayload,
  createRunControlMessageDeliveredPayload,
  createRunControlMessageUserPayload,
  nextPendingRunControlMessage,
} from "../src/run-control-messages.js";

function event(
  seq: number,
  type: string,
  payload: RunEvent["payload"],
  runId = "run_original",
): RunEvent {
  return {
    id: `event_${seq}`,
    threadId: "thread_original",
    runId,
    seq,
    type,
    category: "message",
    visibility: "user",
    createdAt: "2026-09-13T00:00:00Z",
    payload,
  };
}

it("retains original constraints through long continuations without treating runtime hints as new user scope", () => {
  const events = [
    event(1, "message.user", {
      text: "Change only price.py; preserve validation.",
    }),
    ...Array.from({ length: 15 }, (_, i) =>
      event(i + 2, "goal.continuation.prompt", {
        text: "Continue the current task.",
      }),
    ),
    event(
      17,
      "message.user",
      { text: "Use a threshold of 60, replacing 50." },
      "run_recovered",
    ),
    event(
      18,
      "run.recovery.prompt",
      { text: "Resume from durable evidence." },
      "run_recovered",
    ),
  ];
  const state = projectTaskRequirementRevisions(events);
  expect(state.requirements).toHaveLength(8);
  expect(state.requirements[0]?.text).toContain("Change only price.py");
  expect(state.instructionRevision).toBe(2);
  expect(
    state.requirements.find((item) => item.eventId === "event_17"),
  ).toMatchObject({
    kind: "user_instruction",
    instructionRevision: 2,
    previousInstructionEventId: "event_1",
    sourceRunId: "run_recovered",
  });
  expect(state.requirements.at(-1)?.kind).toBe("runtime_continuation");
  expect(state.omittedCount).toBe(10);
});

it("keeps user amendments ahead of repeated runtime hints within the bounded projection", () => {
  const events = [
    event(1, "message.user", { text: "Change only price.py." }),
    event(2, "message.user", { text: "Use 60 instead of 50." }),
    ...Array.from({ length: 20 }, (_, i) =>
      event(i + 3, "goal.continuation.prompt", { text: "Continue." }),
    ),
  ];
  const state = projectTaskRequirementRevisions(events);
  expect(state.requirements).toHaveLength(8);
  expect(state.requirements.slice(0, 2).map((entry) => entry.text)).toEqual([
    "Change only price.py.",
    "Use 60 instead of 50.",
  ]);
  expect(state.latestInstructionEventId).toBe("event_2");
  expect(state.omittedCount).toBe(14);
});

it.each(["steering", "follow_up"] as const)(
  "includes %s only after its exact queued request is durably delivered",
  (mode) => {
    const first = event(1, "message.user", { text: "Fix price.py." });
    const queued = event(
      2,
      "run.control.queued",
      createRunControlMessageQueuedPayload({
        controlMessageId: "control_revision1234",
        mode,
        text: "Preserve the public function signature.",
      }),
    );
    expect(
      projectTaskRequirementRevisions([first, queued]).instructionRevision,
    ).toBe(1);
    const pending = nextPendingRunControlMessage(
      [queued],
      "run_original",
      mode,
    )!;
    const delivered = event(
      3,
      "run.control.delivered",
      createRunControlMessageDeliveredPayload({
        message: pending.message,
        messageEventSeq: 4,
      }),
    );
    const user = event(
      4,
      "message.user",
      createRunControlMessageUserPayload(pending),
    );
    const state = projectTaskRequirementRevisions([
      first,
      queued,
      delivered,
      user,
    ]);
    expect(state.instructionRevision).toBe(2);
    expect(state.requirements[1]).toMatchObject({
      controlMode: mode,
      previousInstructionEventId: first.id,
    });
    expect(() => projectTaskRequirementRevisions([first, user])).toThrow(
      "not validated",
    );
    expect(() =>
      projectTaskRequirementRevisions([
        first,
        queued,
        delivered,
        { ...user, payload: { ...user.payload, text: "Tampered instruction" } },
      ]),
    ).toThrow();
  },
);

it("exposes instruction chronology without claiming a new message invalidates source evidence or completes the task", () => {
  const check = event(2, "tool.completed", {
    toolName: "verify_workspace",
    details: { status: "passed", kind: "test", runtime: "python" },
  });
  const state = projectTaskWorkingState({
    runId: "run_original",
    events: [
      event(1, "message.user", { text: "Fix the price." }),
      check,
      event(3, "message.user", { text: "What is the status?" }),
    ],
  });
  expect(state.verifications[0]?.precededLatestInstruction).toBe(true);
  expect(state.verifications[0]?.freshness).toBe("unknown");
  expect(state.completion).toBe("not_determined");
  expect(state.instructionRevision).toBe(2);
});

function interleavedControls() {
  const controlMessageId = "control_shared1234";
  const left = event(
    1,
    "run.control.queued",
    createRunControlMessageQueuedPayload({
      controlMessageId,
      mode: "steering",
      text: "Keep the public signature.",
    }),
    "run_left",
  );
  const right = event(
    2,
    "run.control.queued",
    createRunControlMessageQueuedPayload({
      controlMessageId,
      mode: "follow_up",
      text: "Preserve integer arithmetic.",
    }),
    "run_right",
  );
  const a = nextPendingRunControlMessage([left], "run_left", "steering")!;
  const b = nextPendingRunControlMessage([right], "run_right", "follow_up")!;
  return [
    left,
    right,
    event(
      3,
      "run.control.delivered",
      createRunControlMessageDeliveredPayload({
        message: a.message,
        messageEventSeq: 4,
      }),
      "run_left",
    ),
    event(4, "message.user", createRunControlMessageUserPayload(a), "run_left"),
    event(
      5,
      "run.control.delivered",
      createRunControlMessageDeliveredPayload({
        message: b.message,
        messageEventSeq: 6,
      }),
      "run_right",
    ),
    event(
      6,
      "message.user",
      createRunControlMessageUserPayload(b),
      "run_right",
    ),
  ];
}

it("keeps interleaved Run control lifecycles independent even when their control IDs match", () => {
  const events = interleavedControls();
  const before = structuredClone(events);
  const result = projectTaskRequirementRevisions(events);
  expect(result.requirements).toMatchObject([
    {
      eventId: "event_4",
      sourceRunId: "run_left",
      text: "Keep the public signature.",
      controlMode: "steering",
      instructionRevision: 1,
    },
    {
      eventId: "event_6",
      sourceRunId: "run_right",
      text: "Preserve integer arithmetic.",
      controlMode: "follow_up",
      instructionRevision: 2,
    },
  ]);
  expect(events).toEqual(before);
});

it("never validates a control delivery with a queued request from another Run", () => {
  const events = interleavedControls();
  expect(() =>
    projectTaskRequirementRevisions([
      events[0]!,
      { ...events[2]!, runId: "run_right" },
      { ...events[3]!, runId: "run_right" },
    ]),
  ).toThrow(/control delivery/i);
});
