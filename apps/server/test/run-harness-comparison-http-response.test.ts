import type { RunComparison } from "@napier/contracts";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { setRunComparisonHeaders } from "../src/thread-replay-http-response.js";

describe("Run Harness comparison HTTP evidence", () => {
  it("mirrors no-store fairness, counts, and receipt hashes without raw content", async () => {
    const comparison = fixtureComparison();
    const app = new Hono();
    app.get("/comparison", (context) => {
      setRunComparisonHeaders(context, comparison);
      return context.json(comparison);
    });

    const response = await app.request("/comparison");

    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-napier-harness-fairness-status")).toBe(
      "comparable",
    );
    expect(response.headers.get("x-napier-harness-fairness-provider")).toBe(
      "matched",
    );
    expect(
      response.headers.get("x-napier-left-harness-repeated-call-count"),
    ).toBe("1");
    expect(
      response.headers.get("x-napier-right-harness-no-new-information-count"),
    ).toBe("1");
    expect(response.headers.get("x-napier-harness-comparison-sha256")).toBe(
      "d".repeat(64),
    );
    expect(response.headers.get("x-napier-harness-resolution-status")).toBe(
      "matched",
    );
    expect(
      response.headers.get("x-napier-left-harness-resolution-sha256"),
    ).toBe("9".repeat(64));
    expect([...response.headers.entries()].join("\n")).not.toContain(
      "private task",
    );
  });
});

function fixtureComparison(): RunComparison {
  const emptyMetrics = {
    durationMs: 0,
    eventCount: 0,
    messageCount: 0,
    modelResponseCount: 0,
    modelContextEnvelopeCount: 0,
    embeddedModelContextEnvelopeCount: 0,
    modelContextBoundResponseCount: 0,
    modelContextUnboundResponseCount: 0,
    toolCallCount: 0,
    toolCompletedCount: 0,
    toolFailedCount: 0,
    toolBlockedCount: 0,
    subagentCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
    assistantTextSha256: "0".repeat(64),
  };
  const snapshot = (id: string, hash: string) => ({
    schemaVersion: 1 as const,
    threadId: "thread_12345678",
    run: {
      id,
      threadId: "thread_12345678",
      agentId: "agent_default",
      status: "completed" as const,
      startedAt: "2026-08-21T00:00:00.000Z",
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
      },
    },
    metrics: emptyMetrics,
    events: [],
    subagents: [],
    eventStreamSha256: hash,
    generatedAt: "2026-08-21T00:00:00.000Z",
    contentSha256: hash,
  });
  const harnessMetrics = (id: string, hash: string) => ({
    kind: "napier.run-harness-effect-metrics" as const,
    schemaVersion: 1 as const,
    algorithmVersion: "v1",
    runId: id,
    eventStreamSha256: hash,
    firstAction: {
      read: { status: "unavailable" as const },
      write: { status: "unavailable" as const },
      verify: { status: "unavailable" as const },
    },
    toolEfficiency: {
      startedCount: 2,
      classifiedActionCount: 2,
      hashedCallCount: 2,
      repeatedCallCount: 1,
      repeatedCallRate: 0.5,
      noNewInformationEligibleCount: 2,
      noNewInformationCount: 1,
      noNewInformationRate: 0.5,
    },
    contextTokens: { status: "unavailable" as const, observationCount: 0 },
    overflow: {
      attemptCount: 0,
      recoveredCount: 0,
      failedCount: 0,
      unavailableCount: 0,
    },
    interventions: {
      count: 0,
      reasonCounts: {},
      reasonSetSha256: "5".repeat(64),
    },
    harnessResolution: {
      status: "available" as const,
      observationCount: 1,
      validReceiptCount: 1,
      distinctReceiptCount: 1,
      firstReceiptSha256: "8".repeat(64),
      lastReceiptSha256: "8".repeat(64),
      resolutionSequenceSha256: "9".repeat(64),
    },
    taskOutcome: { status: "unavailable" as const },
    contentSha256: hash,
  });
  const dimension = {
    status: "matched" as const,
    leftSha256: "6".repeat(64),
    rightSha256: "6".repeat(64),
  };
  const left = harnessMetrics("run_left1234", "a".repeat(64));
  const right = harnessMetrics("run_right123", "b".repeat(64));
  return {
    threadId: "thread_12345678",
    left: snapshot("run_left1234", "1".repeat(64)),
    right: snapshot("run_right123", "2".repeat(64)),
    metricDelta: { ...emptyMetrics, assistantTextSha256: undefined } as never,
    outputChanged: false,
    eventTypeDelta: {},
    addedToolNames: [],
    removedToolNames: [],
    configurationDelta: {
      status: "unavailable",
      changedFields: [],
      addedTools: [],
      removedTools: [],
      addedSkills: [],
      removedSkills: [],
      addedSubagents: [],
      removedSubagents: [],
    },
    contextCoverageDelta: {
      status: "clean",
      left: {
        modelResponseCount: 0,
        envelopeCount: 0,
        embeddedEnvelopeCount: 0,
        boundResponseCount: 0,
        unboundResponseCount: 0,
        coverageRate: 1,
      },
      right: {
        modelResponseCount: 0,
        envelopeCount: 0,
        embeddedEnvelopeCount: 0,
        boundResponseCount: 0,
        unboundResponseCount: 0,
        coverageRate: 1,
      },
      coverageRateDelta: 0,
      embeddedEnvelopeDelta: 0,
      diagnostics: [],
    },
    traceSummaryBoundaryDelta: {
      status: "clean",
      left: { total: 0, dedicated: 0, generic: 0, genericEventTypes: [] },
      right: { total: 0, dedicated: 0, generic: 0, genericEventTypes: [] },
      dedicatedDelta: 0,
      genericDelta: 0,
      diagnostics: [],
      genericEventTypes: [],
    },
    harness: {
      left,
      right,
      delta: {
        firstReadElapsedMs: null,
        firstWriteElapsedMs: null,
        firstVerifyElapsedMs: null,
        repeatedCallCount: 0,
        repeatedCallRate: 0,
        noNewInformationCount: 0,
        noNewInformationRate: 0,
        systemPromptTokenShare: null,
        toolDefinitionTokenShare: null,
        overflowAttemptCount: 0,
        overflowRecoveredCount: 0,
        overflowFailedCount: 0,
        interventionCount: 0,
        taskOutcomeChanged: false,
      },
      fairness: {
        kind: "napier.harness-comparison-fairness",
        schemaVersion: 1,
        status: "comparable",
        provider: dimension,
        model: dimension,
        task: dimension,
        environment: dimension,
        budget: dimension,
        diagnostics: [],
        leftMetricsSha256: left.contentSha256,
        rightMetricsSha256: right.contentSha256,
        contentSha256: "c".repeat(64),
      },
      harnessResolution: {
        status: "matched",
        leftSha256: "9".repeat(64),
        rightSha256: "9".repeat(64),
      },
      contentSha256: "d".repeat(64),
    },
  };
}
