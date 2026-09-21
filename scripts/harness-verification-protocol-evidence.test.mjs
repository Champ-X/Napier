import { test } from "vitest";
import assert from "node:assert/strict";
import { collectVerificationProtocolEvidence } from "./harness-verification-protocol-evidence.mjs";

const event = (seq, type, payload) => ({
  id: `event_${seq}`,
  runId: "run_one",
  seq,
  type,
  payload,
});
const started = (seq, id, toolName) =>
  event(seq, "tool.started", { callId: id, toolName });
const invoked = (seq) =>
  event(seq, "context.model_invocation", {
    purpose: "agent_turn",
    capsuleSha256: `hash_${seq}`,
    contextEnvelopeSha256: `envelope_${seq}`,
  });
const call = (id, args, name = "run_command") => ({
  type: "toolCall",
  id,
  name,
  arguments: args,
});
const store = (calls) => ({
  async read(hash) {
    return {
      sourceRunId: "run_one",
      contextEnvelopeSha256: hash.replace("hash", "envelope"),
      context: {
        systemPrompt: "PROTOCOL",
        messages: [{ role: "assistant", content: calls }],
      },
    };
  },
});

test("binds pre/post ordering and full argument reuse without calling arbitrary inline code a test", async () => {
  const events = [
    started(1, "a", "run_command"),
    event(2, "tool.completed", { callId: "a", details: { exitCode: 1 } }),
    started(3, "patch", "apply_patch"),
    started(4, "b", "run_command"),
    started(5, "c", "run_command"),
    invoked(6),
  ];
  const args = { args: ["-e", "console.log('not a test')"], cwd: "a" };
  const result = await collectVerificationProtocolEvidence(
    events,
    store([call("a", args), call("b", { ...args, cwd: "b" }), call("c", args)]),
    "PROTOCOL",
  );
  assert.equal(result.complete, true);
  assert.equal(result.invocations[0].protocolPresent, true);
  assert.equal(result.executions[0].classification, "inline_command");
  assert.equal(result.executions[0].exitCode, 1);
  assert.equal(result.executions[0].settledBeforeFirstPatch, true);
  assert.deepEqual(result.reusedRequests[0].afterCallIds, ["c"]);
  assert(!JSON.stringify(result).includes("console.log"));
});

test("orders shuffled ledger input and does not count a concurrent execution as settled before editing", async () => {
  const events = [
    invoked(5),
    started(3, "patch", "apply_patch"),
    event(4, "tool.completed", { callId: "a", details: { exitCode: 0 } }),
    started(1, "a", "run_command"),
  ];
  const result = await collectVerificationProtocolEvidence(
    events,
    store([call("a", { args: ["-e", "check()"] })]),
    "PROTOCOL",
  );
  assert.equal(result.executions[0].phase, "before_first_patch");
  assert.equal(result.executions[0].settledBeforeFirstPatch, false);
  await assert.rejects(
    collectVerificationProtocolEvidence(
      [
        ...events,
        { ...started(6, "foreign", "run_command"), runId: "run_other" },
      ],
      store([]),
      "PROTOCOL",
    ),
    /one Run/u,
  );
});

test("rejects mismatched invocation bindings and inconsistent captured arguments", async () => {
  const events = [started(1, "a", "run_command"), invoked(2), invoked(3)];
  await assert.rejects(
    collectVerificationProtocolEvidence(
      events,
      {
        async read() {
          return { sourceRunId: "run_other" };
        },
      },
      "PROTOCOL",
    ),
    /different invocation/u,
  );
  const mutable = {
    async read(hash) {
      return {
        sourceRunId: "run_one",
        contextEnvelopeSha256: hash.replace("hash", "envelope"),
        context: {
          messages: [
            { role: "assistant", content: [call("a", { code: hash })] },
          ],
        },
      };
    },
  };
  await assert.rejects(
    collectVerificationProtocolEvidence(events, mutable, "PROTOCOL"),
    /changed across capsules/u,
  );
});

test("treats missing capsules and no observed patches as incomplete observations", async () => {
  const result = await collectVerificationProtocolEvidence(
    [started(1, "a", "verify_workspace"), invoked(2)],
    {
      async read() {
        throw new Error("missing");
      },
    },
    "PROTOCOL",
  );
  assert.equal(result.complete, false);
  assert.equal(result.unavailableCapsules, 1);
  assert.equal(result.executions[0].phase, "no_patch_observed");
  assert.equal(result.executions[0].classification, "unknown");
});
