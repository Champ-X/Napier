import { expect, it } from "vitest";
import { collectProcessEvidence } from "./harness-process-evidence.mjs";

const requirement = {
  requiredActions: { start: 1, input: 2, poll: 1, cancel: 1 },
  noRunningSessions: true,
};
const session = {
  id: "process_fixture",
  runId: "run_fixture",
  runtime: "python",
  status: "cancelled",
};
function events(processId = session.id) {
  return ["start", "input", "poll", "input", "cancel"].map((action, i) => ({
    type: "tool.completed",
    runId: session.runId,
    payload: {
      callId: `call_${i}`,
      toolName: "workspace_process",
      details: { action, processId },
    },
  }));
}

it("accepts an actual complete lifecycle and retains runtime without raw output", () => {
  const evidence = collectProcessEvidence(events(), [session], requirement);
  expect(evidence.passed).toBe(true);
  expect(evidence.sessions[0].runtime).toBe("python");
  expect(evidence.sessions[0].actions.input).toBe(2);
});

it("rejects running processes before cleanup, including unrelated leaked sessions", () => {
  expect(
    collectProcessEvidence(
      events(),
      [{ ...session, status: "running" }],
      requirement,
    ).passed,
  ).toBe(false);
  expect(
    collectProcessEvidence(
      events(),
      [session, { ...session, id: "leaked", status: "running" }],
      requirement,
    ).passed,
  ).toBe(false);
});

it("does not combine different processes, duplicate calls, failures, or foreign Run evidence", () => {
  const split = events();
  split[1].payload.details.processId = "second";
  expect(
    collectProcessEvidence(
      split,
      [session, { ...session, id: "second" }],
      requirement,
    ).passed,
  ).toBe(false);
  const duplicate = events();
  duplicate[3] = duplicate[1];
  expect(collectProcessEvidence(duplicate, [session], requirement).passed).toBe(
    false,
  );
  const failed = events();
  failed[3].type = "tool.failed";
  expect(collectProcessEvidence(failed, [session], requirement).passed).toBe(
    false,
  );
  const foreign = events().map((event) => ({ ...event, runId: "foreign" }));
  expect(collectProcessEvidence(foreign, [session], requirement).passed).toBe(
    false,
  );
});

it("preserves cases without process requirements and rejects malformed requirements", () => {
  expect(collectProcessEvidence([], []).passed).toBe(true);
  expect(collectProcessEvidence([], [], requirement).passed).toBe(false);
  expect(() =>
    collectProcessEvidence([], [], {
      ...requirement,
      requiredActions: { input: -1 },
    }),
  ).toThrow();
});
