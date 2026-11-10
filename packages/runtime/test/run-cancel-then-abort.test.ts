import { expect, it, vi } from "vitest";
import { requestCancelThenAbort } from "../src/run-cancel-then-abort.js";
import { RUN_CANCEL_REQUESTED_EVENT } from "../src/run-cancel-request.js";

it("persists cancel control before aborting", async () => {
  const appended: unknown[] = [];
  const abort = vi.fn();
  await requestCancelThenAbort(
    {
      appendEvent: async (input) => {
        appended.push(input);
        return {
          id: "event_1",
          threadId: input.threadId,
          runId: input.runId!,
          seq: 1,
          type: input.type,
          category: input.category,
          visibility: input.visibility ?? "user",
          createdAt: "2026-11-04T00:00:00.000Z",
          payload: input.payload,
        };
      },
    },
    {
      threadId: "thread_1",
      runId: "run_1",
      abort,
      reason: "operator_stop",
    },
  );
  expect(appended[0]).toMatchObject({
    type: RUN_CANCEL_REQUESTED_EVENT,
    runId: "run_1",
    payload: expect.objectContaining({
      kind: "napier.run-cancel-request",
      reason: "operator_stop",
    }),
  });
  expect(abort).toHaveBeenCalledOnce();
});

it("still aborts when durable cancel persistence fails", async () => {
  const abort = vi.fn();
  await requestCancelThenAbort(
    {
      appendEvent: async () => {
        throw new Error("store unavailable");
      },
    },
    {
      threadId: "thread_1",
      runId: "run_1",
      abort,
      reason: "operator_stop",
    },
  );
  expect(abort).toHaveBeenCalledOnce();
});
