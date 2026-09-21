import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "vitest";
import { ModelRegistry } from "../packages/runtime/src/models.ts";
import { modelStream } from "../packages/runtime/src/model-stream-cancellation.ts";
import { guardModelThinkingLoop } from "../packages/runtime/src/model-thinking-loop-guard.ts";
import { RunBudgetTracker } from "../packages/runtime/src/run-budget.ts";
import {
  createSpendingBudget,
  openSpendingBudget,
} from "./harness-spending-budget.mjs";
import { installSpendingBudget } from "./harness-spending-transport.mjs";

test.each(["caller", "watchdog", "guard"])(
  "%s abort reaches the pinned provider SDK and local HTTP stream without a paid retry",
  async (owner) => {
    const root = await mkdtemp("/tmp/napier-provider-cancel-");
    createSpendingBudget(`${root}/spending.sqlite`, { maxFen: 5000 });
    const spending = openSpendingBudget(`${root}/spending.sqlite`);
    const original = globalThis.fetch;
    let requests = 0;
    let forwardedSignal;
    const closed = Promise.withResolvers();
    const server = createServer((request, response) => {
      requests++;
      request.resume();
      response.writeHead(200, { "content-type": "text/event-stream" });
      const timer = setInterval(() => {
        response.write(
          `data: ${JSON.stringify({
            id: "offline-cancellation",
            choices: [
              {
                index: 0,
                delta: { reasoning_content: "inspect next state " },
                finish_reason: null,
              },
            ],
          })}\n\n`,
        );
      }, 10);
      response.once("close", () => {
        clearInterval(timer);
        closed.resolve(true);
      });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    // Exercise the pinned SDK's real HTTP streaming. No request can reach the
    // advertised provider: this transport rewrites only the asserted origin.
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      assert.equal(new URL(request.url).origin, "https://api.deepseek.com");
      forwardedSignal = request.signal;
      return original(
        `http://127.0.0.1:${server.address().port}/chat/completions`,
        {
          method: request.method,
          headers: request.headers,
          body: await request.text(),
          signal: request.signal,
        },
      );
    };
    const restore = installSpendingBudget(spending);
    const controller = new AbortController();
    try {
      const registry = new ModelRegistry();
      const model = registry.resolve({
        provider: "deepseek",
        id: "deepseek-v4-flash",
      });
      const source = (signal = controller.signal) =>
        modelStream(
          {
            registry,
            budget: new RunBudgetTracker({
              maxTurns: 4,
              maxTotalTokens: 10000,
              maxCostUsd: 1,
              timeoutMs: 5000,
            }),
            store: { appendEvent: async (event) => event },
            run: { id: "offline-run", threadId: "offline-thread" },
            deadlinePolicy: {
              semanticProgressTimeoutMs: 100,
              firstEventTimeoutMs: 1500,
              idleTimeoutMs: 1000,
              turnTimeoutMs: 2000,
            },
          },
          model,
          {
            messages: [
              {
                role: "user",
                content: "Offline cancellation probe",
                timestamp: 0,
              },
            ],
          },
          {
            apiKey: "offline-not-a-credential",
            signal,
            maxRetries: 0,
          },
        );
      let capturedTrace;
      const stream =
        owner === "guard"
          ? guardModelThinkingLoop({
              model,
              context: { messages: [] },
              options: {},
              rootSignal: controller.signal,
              async createSource({ signal }) {
                return {
                  source: source(signal),
                  context: { messages: [] },
                  options: {},
                };
              },
              onDetected(evidence, action, terminal, trace) {
                assert.equal(evidence.reason, "semantic_stall");
                assert.equal(action, "retry");
                assert.equal(terminal, undefined);
                capturedTrace = trace;
                return "finalize";
              },
            })
          : source();
      let deltas = 0;
      for await (const event of stream) {
        if (
          event.type === "thinking_delta" &&
          ++deltas === 3 &&
          owner === "caller"
        )
          controller.abort();
      }
      const result = await stream.result();
      assert.equal(result.stopReason, owner === "guard" ? "error" : "aborted");
      if (owner === "guard") {
        assert.ok(capturedTrace.observedChunks > 0);
        assert.equal(
          capturedTrace.text,
          "inspect next state ".repeat(capturedTrace.observedChunks),
        );
        assert.equal(capturedTrace.truncated, false);
        assert.equal(
          capturedTrace.observedBytes,
          Buffer.byteLength(capturedTrace.text),
        );
        assert.match(result.errorMessage, /semantic_stall/);
      } else assert.ok(deltas > 0);
      if (owner === "watchdog")
        assert.match(result.errorMessage, /semantic_progress_timeout/);
      assert.equal(controller.signal.aborted, owner === "caller");
      assert.equal(forwardedSignal.aborted, true);
      assert.equal(
        await Promise.race([closed.promise, delay(1000).then(() => false)]),
        true,
      );
      const retry = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        body: JSON.stringify({ model: "deepseek-flash", stream: true }),
      });
      assert.equal(retry.status, 402);
      assert.equal(
        (await retry.json()).error.code,
        "harness_spending_evidence_pending",
      );
      assert.equal(requests, 1);
      assert.equal(spending.snapshot().requests, 1);
      assert.equal(spending.snapshot().reservedRequests, 1);
      assert.equal(spending.snapshot().committedFen, 600);
    } finally {
      controller.abort();
      restore();
      globalThis.fetch = original;
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      spending.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
