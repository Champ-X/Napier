import type { RunEvent } from "@napier/contracts";
import { expect, it } from "vitest";
import { assessPreEditVerification } from "../src/pre-edit-verification.js";
import { verificationToolInputLedgerProjection } from "../src/verification-ledger.js";

const event = (
  seq: number,
  type: string,
  payload: RunEvent["payload"],
  runId = "run_current",
) => ({ id: `event_${seq}`, runId, seq, type, payload }) as RunEvent;
const assess = (events: RunEvent[], available = true) =>
  assessPreEditVerification({
    runId: "run_current",
    events,
    toolName: "apply_patch",
    verificationAvailable: available,
  });
const start = (seq = 1, kind = "test") =>
  event(seq, "tool.started", {
    toolName: "verify_workspace",
    callId: "check",
    ...verificationToolInputLedgerProjection({
      kind,
      target: "private.test.mjs",
    }),
  });

it("persists only a recognized verification kind alongside the existing input hash", () => {
  const input = verificationToolInputLedgerProjection({
    kind: "test",
    target: "private.test.mjs",
  });
  expect(input.verificationKind).toBe("test");
  expect(JSON.stringify(input)).not.toContain("private.test.mjs");
  const invalid = verificationToolInputLedgerProjection({
    kind: "PRIVATE_INVALID_VALUE",
  });
  expect(invalid.verificationKind).toBe("unknown");
  expect(JSON.stringify(invalid)).not.toContain("PRIVATE_INVALID_VALUE");
});
it("requires settlement and reconstructs a failed test attempt from serialized ledger events", () => {
  expect(assess([start()]).status).toBe("test_required");
  const events = [
    start(),
    event(2, "tool.failed", { toolName: "verify_workspace", callId: "check" }),
  ];
  expect(assess(JSON.parse(JSON.stringify(events)))).toMatchObject({
    status: "settled_test_attempt",
    evidenceEventId: "event_2",
  });
  expect(assess([start(1, "typecheck"), events[1]!]).status).toBe(
    "test_required",
  );
});
it("recognizes a denied test without claiming execution and accepts historical completed receipts", () => {
  expect(
    assess([
      event(1, "tool.blocked", {
        toolName: "verify_workspace",
        callId: "denied",
        ...verificationToolInputLedgerProjection({ kind: "test" }),
      }),
    ]).status,
  ).toBe("settled_test_attempt");
  expect(
    assess([
      event(1, "tool.completed", {
        toolName: "verify_workspace",
        details: { kind: "test", status: "failed" },
      }),
    ]).status,
  ).toBe("settled_test_attempt");
});
it("does not borrow another Run or call, or infer an untyped historical failure was a test", () => {
  expect(
    assess([
      start(),
      event(2, "tool.failed", {
        toolName: "verify_workspace",
        callId: "other",
      }),
    ]).status,
  ).toBe("test_required");
  expect(
    assess([
      start(),
      event(
        2,
        "tool.failed",
        { toolName: "verify_workspace", callId: "check" },
        "foreign",
      ),
    ]).status,
  ).toBe("test_required");
  expect(
    assess([
      event(1, "tool.failed", {
        toolName: "verify_workspace",
        callId: "check",
      }),
    ]).status,
  ).toBe("test_required");
  expect(
    assess([
      event(1, "tool.failed", {
        toolName: "verify_workspace",
        callId: "check",
      }),
      start(2),
    ]).status,
  ).toBe("test_required");
});
it("does not require inaccessible verification or replay an earlier patch", () => {
  expect(assess([], false).status).toBe("verification_unavailable");
  expect(
    assess([event(1, "tool.completed", { toolName: "apply_patch" })]).status,
  ).toBe("prior_patch");
  expect(
    assessPreEditVerification({
      runId: "run_current",
      events: [],
      toolName: "read_file",
      verificationAvailable: true,
    }).status,
  ).toBe("not_applicable");
});
