import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "vitest";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import {
  createApiRequestBudget,
  openApiRequestBudget,
  installDeepSeekRequestBudget,
  apiRequestBudgetEvidenceEligible,
} from "./harness-api-request-budget.mjs";

async function fixture(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "napier-api-budget-"));
  try {
    await fn(path.join(dir, "budget.sqlite"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
function child(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, args, {
      env: { PATH: process.env.PATH },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", reject);
    p.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("a shared request cap survives process concurrency and reopen without refunds", () =>
  fixture(async (file) => {
    createApiRequestBudget(file, { maxRequests: 7, minIntervalMs: 0 });
    const moduleUrl = new URL(
      "./harness-api-request-budget.mjs",
      import.meta.url,
    ).href;
    const code = `import {openApiRequestBudget} from ${JSON.stringify(moduleUrl)};
    const b=openApiRequestBudget(process.argv[1]); let n=0;
    for(let i=0;i<10;i++) if(await b.acquire()) n++;
    process.stdout.write(String(n)); b.close();`;
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        child(["--input-type=module", "-e", code, file]),
      ),
    );
    assert.ok(
      results.every((r) => r.code === 0),
      JSON.stringify(results),
    );
    assert.equal(
      results.reduce((n, r) => n + Number(r.stdout), 0),
      7,
    );
    const budget = openApiRequestBudget(file);
    try {
      assert.equal(budget.snapshot().admitted, 7);
      assert.equal(budget.snapshot().denied, 33);
      assert.equal(await budget.acquire(), false);
    } finally {
      budget.close();
    }
  }));

test("admission spacing is shared and cancellation while waiting spends no slot", () =>
  fixture(async (file) => {
    createApiRequestBudget(file, { maxRequests: 3, minIntervalMs: 80 });
    const a = openApiRequestBudget(file),
      b = openApiRequestBudget(file);
    try {
      assert.deepEqual(await Promise.all([a.acquire(), b.acquire()]), [
        true,
        true,
      ]);
      const db = new DatabaseSync(file);
      const rows = db
        .prepare("SELECT admitted_at FROM admissions ORDER BY seq")
        .all();
      db.close();
      assert.ok(rows[1].admitted_at - rows[0].admitted_at >= 80);
      const controller = new AbortController();
      const waiting = a.acquire(controller.signal);
      controller.abort();
      await assert.rejects(waiting, { name: "AbortError" });
      assert.equal(a.snapshot().admitted, 2);
    } finally {
      a.close();
      b.close();
    }
  }));

test("real Pi/OpenAI provider retries pass the guard; exhausted calls never reach transport", () =>
  fixture(async (file) => {
    createApiRequestBudget(file, { maxRequests: 2, minIntervalMs: 0 });
    const budget = openApiRequestBudget(file),
      original = globalThis.fetch;
    let dispatches = 0;
    globalThis.fetch = async (_input, init) => {
      dispatches++;
      assert.equal(init.redirect, "error");
      return new Response(
        JSON.stringify({ error: { message: "Local simulated rate limit" } }),
        {
          status: 429,
          headers: {
            "content-type": "application/json",
            "retry-after-ms": "1",
          },
        },
      );
    };
    const restore = installDeepSeekRequestBudget(budget);
    try {
      const provider = deepseekProvider();
      const result = await provider
        .stream(
          provider.getModels()[0],
          {
            messages: [
              {
                role: "user",
                content: "local transport probe",
                timestamp: Date.now(),
              },
            ],
          },
          { apiKey: "local-test-placeholder", maxRetries: 4 },
        )
        .result();
      assert.equal(result.stopReason, "error");
      assert.match(result.errorMessage, /budget exhausted/);
      assert.equal(dispatches, 2);
      assert.equal(budget.snapshot().admitted, 2);
      assert.equal(budget.snapshot().denied, 1);
    } finally {
      restore();
      globalThis.fetch = original;
      budget.close();
    }
  }));

test("failed transport consumes its allowance, unrelated fetch is untouched, exhaustion sends nothing", () =>
  fixture(async (file) => {
    createApiRequestBudget(file, { maxRequests: 1, minIntervalMs: 0 });
    const budget = openApiRequestBudget(file),
      original = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (input, init) => {
      calls.push({ input, init });
      throw new Error("local transport failure");
    };
    const restore = installDeepSeekRequestBudget(budget);
    try {
      await assert.rejects(
        fetch("https://api.deepseek.com/chat/completions"),
        /transport failure/,
      );
      assert.equal(
        (await fetch(new Request("https://api.deepseek.com/chat/completions")))
          .status,
        402,
      );
      const init = { method: "GET" };
      await assert.rejects(
        fetch("http://127.0.0.1:12345/health", init),
        /transport failure/,
      );
      assert.equal(calls.length, 2);
      assert.equal(calls[1].init, init);
      assert.equal(budget.snapshot().admitted, 1);
    } finally {
      restore();
      globalThis.fetch = original;
      budget.close();
    }
  }));

test("missing, invalid, reused or changed budget files fail closed", () =>
  fixture(async (file) => {
    assert.throws(() => openApiRequestBudget(file), /ENOENT/);
    assert.throws(() =>
      createApiRequestBudget(file, {
        maxRequests: undefined,
        minIntervalMs: 0,
      }),
    );
    createApiRequestBudget(file, { maxRequests: 0, minIntervalMs: 0 });
    assert.throws(
      () => createApiRequestBudget(file, { maxRequests: 9, minIntervalMs: 0 }),
      /EEXIST/,
    );
    const budget = openApiRequestBudget(file);
    try {
      assert.equal(await budget.acquire(), false);
      const db = new DatabaseSync(file);
      db.exec("UPDATE budget SET max_requests=9 WHERE id=1");
      db.close();
      await assert.rejects(budget.acquire(), /policy changed/);
    } finally {
      budget.close();
    }
  }));

test("budget evidence preserves historical reports but rejects truncated or altered new evidence", () =>
  fixture(async (file) => {
    createApiRequestBudget(file, { maxRequests: 1, minIntervalMs: 0 });
    const b = openApiRequestBudget(file);
    try {
      const before = b.snapshot();
      await b.acquire();
      const report = {
        schemaVersion: 7,
        apiRequestBudget: { before, after: b.snapshot() },
      };
      assert.equal(apiRequestBudgetEvidenceEligible(report), true);
      assert.equal(
        apiRequestBudgetEvidenceEligible({ schemaVersion: 6 }),
        true,
      );
      assert.equal(
        apiRequestBudgetEvidenceEligible({ schemaVersion: 7 }),
        false,
      );
      const modified = structuredClone(report);
      modified.apiRequestBudget.after.maxRequests++;
      assert.equal(apiRequestBudgetEvidenceEligible(modified), false);
      await b.acquire();
      report.apiRequestBudget.after = b.snapshot();
      assert.equal(apiRequestBudgetEvidenceEligible(report), false);
    } finally {
      b.close();
    }
  }));

test("both paid CLIs refuse implicit request budgets before touching nonexistent inputs", async () => {
  for (const [script, args] of [
    ["campaign", ["--case-root", "/nonexistent", "--output", "/nonexistent"]],
    [
      "suite",
      [
        "--suite",
        "/nonexistent",
        "--output",
        "/nonexistent",
        "--baseline-runtime",
        "/nonexistent",
        "--candidate-runtime",
        "/nonexistent",
      ],
    ],
  ]) {
    const result = await child([
      `scripts/run-harness-optimization-${script}.mjs`,
      ...args,
    ]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /--max-api-requests/);
    assert.doesNotMatch(result.stderr, /ENOENT/);
  }
});

test("successful SDK streaming retains request content and response under the allowance", () =>
  fixture(async (file) => {
    createApiRequestBudget(file, { maxRequests: 1, minIntervalMs: 0 });
    const budget = openApiRequestBudget(file),
      original = globalThis.fetch;
    globalThis.fetch = async (_input, init) => {
      const body = JSON.parse(init.body);
      assert.equal(body.messages.at(-1).content, "local success probe");
      const chunk = {
        id: "local",
        object: "chat.completion.chunk",
        choices: [
          {
            index: 0,
            delta: { role: "assistant", content: "local success" },
            finish_reason: "stop",
          },
        ],
      };
      return new Response(
        `data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`,
        {
          headers: { "content-type": "text/event-stream" },
        },
      );
    };
    const restore = installDeepSeekRequestBudget(budget);
    try {
      const provider = deepseekProvider();
      const result = await provider
        .stream(
          provider.getModels()[0],
          {
            messages: [
              {
                role: "user",
                content: "local success probe",
                timestamp: Date.now(),
              },
            ],
          },
          { apiKey: "local-test-placeholder", maxRetries: 0 },
        )
        .result();
      assert.equal(result.stopReason, "stop");
      assert.equal(
        result.content.find((p) => p.type === "text").text,
        "local success",
      );
      assert.equal(budget.snapshot().admitted, 1);
      assert.equal(budget.snapshot().denied, 0);
    } finally {
      restore();
      globalThis.fetch = original;
      budget.close();
    }
  }));

test("a zero-budget suite preserves missing observations and launches no campaign", () =>
  fixture(async (file) => {
    const root = path.dirname(file),
      source = path.join(root, "case");
    await mkdir(path.join(source, "fixture"), { recursive: true });
    await writeFile(path.join(source, "fixture/code.js"), "original");
    await writeFile(path.join(source, "prompt.md"), "Repair code");
    await writeFile(path.join(source, "outcome.mjs"), "throw Error('unfixed')");
    await writeFile(
      path.join(source, "manifest.json"),
      JSON.stringify({
        id: "one",
        promptPath: "prompt.md",
        fixturePath: "fixture",
        outcomeTestPath: "outcome.mjs",
      }),
    );
    const suite = path.join(root, "suite.json"),
      output = path.join(root, "output");
    await writeFile(
      suite,
      JSON.stringify({
        kind: "napier.harness-optimization-suite",
        schemaVersion: 1,
        id: "zero",
        cases: [{ path: "case", coverage: ["edit"] }],
      }),
    );
    const result = await child([
      "scripts/run-harness-optimization-suite.mjs",
      "--suite",
      suite,
      "--output",
      output,
      "--baseline-runtime",
      "/nonexistent",
      "--candidate-runtime",
      "/nonexistent",
      "--max-api-requests",
      "0",
      "--api-request-interval-ms",
      "1000",
    ]);
    assert.equal(result.code, 1, result.stderr);
    const receipt = JSON.parse(
      await readFile(path.join(output, "suite-result.json"), "utf8"),
    );
    assert.equal(receipt.apiRequestBudget.admitted, 0);
    assert.equal(receipt.missing.length, 6);
    assert.equal(receipt.collectionComplete, false);
    assert.equal(receipt.promotionReady, false);
    assert.equal(receipt.stop.reason, "api_request_budget_exhausted");
    assert.equal(receipt.statuses[0].result.spawned, false);
    assert.ok(
      receipt.statuses.slice(1).every((s) => s.status === "not_started"),
    );
  }));
