import { expect, it } from "vitest";
import { collectUsageEvidence } from "./harness-usage-evidence.mjs";
const usage = (n) => ({
  inputTokens: n,
  outputTokens: n,
  cacheReadTokens: n,
  cacheWriteTokens: 0,
  costUsd: n / 1000,
});
const event = (id, type, n, extra = {}) => ({
  id,
  runId: "r",
  type,
  payload: { ...(n === undefined ? {} : { usage: usage(n) }), ...extra },
});
it("accounts for auxiliary and discarded calls, excludes mirrored assistant usage and binds receipts to the Run", () => {
  const events = [
    event("a", "model.response", 100),
    event("b", "message.assistant", 100),
    event("c", "memory.extraction.completed", 10),
    event("d", "model.thinking_loop.detected", 20, {
      usageSource: "provider_terminal",
    }),
    event("e", "model.context.overflow", 30),
  ];
  const result = collectUsageEvidence({ id: "r", usage: usage(160) }, events);
  expect(result.eligibleForObservedUsageComparison).toBe(true);
  expect(result.observedUsage.inputTokens).toBe(160);
  expect(result.legacyResponseOnlyUsage.inputTokens).toBe(100);
  expect(result.receipts).toHaveLength(4);
  expect(result.contentSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(
    collectUsageEvidence({ id: "r", usage: usage(100) }, events).blockers,
  ).toContain("persisted_run_usage_mismatch");
});
it("retains totals but rejects missing, estimated, duplicate, invalid or foreign usage evidence", () => {
  for (const extra of [
    event("b", "model.thinking_loop.detected"),
    event("b", "model.thinking_loop.detected", 0),
    event("a", "model.response", 0),
    { ...event("b", "model.response", 0), runId: "foreign" },
    event("b", "model.response", 0, { usage: usage(NaN) }),
  ])
    expect(
      collectUsageEvidence({ id: "r", usage: usage(10) }, [
        event("a", "model.response", 10),
        extra,
      ]).eligibleForObservedUsageComparison,
    ).toBe(false);
});

it("keeps unknown child physical usage ineligible even when the known subtotal reconciles", () => {
  const task = { id: "childtask", runId: "r", childRunId: "childrun", usage: usage(0), usageStatus: "incomplete" };
  const parent = collectUsageEvidence({ id: "r", usage: usage(10) }, [event("a", "model.response", 10)], [task]);
  expect(parent.observedUsage).toEqual(usage(10));
  expect(parent.blockers).toContain("childtask: incomplete_subagent_usage");
  expect(parent.eligibleForObservedUsageComparison).toBe(false);
  const child = collectUsageEvidence({ id: "r", source: "subagent", usage: usage(0), usageStatus: "incomplete" }, [
    event("b", "model.response", undefined, { usageStatus: "unknown" }),
  ]);
  expect(child.blockers).toEqual(expect.arrayContaining(["incomplete_run_usage", "b: unknown_physical_usage", "b: missing_response_usage"]));
  expect(child.eligibleForObservedUsageComparison).toBe(false);
  const known = collectUsageEvidence({ id: "r", usage: usage(12) }, [event("a", "model.response", 10)], [
    { ...task, usage: usage(2), usageStatus: "complete" },
  ]);
  expect(known.eligibleForObservedUsageComparison).toBe(true);
});
