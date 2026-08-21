import { parseHTML } from "linkedom";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it } from "vitest";

import type { RunComparison } from "@napier/contracts";

import { RunHarnessComparison } from "../src/RunHarnessComparison";

const roots: ReturnType<typeof createRoot>[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
});

describe("RunHarnessComparison", () => {
  it("renders fairness blockers, metric deltas, and the hash-only receipt", async () => {
    const { document, window } = parseHTML("<main id='root'></main>");
    Object.assign(globalThis, { document, window, Event: window.Event });
    const container = document.querySelector("#root") as HTMLElement;
    const root = createRoot(container);
    roots.push(root);

    await act(async () =>
      root.render(<RunHarnessComparison harness={fixtureHarness()} />),
    );

    expect(container.textContent).toContain("Not comparable");
    expect(container.textContent).toContain("Repeated calls");
    expect(container.textContent).toContain("-1");
    expect(container.textContent).toContain("model_mismatched");
    expect(container.textContent).toContain("dddddddddddd");
    expect(container.textContent).toContain("999999999999");
    expect(container.textContent).toContain("888888888888");
    expect(container.textContent).not.toContain("private task");
  });
});

function fixtureHarness(): RunComparison["harness"] {
  const metric = (id: string, hash: string) => ({
    kind: "napier.run-harness-effect-metrics" as const,
    schemaVersion: 1 as const,
    algorithmVersion: "v1",
    runId: id,
    eventStreamSha256: hash,
    firstAction: {
      read: { status: "available" as const, elapsedMs: 100 },
      write: { status: "unavailable" as const },
      verify: { status: "unavailable" as const },
    },
    toolEfficiency: {
      startedCount: 1,
      classifiedActionCount: 1,
      hashedCallCount: 1,
      repeatedCallCount: 0,
      repeatedCallRate: 0,
      noNewInformationEligibleCount: 1,
      noNewInformationCount: 0,
      noNewInformationRate: 0,
    },
    contextTokens: {
      status: "available" as const,
      observationCount: 1,
      systemPromptEstimatedTokens: 10,
      toolDefinitionEstimatedTokens: 10,
      activeMessageEstimatedTokens: 80,
      activeEstimatedTotalTokens: 100,
      systemPromptTokenShare: 0.1,
      toolDefinitionTokenShare: 0.1,
    },
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
      firstReceiptSha256: hash,
      lastReceiptSha256: hash,
      resolutionSequenceSha256: hash,
    },
    taskOutcome: { status: "unavailable" as const },
    contentSha256: hash,
  });
  const left = metric("run_left", "a".repeat(64));
  const right = metric("run_right", "b".repeat(64));
  const matched = {
    status: "matched" as const,
    leftSha256: "6".repeat(64),
    rightSha256: "6".repeat(64),
  };
  return {
    left,
    right,
    delta: {
      firstReadElapsedMs: -20,
      firstWriteElapsedMs: null,
      firstVerifyElapsedMs: null,
      repeatedCallCount: -1,
      repeatedCallRate: -0.5,
      noNewInformationCount: 0,
      noNewInformationRate: 0,
      systemPromptTokenShare: -0.02,
      toolDefinitionTokenShare: -0.03,
      overflowAttemptCount: 0,
      overflowRecoveredCount: 0,
      overflowFailedCount: 0,
      interventionCount: -1,
      taskOutcomeChanged: false,
    },
    fairness: {
      kind: "napier.harness-comparison-fairness",
      schemaVersion: 1,
      status: "not_comparable",
      provider: matched,
      model: {
        status: "mismatched",
        leftSha256: "7".repeat(64),
        rightSha256: "8".repeat(64),
      },
      task: matched,
      environment: matched,
      budget: matched,
      diagnostics: ["model_mismatched"],
      leftMetricsSha256: left.contentSha256,
      rightMetricsSha256: right.contentSha256,
      contentSha256: "c".repeat(64),
    },
    harnessResolution: {
      status: "mismatched",
      leftSha256: "9".repeat(64),
      rightSha256: "8".repeat(64),
    },
    contentSha256: "d".repeat(64),
  };
}
