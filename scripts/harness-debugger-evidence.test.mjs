import assert from "node:assert/strict";
import { test } from "vitest";
import { collectDebuggerEvidence } from "./harness-debugger-evidence.mjs";
import { canonicalJson, sha256 } from "../packages/runtime/dist/ed25519.js";
const requirements = {
  runtime: "python",
  sourcePath: "target.py",
  breakpointLine: 5,
  requiredActions: ["stack_trace", "scopes", "variables", "evaluate"],
  variables: { amount: "27" },
  evaluation: { expression: "amount + 4", result: "31" },
};
function fixture() {
  const events = [],
    messages = [];
  for (const [index, action, data] of [
    [1, "stack_trace", { stackFrames: [{ id: 1, line: 5 }] }],
    [2, "scopes", { scopes: [{ name: "Locals", variablesReference: 7 }] }],
    [3, "variables", { variables: [{ name: "amount", value: "27" }] }],
    [4, "evaluate", { result: "31" }],
  ]) {
    const id = `call_${index}`;
    const input = {
      runtime: "python",
      action,
      processId: "process_fixture",
      ...(action === "evaluate"
        ? { expression: "amount + 4", frameId: 1 }
        : {}),
      ...(action === "scopes" ? { frameId: 1 } : {}),
      ...(action === "variables" ? { variablesReference: 7 } : {}),
    };
    const body = {
      kind: "napier.python-debugger",
      action,
      processId: "process_fixture",
      sourcePath: "target.py",
      sourceSha256: "a".repeat(64),
      isolation: "oci",
      data,
    };
    const resultSha256 = sha256(canonicalJson(body));
    events.push(
      {
        id: `started_${index}`,
        runId: "run_fixture",
        type: "tool.started",
        payload: { callId: id, toolName: "node_debugger", effect: "write" },
      },
      {
        id: `completed_${index}`,
        runId: "run_fixture",
        type: "tool.completed",
        payload: {
          callId: id,
          toolName: "node_debugger",
          details: { resultSha256 },
        },
      },
    );
    messages.push(
      {
        role: "assistant",
        content: [
          { type: "toolCall", name: "node_debugger", id, arguments: input },
        ],
      },
      {
        role: "toolResult",
        toolName: "node_debugger",
        toolCallId: id,
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ...body,
              resultSha256,
              untrustedLiveData: true,
            }),
          },
        ],
      },
    );
  }
  events.push({
    runId: "run_fixture",
    type: "context.model_invocation",
    payload: {
      capsuleSha256: "capsule_fixture",
      contextEnvelopeSha256: "envelope_fixture",
    },
  });
  const capsule = {
    sourceRunId: "run_fixture",
    contextEnvelopeSha256: "envelope_fixture",
    context: { messages },
  };
  return {
    events,
    capsule,
    run: () =>
      collectDebuggerEvidence(
        events,
        { read: async () => capsule },
        requirements,
        { "target.py": "a".repeat(64) },
        { canonicalJson, sha256 },
      ),
  };
}
test("requires actual original-source observations and retains only evidence hashes", async () => {
  const result = await fixture().run();
  assert.equal(result.passed, true);
  assert.equal(result.processes[0].observations.length, 4);
  assert.ok(!JSON.stringify(result).includes("amount"));
});
test("tool names and a report cannot replace missing observed values", async () => {
  const f = fixture();
  f.capsule.context.messages.splice(7, 1);
  assert.equal((await f.run()).passed, false);
});
test("rejects forged output, foreign runs, read effects and wrong expression", async () => {
  for (const mutate of [
    (f) => {
      f.capsule.context.messages[7].content[0].text =
        f.capsule.context.messages[7].content[0].text.replace("31", "32");
    },
    (f) => {
      f.capsule.sourceRunId = "run_foreign";
    },
    (f) => {
      f.events[0].payload.effect = "read";
    },
    (f) => {
      f.capsule.context.messages[6].content[0].arguments.expression = "31";
    },
  ]) {
    const f = fixture();
    mutate(f);
    assert.equal((await f.run()).passed, false);
  }
});
test("requires observations from the same process and the original source", async () => {
  for (const field of ["sourceSha256", "processId"]) {
    const f = fixture(),
      message = f.capsule.context.messages[7];
    const {
      resultSha256: old,
      untrustedLiveData,
      ...body
    } = JSON.parse(message.content[0].text);
    body[field] = field === "sourceSha256" ? "b".repeat(64) : "process_other";
    const resultSha256 = sha256(canonicalJson(body));
    message.content[0].text = JSON.stringify({
      ...body,
      resultSha256,
      untrustedLiveData,
    });
    f.events[7].payload.details.resultSha256 = resultSha256;
    f.capsule.context.messages[6].content[0].arguments.processId =
      body.processId;
    assert.equal((await f.run()).passed, false);
  }
});

test("does not combine values from another frame or a resumed pause", async () => {
  for (const mutate of [
    (f) => {
      f.capsule.context.messages[6].content[0].arguments.frameId = 2;
    },
    (f) => {
      f.capsule.context.messages[4].content[0].arguments.variablesReference = 9;
    },
    (f) => {
      f.events.splice(4, 0, {
        type: "tool.completed",
        payload: {
          toolName: "node_debugger",
          details: { processId: "process_fixture", action: "next" },
        },
      });
    },
  ]) {
    const f = fixture();
    mutate(f);
    assert.equal((await f.run()).passed, false);
  }
});
