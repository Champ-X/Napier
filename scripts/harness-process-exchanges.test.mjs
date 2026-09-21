import { expect, it } from "vitest";
import { auditProcessExchanges } from "./harness-process-exchanges.mjs";

function fixture() {
  const events = ["input", "poll"].map((action, i) => ({
    type: "tool.completed",
    runId: "run",
    seq: i + 1,
    payload: {
      toolName: "workspace_process",
      callId: `call_${i}`,
      details: { action, processId: "process" },
    },
  }));
  events.push({
    type: "context.model_invocation",
    runId: "run",
    payload: { capsuleSha256: "capsule", contextEnvelopeSha256: "envelope" },
  });
  const messages = [
    {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "call_0",
          name: "workspace_process",
          arguments: {
            action: "input",
            processId: "process",
            text: '{"value":2}',
            appendNewline: true,
          },
        },
        {
          type: "toolCall",
          id: "call_1",
          name: "workspace_process",
          arguments: { action: "poll", processId: "process" },
        },
      ],
    },
    {
      role: "toolResult",
      toolCallId: "call_1",
      content: [
        { type: "text", text: 'Process\nOUTPUT\n[stdout @1]\n{"answer":4}\n' },
      ],
    },
  ];
  const evidence = {
    matchingProcessIds: ["process"],
    requirements: {
      jsonExchanges: [{ input: { value: 2 }, output: { answer: 4 } }],
    },
  };
  const capsule = {
    sourceRunId: "run",
    contextEnvelopeSha256: "envelope",
    context: { messages },
  };
  return {
    events,
    messages,
    evidence,
    capsule,
    capsules: { read: async () => capsule },
  };
}

it("checks observed replies after actual input without retaining raw text", async () => {
  const f = fixture();
  const result = await auditProcessExchanges(f.events, f.capsules, f.evidence);
  expect(result.passed).toBe(true);
  expect(JSON.stringify(result)).not.toContain("answer");
});

it("rejects requested-but-unobserved replies, wrong input and output predating input", async () => {
  const f = fixture();
  f.messages[1].content[0].text = 'Agent report: {"answer":4}';
  expect(
    (await auditProcessExchanges(f.events, f.capsules, f.evidence)).passed,
  ).toBe(false);
  const wrong = fixture();
  wrong.messages[0].content[0].arguments.text = '{"value":3}';
  expect(
    (await auditProcessExchanges(wrong.events, wrong.capsules, wrong.evidence))
      .passed,
  ).toBe(false);
  const order = fixture();
  order.events[1].seq = 0;
  expect(
    (await auditProcessExchanges(order.events, order.capsules, order.evidence))
      .passed,
  ).toBe(false);
});

it("fails closed for missing capsules and mismatched invocation identities", async () => {
  const f = fixture();
  expect(
    (
      await auditProcessExchanges(
        f.events,
        {
          read: async () => {
            throw new Error("missing");
          },
        },
        f.evidence,
      )
    ).passed,
  ).toBe(false);
  f.capsule.sourceRunId = "foreign";
  await expect(
    auditProcessExchanges(f.events, f.capsules, f.evidence),
  ).rejects.toThrow("binding");
});
