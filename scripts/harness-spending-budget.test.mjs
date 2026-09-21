import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import {
  createSpendingBudget,
  openSpendingBudget,
} from "./harness-spending-budget.mjs";
import { installSpendingBudget } from "./harness-spending-transport.mjs";
import { spendingBudgetEvidenceEligible } from "./harness-spending-budget.mjs";

async function fixture(action, maxFen = 5000) {
  const root = await mkdtemp(path.join(os.tmpdir(), "napier-spend-"));
  const file = path.join(root, "budget.sqlite");
  createSpendingBudget(file, { maxFen, priorSpendFen: 0 });
  const budget = openSpendingBudget(file);
  try {
    await action(budget, file);
  } finally {
    budget.close();
    await rm(root, { recursive: true, force: true });
  }
}
const endpoint = "https://api.deepseek.com/chat/completions";
const request = (patch = {}) => ({
  method: "POST",
  body: JSON.stringify({ model: "deepseek-v4-flash", stream: true, ...patch }),
});
const usage = { prompt_tokens: 1000, completion_tokens: 500 };
const sse = `data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: ${JSON.stringify({ usage })}\n\ndata: [DONE]\n\n`;

test("new reports cannot omit spending evidence or qualify incomplete/refused requests", () =>
  fixture(async (budget) => {
    const before = budget.snapshot();
    const id = budget.reserve();
    assert.equal(spendingBudgetEvidenceEligible({ schemaVersion: 8 }), false);
    assert.equal(spendingBudgetEvidenceEligible({ schemaVersion: 7 }), true);
    const report = () => ({
      schemaVersion: 8,
      spendingBudget: { before, after: budget.snapshot() },
    });
    assert.equal(spendingBudgetEvidenceEligible(report()), false);
    budget.settle(id, usage);
    assert.equal(spendingBudgetEvidenceEligible(report()), true);
    const changed = report();
    changed.spendingBudget.after.maxFen++;
    assert.equal(spendingBudgetEvidenceEligible(changed), false);
  }));

test("two clients share durable reservations; incomplete calls never receive a refund", () =>
  fixture(async (a, file) => {
    const b = openSpendingBudget(file);
    try {
      const ids = Array.from({ length: 8 }, (_, i) =>
        (i % 2 ? a : b).reserve(),
      );
      assert.ok(ids.every(Number.isSafeInteger));
      assert.equal(a.reserve(), undefined);
      assert.equal(b.snapshot().committedFen, 4800);
      assert.equal(a.settle(ids[0], usage), true);
      assert.equal(
        b.settle(ids[0], { prompt_tokens: 1, completion_tokens: 0 }),
        false,
      );
      assert.equal(
        a.settle(ids[1], { prompt_tokens: 1_000_001, completion_tokens: 1 }),
        false,
      );
      assert.equal(b.snapshot().committedFen, 4201);
      assert.equal(b.snapshot().reservedRequests, 7);
    } finally {
      b.close();
    }
    const reopened = openSpendingBudget(file);
    try {
      assert.equal(reopened.snapshot().committedFen, 4201);
    } finally {
      reopened.close();
    }
  }));

test("complete SSE is byte-preserved and settles before the SDK cancels at DONE", () =>
  fixture(async (budget) => {
    const original = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode(sse));
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    const restore = installSpendingBudget(budget);
    try {
      const response = await fetch(endpoint, request());
      const reader = response.body.getReader();
      assert.equal(new TextDecoder().decode((await reader.read()).value), sse);
      await reader.cancel();
      assert.equal(budget.snapshot().committedFen, 1);
      assert.equal(budget.snapshot().reservedRequests, 0);
    } finally {
      restore();
      globalThis.fetch = original;
    }
  }));

test.each(["cancelled", "malformed", "missing-usage"])(
  "%s streams retain their maximum charge and prevent another provider call",
  (kind) =>
    fixture(async (budget) => {
      const original = globalThis.fetch;
      const text =
        kind === "malformed"
          ? "data: invalid\n\n" + sse
          : kind === "missing-usage"
            ? "data: [DONE]\n\n"
            : 'data: {"choices":[]}\n\n';
      let forwarded = 0;
      globalThis.fetch = async () => {
        forwarded++;
        return new Response(text, {
          headers: { "content-type": "text/event-stream" },
        });
      };
      const restore = installSpendingBudget(budget);
      try {
        const first = await fetch(endpoint, request());
        if (kind === "cancelled") await first.body.cancel();
        else await first.text();
        const second = await fetch(endpoint, request());
        assert.equal(second.status, 402);
        assert.equal(
          (await second.json()).error.code,
          "harness_spending_evidence_pending",
        );
        assert.equal(forwarded, 1);
        assert.equal(budget.snapshot().committedFen, 600);
        assert.equal(budget.snapshot().reservedRequests, 1);
      } finally {
        restore();
        globalThis.fetch = original;
      }
    }),
);

test("unpriced models and exhausted funds never reach the provider; transport failures retain reserves", () =>
  fixture(async (budget) => {
    const original = globalThis.fetch;
    let forwarded = 0;
    globalThis.fetch = async () => {
      forwarded++;
      throw new Error("offline simulated transport failure");
    };
    const restore = installSpendingBudget(budget);
    try {
      for (const patch of [
        { model: "deepseek-v4-pro" },
        { n: 2 },
        { max_tokens: 384001 },
        { stream: false },
      ])
        assert.equal((await fetch(endpoint, request(patch))).status, 402);
      assert.equal(forwarded, 0);
      await assert.rejects(fetch(endpoint, request()), /transport failure/);
      assert.equal((await fetch(endpoint, request())).status, 402);
      assert.equal(forwarded, 1);
      assert.equal(budget.snapshot().committedFen, 600);
    } finally {
      restore();
      globalThis.fetch = original;
    }
  }, 600));

test("pending headers and late usage serialize retries without changing historical reservations", () =>
  fixture(async (budget) => {
    budget.reserve(); // Unreceipted historical request is never repriced/released.
    const original = globalThis.fetch;
    let resolveHeaders,
      streamController,
      forwarded = 0;
    const headers = new Promise((resolve) => {
      resolveHeaders = resolve;
    });
    const started = Promise.withResolvers();
    globalThis.fetch = async () => {
      forwarded++;
      if (forwarded === 1) {
        started.resolve();
        return headers;
      }
      return new Response(sse, {
        headers: { "content-type": "text/event-stream" },
      });
    };
    const restore = installSpendingBudget(budget);
    try {
      const first = fetch(endpoint, request());
      await started.promise;
      const duringHeaders = await fetch(endpoint, request());
      assert.equal(duringHeaders.status, 402);
      assert.equal(forwarded, 1);
      resolveHeaders(
        new Response(
          new ReadableStream({
            start(controller) {
              streamController = controller;
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
      );
      const firstResponse = await first;
      const body = firstResponse.text();
      streamController.enqueue(
        new TextEncoder().encode('data: {"choices":[]}\n\n'),
      );
      const duringStream = await fetch(endpoint, request());
      assert.equal(
        (await duringStream.json()).error.code,
        "harness_spending_evidence_pending",
      );
      assert.equal(budget.snapshot().requests, 2);
      streamController.enqueue(new TextEncoder().encode(sse));
      streamController.close();
      assert.ok((await body).endsWith(sse));
      assert.equal(budget.snapshot().reservedRequests, 1);
      assert.equal(await (await fetch(endpoint, request())).text(), sse);
      assert.equal(forwarded, 2);
      assert.equal(budget.snapshot().requests, 3);
      assert.equal(budget.snapshot().reservedRequests, 1);
      assert.equal(budget.snapshot().committedFen, 602);
    } finally {
      restore();
      globalThis.fetch = original;
    }
  }));
