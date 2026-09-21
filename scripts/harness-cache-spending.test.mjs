import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import {
  FLASH_CACHE_SPENDING_POLICY,
  FLASH_SPENDING_POLICY,
  createSpendingBudget,
  openSpendingBudget,
  spendingCharge,
  spendingBudgetEvidenceEligible,
  upgradeSpendingBudgetCacheAccounting,
} from "./harness-spending-budget.mjs";
import { installSpendingBudget } from "./harness-spending-transport.mjs";
import { evaluateCampaignQuality } from "./harness-campaign-evidence.mjs";
import { observation } from "./harness-campaign-test-fixture.mjs";
import { createHash } from "node:crypto";
const usage = {
  prompt_tokens: 1000000,
  completion_tokens: 10000,
  prompt_cache_hit_tokens: 900000,
  prompt_cache_miss_tokens: 100000,
};
async function fixture(action, cacheAware = false) {
  const root = await mkdtemp(path.join(os.tmpdir(), "napier-cache-spend-")),
    file = path.join(root, "budget.sqlite");
  createSpendingBudget(file, { maxFen: 10000, priorSpendFen: 110, cacheAware });
  try {
    await action(file);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test("cache split uses official peak prices while legacy remains an all-miss upper bound", () => {
  assert.equal(spendingCharge(usage).fen, 208);
  assert.deepEqual(spendingCharge(usage, FLASH_CACHE_SPENDING_POLICY), {
    fen: 32,
    input: 1000000,
    output: 10000,
    cacheHitTokens: 900000,
    cacheMissTokens: 100000,
    accountingMode: "provider_cache_split",
  });
  assert.equal(
    spendingCharge(
      { ...usage, completion_tokens: 384000 },
      FLASH_CACHE_SPENDING_POLICY,
    ).fen <= 600,
    true,
  );
  assert.equal(
    spendingCharge(
      {
        prompt_tokens: 1,
        completion_tokens: 0,
        prompt_cache_hit_tokens: 1,
        prompt_cache_miss_tokens: 0,
      },
      FLASH_CACHE_SPENDING_POLICY,
    ).fen,
    1,
  );
});
test.each([
  {},
  { prompt_cache_hit_tokens: 900000 },
  { prompt_cache_hit_tokens: 900000, prompt_cache_miss_tokens: 99999 },
  { prompt_cache_hit_tokens: -1, prompt_cache_miss_tokens: 1000001 },
  { prompt_cache_hit_tokens: 0.5, prompt_cache_miss_tokens: 999999.5 },
  { prompt_cache_hit_tokens: "900000", prompt_cache_miss_tokens: 100000 },
])(
  "incomplete or malformed cache splits keep the full input price: %j",
  (split) => {
    const charge = spendingCharge(
      { prompt_tokens: 1000000, completion_tokens: 10000, ...split },
      FLASH_CACHE_SPENDING_POLICY,
    );
    assert.equal(charge.fen, 208);
    assert.equal(charge.cacheHitTokens, null);
  },
);
test("invalid total usage never settles or weakens the maximum reserve", () => {
  for (const value of [
    undefined,
    {},
    { ...usage, prompt_tokens: 1000001 },
    { ...usage, completion_tokens: -1 },
  ])
    assert.equal(spendingCharge(value, FLASH_CACHE_SPENDING_POLICY), undefined);
  assert.throws(
    () =>
      spendingCharge(usage, {
        ...FLASH_CACHE_SPENDING_POLICY,
        cacheHitFenPerMillion: 0,
      }),
    /Unknown/,
  );
});
test("complete provider SSE is forwarded unchanged and persists the cache accounting basis", () =>
  fixture(async (file) => {
    const budget = openSpendingBudget(file),
      original = globalThis.fetch;
    const sse = `data: ${JSON.stringify({ usage })}\n\ndata: [DONE]\n\n`;
    globalThis.fetch = async () =>
      new Response(sse, { headers: { "content-type": "text/event-stream" } });
    const restore = installSpendingBudget(budget);
    try {
      const before = budget.snapshot();
      const response = await fetch(
        "https://api.deepseek.com/chat/completions",
        {
          method: "POST",
          body: JSON.stringify({ model: "deepseek-flash", stream: true }),
        },
      );
      assert.equal(await response.text(), sse);
      assert.equal(budget.snapshot().committedFen, 142);
      assert.equal(
        spendingBudgetEvidenceEligible({
          schemaVersion: 8,
          spendingBudget: { before, after: budget.snapshot() },
        }),
        true,
      );
      const db = new DatabaseSync(file, { readOnly: true });
      try {
        assert.deepEqual(
          {
            ...db
              .prepare(
                "SELECT cache_hit_tokens,cache_miss_tokens,accounting_mode FROM requests",
              )
              .get(),
          },
          {
            cache_hit_tokens: 900000,
            cache_miss_tokens: 100000,
            accounting_mode: "provider_cache_split",
          },
        );
      } finally {
        db.close();
      }
    } finally {
      restore();
      globalThis.fetch = original;
      budget.close();
    }
  }, true));
test("migration preserves historical charges, rejects stale/unsettled boundaries and changes only future accounting", () =>
  fixture(async (file) => {
    const old = openSpendingBudget(file),
      empty = old.snapshot(),
      id = old.reserve();
    assert.throws(
      () => upgradeSpendingBudgetCacheAccounting(file, old.snapshot()),
      /boundary/,
    );
    assert.equal(old.settle(id, usage), true);
    assert.throws(
      () => upgradeSpendingBudgetCacheAccounting(file, empty),
      /boundary/,
    );
    const before = old.snapshot();
    old.close();
    const migrated = upgradeSpendingBudgetCacheAccounting(file, before);
    assert.equal(migrated.after.committedFen, 318);
    assert.equal(migrated.after.maxFen, 10000);
    const fresh = openSpendingBudget(file);
    try {
      assert.equal(fresh.snapshot().requests, 1);
      const snapshot = fresh.snapshot();
      snapshot.policy.cacheHitFenPerMillion = 0;
      assert.equal(fresh.settle(fresh.reserve(), usage), true);
      assert.equal(fresh.snapshot().committedFen, 350);
      assert.throws(
        () => upgradeSpendingBudgetCacheAccounting(file, fresh.snapshot()),
        /boundary/,
      );
      const db = new DatabaseSync(file, { readOnly: true });
      try {
        assert.deepEqual(
          db
            .prepare("SELECT charged_fen FROM requests ORDER BY id")
            .all()
            .map((x) => x.charged_fen),
          [208, 32],
        );
        assert.equal(
          db
            .prepare("SELECT count(*) AS n FROM accounting_policy_changes")
            .get().n,
          1,
        );
      } finally {
        db.close();
      }
      assert.equal(
        spendingBudgetEvidenceEligible({
          schemaVersion: 8,
          spendingBudget: { before, after: fresh.snapshot() },
        }),
        false,
      );
    } finally {
      fresh.close();
    }
  }));
test("accounting precision may change between pairs, never between arms or inside a Run", () => {
  const spending = (policy) => {
    const before = {
      kind: "napier.harness-spending-budget",
      schemaVersion: 1,
      currency: "CNY",
      maxFen: 10000,
      priorSpendFen: 110,
      committedFen: 110,
      remainingFen: 9890,
      requests: 0,
      reservedRequests: 0,
      denied: 0,
      policy,
    };
    return {
      before,
      after: { ...before, committedFen: 111, remainingFen: 9889, requests: 1 },
    };
  };
  const pair = (caseId, policy) =>
    ["baseline", "candidate"].map((arm) =>
      observation(arm, {
        caseId,
        fixtureSha256: createHash("sha256").update(caseId).digest("hex"),
        spendingBudget: spending(policy),
      }),
    );
  const old = pair("old_case", FLASH_SPENDING_POLICY),
    current = pair("new_case", FLASH_CACHE_SPENDING_POLICY);
  assert.equal(
    evaluateCampaignQuality([...old, ...current], {
      minimumCases: 2,
      minimumTrials: 1,
    }).promotionReady,
    true,
  );
  old[1].spendingBudget = spending(FLASH_CACHE_SPENDING_POLICY);
  const unequal = evaluateCampaignQuality(old, {
    minimumCases: 1,
    minimumTrials: 1,
  });
  assert.equal(unequal.comparablePairs, 0);
  assert.equal(unequal.promotionReady, false);
});
