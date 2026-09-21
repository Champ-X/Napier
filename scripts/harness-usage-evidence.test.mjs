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
