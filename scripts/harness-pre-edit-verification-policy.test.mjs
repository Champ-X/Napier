import assert from "node:assert/strict";
import { test } from "vitest";
import { createPreEditVerificationPolicy } from "./harness-pre-edit-verification-policy.mjs";

const event = (seq, type, payload, runId = "run_current") => ({
  seq,
  type,
  runId,
  payload,
});
const start = (kind = "test") =>
  event(1, "tool.started", {
    toolName: "verify_workspace",
    callId: "call_check",
    inputRedacted: true,
  });
const settled = (type = "tool.completed", status = "passed") =>
  event(2, type, {
    toolName: "verify_workspace",
    callId: "call_check",
    details: { status, kind: "test" },
  });
const input = {
  run: { id: "run_current" },
  toolCall: { id: "call_edit", name: "apply_patch" },
};
const policy = (events, enabled = true) =>
  createPreEditVerificationPolicy({
    enabled,
    listEvents: async () => events,
  });

test("blocks a first patch until a declared test attempt settles, including parallel requests", async () => {
  for (const events of [
    [],
    [start()],
    [
      {
        ...settled(),
        payload: { ...settled().payload, details: { kind: "typecheck" } },
      },
    ],
  ])
    assert.equal((await policy(events).preflight(input)).block, true);
  for (const status of ["passed", "failed", "timed_out", "cancelled"])
    assert.equal(
      await policy([start(), settled("tool.completed", status)]).preflight(
        input,
      ),
      undefined,
    );
});
test("binds failed attempts to actual Kernel arguments without treating a pending check as settled", async () => {
  const events = [start()],
    adapter = policy(events);
  await adapter.preflight({
    ...input,
    toolCall: { name: "verify_workspace", id: "call_check" },
    args: { kind: "test" },
  });
  assert.equal((await adapter.preflight(input)).block, true);
  events.push(
    event(2, "tool.failed", {
      toolName: "verify_workspace",
      callId: "call_check",
    }),
  );
  assert.equal(await adapter.preflight(input), undefined);
  assert.equal((await policy(events).preflight(input)).block, true);
  assert.equal(
    (
      await policy([
        event(1, "tool.completed", {
          toolName: "run_command",
          details: { exitCode: 0 },
        }),
      ]).preflight(input)
    ).block,
    true,
  );
});
test("isolates Run identities; an earlier completed patch is never replayed", async () => {
  assert.equal(
    (
      await policy([start(), { ...settled(), runId: "run_foreign" }]).preflight(
        input,
      )
    ).block,
    true,
  );
  assert.equal(
    await policy([
      event(3, "tool.completed", { toolName: "apply_patch" }),
    ]).preflight(input),
    undefined,
  );
});
test("does not act outside the explicit experiment and respects cancellation", async () => {
  assert.equal(await policy([], false).preflight(input), undefined);
  assert.equal(
    await policy([]).preflight({ ...input, toolCall: { name: "read_file" } }),
    undefined,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    policy([]).preflight({ ...input, signal: controller.signal }),
    /abort/i,
  );
  assert.throws(() => policy([], "true"), /Invalid/);
});
