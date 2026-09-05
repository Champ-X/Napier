import type { JsonValue } from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { RunProgressTracker } from "../src/run-progress-vector.js";
import { ToolProtocolRegistry } from "../src/tool-protocol-registry.js";
import {
  cleanupProgressFixtures,
  createFixture,
  createRun,
  declaredTool,
  event,
  failureEvent,
  failureTurn,
  hash,
  supportTrace,
  supportTurn,
  timeoutFailure,
} from "./run-progress-vector-test-support.js";

afterEach(cleanupProgressFixtures);

describe("Run progress vector evidence convergence", () => {
  it("deduplicates stable support receipts and measures marginal yield", async () => {
    const fixture = await createFixture("support-yield");
    const run = await createRun(fixture);
    const tracker = await RunProgressTracker.create(fixture.store, run);
    const resource = hash("query:stable");
    const states = ["a", "a", "b", "a", "a"].map(hash);
    const vectors = [];

    for (const [index, state] of states.entries()) {
      await supportTurn(
        fixture.store,
        run,
        tracker,
        `search-${String(index)}`,
        "arbitrary_search_name",
        resource,
        state,
        { retrievedAt: `2026-09-0${String(index + 1)}T00:00:00Z` },
      ).then((vector) => vectors.push(vector));
    }

    expect(vectors[0]!.payload).toEqual(
      expect.objectContaining({
        progressed: false,
        supportProgressed: true,
        supportCount: 1,
        acquisitionAttemptCount: 1,
        stagnantTurnCount: 1,
      }),
    );
    expect(vectors[1]!.payload).toEqual(
      expect.objectContaining({
        progressed: false,
        supportProgressed: false,
        supportCount: 1,
        acquisitionAttemptCount: 2,
        stagnantTurnCount: 2,
      }),
    );
    expect(vectors.at(-1)!.payload).toEqual(
      expect.objectContaining({
        supportCount: 2,
        supportResourceCount: 1,
        acquisitionAttemptCount: 5,
        acquisitionAttemptCountSinceProgress: 5,
        acquisitionAdvanceCountSinceProgress: 2,
        stagnantTurnCount: 5,
      }),
    );
    expect(
      (await fixture.store.listRunEvents(run.id)).find(
        (candidate) => candidate.type === "run.progress.convergence_requested",
      )?.payload,
    ).toEqual(
      expect.objectContaining({
        reason: "support_phase",
        turnIndex: 5,
        acquisitionAttemptCountSinceProgress: 5,
        acquisitionAdvanceCountSinceProgress: 2,
      }),
    );
    fixture.store.close();
  });

  it("makes the same convergence decision across prompt languages and tool names", async () => {
    const chinese = await supportTrace(
      "invariant-cn",
      "查找资料后完成交付。",
      "search_alpha",
    );
    const english = await supportTrace(
      "invariant-en",
      "Gather evidence and then deliver.",
      "totally_different_tool",
    );

    expect(chinese).toEqual(english);
    expect(chinese).toEqual({
      reason: "support_phase",
      turnIndex: 5,
      acquisitionAttemptCount: 5,
      supportCount: 2,
    });
  });

  it("keeps a high-yield evidence phase open instead of enforcing a fixed turn cap", async () => {
    const fixture = await createFixture("high-yield");
    const run = await createRun(fixture);
    const tracker = await RunProgressTracker.create(fixture.store, run);
    for (let index = 0; index < 8; index += 1) {
      await supportTurn(
        fixture.store,
        run,
        tracker,
        `high-yield-${String(index)}`,
        "collector",
        hash(`resource-${String(index)}`),
        hash(`state-${String(index)}`),
      );
    }
    const events = await fixture.store.listRunEvents(run.id);
    expect(
      events.some(
        (candidate) =>
          candidate.type === "run.progress.convergence_requested" ||
          candidate.type === "run.progress.rerouted",
      ),
    ).toBe(false);
    expect(
      events
        .filter((candidate) => candidate.type === "run.progress.vector")
        .at(-1)?.payload,
    ).toEqual(
      expect.objectContaining({
        acquisitionAttemptCount: 8,
        supportCount: 8,
        stagnantTurnCount: 8,
      }),
    );
    fixture.store.close();
  });

  it("opens one cross-tool failure domain instead of retrying an origin forever", async () => {
    const fixture = await createFixture("failure-domain");
    const run = await createRun(fixture);
    const first = declaredTool("http_reader", ["acquire"], "shared-origin");
    const second = declaredTool(
      "browser_navigator",
      ["acquire"],
      "shared-origin",
    );
    const registry = new ToolProtocolRegistry([first, second]);
    const tracker = await RunProgressTracker.create(
      fixture.store,
      run,
      undefined,
      { prompt: "opaque", toolNames: [first.name, second.name] },
      undefined,
      registry,
    );

    for (const [index, tool] of [first, second, first].entries()) {
      const args = { target: `https://same.test/path-${String(index)}` };
      const protocol = registry
        .require(tool.name)
        .uiProjection("failed", args, undefined, true);
      await event(fixture.store, run, "tool.failed", {
        callId: `failure-${String(index)}`,
        toolName: tool.name,
        status: "failed",
        toolProtocol: protocol as unknown as JsonValue,
        toolFailure: timeoutFailure(`failure-${String(index)}`),
      });
    }
    await event(fixture.store, run, "turn.completed", {});
    const vector = await tracker.recordTurn();
    expect(vector.payload).toEqual(
      expect.objectContaining({
        failureFingerprintCount: 3,
        failureDomainCount: 1,
        acquisitionAttemptCount: 0,
      }),
    );
    await expect(
      tracker.preflightTool("fourth-route", second.name, {
        target: "https://same.test/different-path",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        block: true,
        reason: expect.stringContaining("failure domain is open"),
      }),
    );
    fixture.store.close();
  });

  it("rehydrates stable receipt and marginal-yield state from the ledger", async () => {
    const fixture = await createFixture("rehydrate");
    const run = await createRun(fixture);
    const first = await RunProgressTracker.create(fixture.store, run);
    const resource = hash("rehydrated-resource");
    const state = hash("rehydrated-state");
    const firstVector = await supportTurn(
      fixture.store,
      run,
      first,
      "before-restart",
      "reader",
      resource,
      state,
    );

    const restored = await RunProgressTracker.create(fixture.store, run);
    const secondVector = await supportTurn(
      fixture.store,
      run,
      restored,
      "after-restart",
      "reader",
      resource,
      state,
    );
    expect(secondVector.payload).toEqual(
      expect.objectContaining({
        turnIndex: 2,
        supportProgressed: false,
        supportCount: 1,
        acquisitionAttemptCount: 2,
        acquisitionAttemptCountSinceProgress: 2,
        acquisitionAdvanceCountSinceProgress: 1,
        predecessorContentSha256: firstVector.payload["contentSha256"],
      }),
    );
    fixture.store.close();
  });

  it("converges the historical search/fetch/browser failure shape before churn", async () => {
    const fixture = await createFixture("historical-shape");
    const run = await createRun(fixture);
    const acquire = declaredTool("any_acquisition", ["acquire"]);
    const registry = new ToolProtocolRegistry([acquire]);
    const tracker = await RunProgressTracker.create(
      fixture.store,
      run,
      undefined,
      { prompt: "opaque", toolNames: [acquire.name] },
      undefined,
      registry,
    );

    await supportTurn(
      fixture.store,
      run,
      tracker,
      "search-success",
      acquire.name,
      hash("search-query"),
      hash("ten-results"),
    );
    await failureTurn(fixture.store, run, tracker, [
      failureEvent("fetch-403", "fetch-route", "origin-a"),
      failureEvent("fetch-timeout", "fetch-route", "origin-b"),
    ]);
    const third = await failureTurn(fixture.store, run, tracker, [
      failureEvent("browser-timeout", "browser-route", "origin-c"),
    ]);

    expect(third.payload).toEqual(
      expect.objectContaining({
        turnIndex: 3,
        failureDomainCount: 3,
        acquisitionAttemptCountSinceProgress: 4,
      }),
    );
    const events = await fixture.store.listRunEvents(run.id);
    expect(
      events.find(
        (candidate) => candidate.type === "run.progress.convergence_requested",
      )?.payload,
    ).toEqual(
      expect.objectContaining({
        reason: "failure_pressure",
        turnIndex: 3,
      }),
    );
    expect(
      tracker.toolsForNextTurn([acquire])?.map((tool) => tool.name),
    ).toEqual([]);
    expect(
      events.some(
        (candidate) => candidate.type === "run.research.budget_exhausted",
      ),
    ).toBe(false);
    fixture.store.close();
  });
});
