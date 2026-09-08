import {
  fauxAssistantMessage,
  fauxToolCall,
  type Message,
  type StreamOptions,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalJson, sha256 } from "../src/ed25519.js";
import { LocalStore } from "../src/store.js";
import { RunBudgetTracker } from "../src/run-budget.js";
import { RunContextCompactor } from "../src/run-context-compaction.js";
import {
  completeContextUnits,
  pinnedContextUsers,
} from "../src/run-context-compaction-boundary.js";
import {
  checkpointMatchesSource,
  parseRunContextCheckpoint,
} from "../src/run-context-checkpoint.js";
import { modelContextMessageSetSha256 } from "../src/token-meter-content.js";
import { projectModelContextTokenPressureWithProvider } from "../src/model-context-token-pressure.js";
import { cleanupProgressFixtures } from "./run-progress-vector-test-support.js";
import {
  compactionFixture,
  exchange,
  summary,
  transcript,
} from "./run-context-compaction-test-support.js";

afterEach(cleanupProgressFixtures);

describe("Run context working-set compaction", () => {
  it("preserves user corrections and complete tool batches, and reuses durable checkpoints incrementally", async () => {
    const f = await compactionFixture();
    const context = transcript();
    context.messages.splice(13, 0, {
      role: "user",
      content: "Correction: do not change the title or publish the result.",
      timestamp: 7,
    });
    const source = structuredClone(context);
    const first = await f.compactor.project(f.input(context));
    expect(first.receiptSha256).toBeDefined();
    expect(first.context.messages.length).toBeLessThan(context.messages.length);
    expect(pinnedContextUsers(first.context.messages)).toEqual(
      pinnedContextUsers(context.messages),
    );
    expect(() => completeContextUnits(first.context.messages)).not.toThrow();
    expect(context).toEqual(source);
    const calls = f.provider.state.callCount;
    await f.store.close();
    const reopened = new LocalStore({
      dataRoot: f.store.dataRoot,
      workspaceRoot: f.store.workspaceRoot,
    });
    await reopened.initialize();
    f.host.store = reopened;
    const recovered = await f.createCompactor().project(f.input(context));
    expect(recovered.context).toEqual(first.context);
    expect(f.provider.state.callCount).toBe(calls);
    context.messages.push(
      ...Array.from({ length: 9 }, (_, index) => exchange(12 + index)).flat(),
    );
    const next = await f.compactor.project(f.input(context));
    expect(next.receiptSha256).toBeDefined();
    expect(f.provider.state.callCount).toBeGreaterThan(calls);
    const checkpoints = (await reopened.listRunEvents(f.run.id))
      .filter((event) => event.type === "context.run_compaction.completed")
      .map((event) => parseRunContextCheckpoint(event.payload)!);
    expect(checkpoints.length).toBeGreaterThan(1);
    expect(checkpoints.at(-1)!.parentCheckpointSha256).toBe(
      checkpoints.at(-2)!.contentSha256,
    );
    expect(checkpoints.at(-1)!.sourceMessageCount).toBeGreaterThan(
      checkpoints[0]!.sourceMessageCount,
    );
    expect(f.budget.observed().turns).toBe(0);
    expect(f.budget.observed().rawTotalTokens).toBeGreaterThan(0);
    await reopened.close();
  });

  it("summarizes oversized sources in bounded incremental requests until the working set fits", async () => {
    const f = await compactionFixture(8_000);
    const context = transcript(40, 4_000);
    let calls = 0;
    f.provider.setResponses(
      Array.from({ length: 40 }, () => (request) => {
        calls++;
        expect(JSON.stringify(request.messages).length).toBeLessThan(60_000);
        return fauxAssistantMessage(JSON.stringify(summary));
      }),
    );
    const result = await f.compactor.project(f.input(context));
    expect(calls).toBeGreaterThan(4);
    expect(result.context.messages.length).toBeLessThan(8);
    expect(result.context.messages.at(-1)).toEqual(context.messages.at(-1));
    await f.store.close();
  });

  it("charges compactor usage to the original budget and cannot commit after budget exhaustion", async () => {
    const f = await compactionFixture();
    const budget = new RunBudgetTracker({
      maxTurns: 64,
      maxTotalTokens: 10,
      maxCostUsd: 100,
      timeoutMs: 60_000,
    });
    const compactor = new RunContextCompactor(f.host, f.run, budget, () => 0);
    await expect(compactor.project(f.input(transcript()))).rejects.toThrow(
      "Run budget exhausted",
    );
    expect(budget.observed().rawTotalTokens).toBeGreaterThan(10);
    expect(budget.observed().turns).toBe(0);
    expect(
      (await f.store.listRunEvents(f.run.id)).filter(
        (event) => event.type === "context.run_compaction.completed",
      ),
    ).toHaveLength(0);
    await f.store.close();
  });

  it("uses the serving route's credentials and transport without exposing credentials or reusing primary callbacks", async () => {
    const f = await compactionFixture();
    const received: StreamOptions[] = [];
    f.provider.setResponses(
      Array.from({ length: 20 }, () => (_context, options) => {
        received.push(options!);
        return fauxAssistantMessage(JSON.stringify(summary));
      }),
    );
    const input = f.input(transcript());
    const projected = await f.compactor.project({
      ...input,
      options: {
        ...input.options,
        apiKey: "test-route-only-credential",
        headers: { "x-route": "selected-endpoint" },
        env: { TEST_ROUTE_REGION: "test" },
        timeoutMs: 5_000,
        maxRetries: 0,
        sessionId: "primary-session",
        onPayload: () => {
          throw new Error("primary callback must stay isolated");
        },
      },
    });
    expect(projected.receiptSha256).toBeDefined();
    expect(received.length).toBeGreaterThan(0);
    for (const options of received) {
      expect(options).toMatchObject({
        apiKey: "test-route-only-credential",
        headers: { "x-route": "selected-endpoint" },
        env: { TEST_ROUTE_REGION: "test" },
        timeoutMs: 5_000,
        maxRetries: 0,
        maxTokens: 1_200,
      });
      expect(options.onPayload).toBeUndefined();
      expect(options.sessionId).toBeUndefined();
    }
    expect(JSON.stringify(await f.store.listRunEvents(f.run.id))).not.toContain(
      "test-route-only-credential",
    );
    await f.store.close();
  });

  it("compacts old images as evidence references while retaining the newest image", async () => {
    const f = await compactionFixture(12_000);
    const context = transcript(4, 50);
    for (const message of context.messages)
      if (message.role === "toolResult")
        message.content.push({
          type: "image",
          mimeType: "image/png",
          data: "private-image-payload",
        });
    let compactorInput = "";
    f.provider.setResponses([
      (input) => {
        compactorInput = JSON.stringify(input);
        return fauxAssistantMessage(JSON.stringify(summary));
      },
    ]);
    const projected = await f.compactor.project(f.input(context));
    expect(projected.receiptSha256).toBeDefined();
    expect(compactorInput).not.toContain("private-image-payload");
    expect(compactorInput).toContain("image/png");
    expect(projected.context.messages.at(-1)).toEqual(context.messages.at(-1));
    expect(
      projected.context.messages.filter(
        (message) => message.role === "toolResult",
      ),
    ).toHaveLength(1);
    await f.store.close();
  });

  it("rejects non-shrinking summaries and does not call the model again for the same failed prefix", async () => {
    const f = await compactionFixture();
    const context = transcript(2, 400);
    f.provider.setResponses([
      fauxAssistantMessage(
        JSON.stringify({ ...summary, summary: "verbose ".repeat(500) }),
      ),
    ]);
    const first = await f.compactor.project(f.input(context, 1));
    expect(first.context).toBe(context);
    expect(first.recoveryReduced).toBe(false);
    const second = await f.createCompactor().project(f.input(context, 1));
    expect(second.context).toBe(context);
    expect(f.provider.state.callCount).toBe(1);
    expect(
      (await f.store.listRunEvents(f.run.id)).filter(
        (event) => event.type === "context.run_compaction.completed",
      ),
    ).toHaveLength(0);
    await f.store.close();
  });

  it("can shrink an already checkpointed request again after provider overflow", async () => {
    const f = await compactionFixture(24_000);
    const source = transcript(18);
    const first = await f.compactor.project(f.input(source));
    expect(first.receiptSha256).toBeDefined();
    expect(
      first.context.messages.filter((message) => message.role === "toolResult")
        .length,
    ).toBeGreaterThan(1);
    const retried = await f.compactor.project({
      ...f.input(source, 1),
      context: first.context,
    });
    expect(retried.recoveryReduced).toBe(true);
    expect(retried.context.messages.length).toBeLessThan(
      first.context.messages.length,
    );
    expect(pinnedContextUsers(retried.context.messages)).toEqual(
      pinnedContextUsers(source.messages),
    );
    expect(retried.context.messages.at(-1)).toEqual(source.messages.at(-1));
    await f.store.close();
  });

  it("does not let the final token governor discard checkpoint-pinned user requirements", async () => {
    const f = await compactionFixture();
    const source = transcript();
    source.messages.splice(13, 0, {
      role: "user",
      content: "Also retain all original source citations.",
      timestamp: 7,
    });
    const input = f.input(source);
    const checkpointed = await f.compactor.project(input);
    expect(checkpointed.receiptSha256).toBeDefined();
    const pressure = await projectModelContextTokenPressureWithProvider(
      {
        ...input,
        ...checkpointed,
        model: { ...input.model, contextWindow: 256 },
      },
      input.tokenMeters,
    );
    expect(pressure.receipt.status).toBe("unavailable");
    expect(pressure.receipt.removedMessageCount).toBe(0);
    expect(pinnedContextUsers(pressure.context.messages)).toEqual(
      pinnedContextUsers(source.messages),
    );
    await f.store.close();
  });

  it.each([
    [
      "truncated",
      fauxAssistantMessage(JSON.stringify(summary), { stopReason: "length" }),
    ],
    ["invalid", fauxAssistantMessage('{"summary":"missing required lists"}')],
  ])(
    "keeps the last durable checkpoint when a later summary is %s",
    async (_label, response) => {
      const f = await compactionFixture();
      const source = transcript();
      const first = await f.compactor.project(f.input(source));
      const checkpointCount = (await f.store.listRunEvents(f.run.id)).filter(
        (event) => event.type === "context.run_compaction.completed",
      ).length;
      const previousSourceCount = source.messages.length;
      source.messages.push(
        ...Array.from({ length: 9 }, (_, index) => exchange(12 + index)).flat(),
      );
      f.provider.setResponses([response]);
      const fallback = await f.compactor.project(f.input(source));
      expect(fallback.context.messages).toEqual([
        ...first.context.messages,
        ...source.messages.slice(previousSourceCount),
      ]);
      const events = await f.store.listRunEvents(f.run.id);
      expect(
        events.filter(
          (event) => event.type === "context.run_compaction.completed",
        ),
      ).toHaveLength(checkpointCount);
      expect(
        events.filter(
          (event) => event.type === "context.run_compaction.failed",
        ),
      ).toHaveLength(1);
      await f.store.close();
    },
  );

  it("never splits a parallel batch, accepts out-of-order results, and rejects pending or duplicate calls", () => {
    const a = exchange(1),
      b = exchange(2);
    const batch = [
      fauxAssistantMessage([
        fauxToolCall("read_file", {}, { id: "call-1" }),
        fauxToolCall("read_file", {}, { id: "call-2" }),
      ]),
      b[1]!,
      a[1]!,
    ];
    expect(completeContextUnits(batch)).toEqual([
      { start: 0, end: 3, user: false },
    ]);
    expect(() => completeContextUnits(batch.slice(0, 2))).toThrow("incomplete");
    expect(() => completeContextUnits([...a, ...a])).toThrow("reuses");
    expect(() => completeContextUnits([a[1]!])).toThrow("orphan");
  });

  it("rejects changed source content and checkpoint tampering", async () => {
    const f = await compactionFixture();
    const context = transcript();
    await f.compactor.project(f.input(context));
    const checkpointEvent = (await f.store.listRunEvents(f.run.id)).find(
      (event) => event.type === "context.run_compaction.completed",
    )!;
    const checkpoint = parseRunContextCheckpoint(checkpointEvent.payload)!;
    expect(checkpointMatchesSource(checkpoint, f.run.id, context)).toBe(true);
    const changed = structuredClone(context);
    (changed.messages[0] as Extract<Message, { role: "user" }>).content =
      "Changed requirement";
    expect(checkpointMatchesSource(checkpoint, f.run.id, changed)).toBe(false);
    expect(checkpointMatchesSource(checkpoint, "another-run", context)).toBe(
      false,
    );
    expect(
      parseRunContextCheckpoint({ ...checkpoint, sourceMessageCount: 1 }),
    ).toBeUndefined();
    const { contentSha256: _hash, ...content } = {
      ...checkpoint,
      summary: { ...checkpoint.summary, summary: "tampered" },
    };
    expect(
      parseRunContextCheckpoint({
        ...content,
        contentSha256: sha256(canonicalJson(content)),
      }),
    ).toBeUndefined();
    expect(checkpoint.sourceMessageSetSha256).toBe(
      modelContextMessageSetSha256(
        context.messages.slice(0, checkpoint.sourceMessageCount),
      ),
    );
    await f.store.close();
  });

  it("honors cancellation before committing or consuming another primary turn", async () => {
    const f = await compactionFixture();
    const cancellation = new AbortController();
    f.provider.setResponses([
      async () => {
        cancellation.abort(new Error("operator stopped"));
        // A provider that ignores AbortSignal must not hold the Run open.
        return new Promise<never>(() => {});
      },
    ]);
    await expect(
      f.compactor.project(f.input(transcript(), 0, cancellation.signal)),
    ).rejects.toThrow("operator stopped");
    expect(
      (await f.store.listRunEvents(f.run.id)).filter(
        (event) => event.type === "context.run_compaction.completed",
      ),
    ).toHaveLength(0);
    expect(f.budget.observed().turns).toBe(0);
    await f.store.close();
  });
});
