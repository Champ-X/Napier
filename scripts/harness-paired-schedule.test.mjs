import assert from "node:assert/strict";
import { test } from "vitest";
import { observation } from "./harness-campaign-test-fixture.mjs";
import { evaluateCampaignQuality } from "./harness-campaign-evidence.mjs";
import { FLASH_CACHE_SPENDING_POLICY } from "./harness-spending-budget.mjs";
import {
  pairedSuiteJobs,
  executePairedSuiteJobs,
} from "./harness-paired-schedule.mjs";

const cases = [
  { id: "one", path: "/one" },
  { id: "two", path: "/two" },
];
const jobs = () => pairedSuiteJobs(cases, "/output", 3);
test("prioritizing known failures changes only order, never scope or trial count", () => {
  const prioritized = pairedSuiteJobs(cases, "/output", 3, ["two"]);
  assert.equal(prioritized[0].caseId, "two");
  assert.deepEqual(
    prioritized.map((j) => j.output).sort(),
    jobs()
      .map((j) => j.output)
      .sort(),
  );
  assert.throws(
    () => pairedSuiteJobs(cases, "/output", 3, ["missing"]),
    /existing suite cases/,
  );
  assert.throws(
    () => pairedSuiteJobs(cases, "/output", 3, ["two", "two"]),
    /unique/,
  );
});
const report = (job, patch = {}) =>
  observation(job.arm, {
    caseId: job.caseId,
    trial: job.trial,
    fixtureSha256: job.caseId === "one" ? "1".repeat(64) : "2".repeat(64),
    ...patch,
  });

test("trial rounds retain all pairs, unique paths and alternating arm order", async () => {
  const planned = jobs(),
    calls = [],
    receipts = [];
  assert.equal(planned.length, 12);
  assert.equal(new Set(planned.map((j) => j.output)).size, 12);
  assert.deepEqual(
    planned.slice(0, 6).map((j) => [j.caseId, j.trial, j.arm]),
    [
      ["one", 0, "baseline"],
      ["one", 0, "candidate"],
      ["two", 0, "candidate"],
      ["two", 0, "baseline"],
      ["one", 1, "candidate"],
      ["one", 1, "baseline"],
    ],
  );
  const result = await executePairedSuiteJobs(
    planned,
    async (job) => {
      calls.push(job);
      return { exitCode: 0 };
    },
    async (job) => report(job),
    { checkpoint: async (receipt) => receipts.push(receipt) },
  );
  assert.equal(calls.length, 12);
  assert.equal(receipts.length, 12);
  assert.equal(result.stop, null);
  const quality = evaluateCampaignQuality(planned.map((job) => report(job)));
  assert.equal(quality.comparablePairs, 6);
  assert.equal(quality.promotionReady, false);
  assert.deepEqual(quality.required, { minimumCases: 30, minimumTrials: 3 });
  assert.deepEqual(quality.evidenceBlockers, []);
});

test("first regressed pair stops later trials, preserving the failing observation", async () => {
  const seen = [];
  const result = await executePairedSuiteJobs(
    jobs(),
    async (job) => {
      seen.push(job);
      return { exitCode: 0 };
    },
    async (job) => report(job, { taskSuccess: job.arm === "baseline" }),
  );
  assert.equal(seen.length, 2);
  assert.equal(result.stop.reason, "quality_regressed");
  assert.equal(result.stop.quality.comparablePairs, 1);
  assert.match(
    result.stop.quality.regressions.join("\n"),
    /task completion regressed/,
  );
  assert.equal(
    result.statuses.filter((s) => s.status === "not_started").length,
    10,
  );
});

test.each(["source", "budget", "environment", "component"])(
  "invalid %s evidence stops after its first pair",
  async (kind) => {
    const patch = {
      source: { sourceStable: false },
      budget: { schemaVersion: 8 },
      environment: { environmentEvidence: null },
      component: { componentProbe: { passed: true } },
    }[kind];
    const result = await executePairedSuiteJobs(
      jobs(),
      async () => ({ exitCode: 0 }),
      async (job) => report(job, job.arm === "candidate" ? patch : {}),
    );
    assert.equal(result.stop.reason, "evidence_invalid");
    assert.equal(
      result.statuses.filter((s) => s.status === "settled").length,
      2,
    );
  },
);

test("baseline failures alone do not stop collection or erase adverse outcomes", async () => {
  const result = await executePairedSuiteJobs(
    jobs(),
    async () => ({ exitCode: 0 }),
    async (job) => report(job, { taskSuccess: false }),
  );
  assert.equal(result.stop, null);
  assert.equal(
    result.statuses.filter((s) => s.status === "settled").length,
    12,
  );
});

test.each(["missing", "identity", "exit", "budget", "cancel"])(
  "%s stops new launches and retains started work",
  async (kind) => {
    const controller = new AbortController();
    let calls = 0;
    const result = await executePairedSuiteJobs(
      jobs(),
      async () => {
        calls++;
        if (kind === "cancel") controller.abort();
        return kind === "exit"
          ? { exitCode: 1 }
          : kind === "budget"
            ? {
                exitCode: 1,
                reason: "spending_budget_insufficient",
                spawned: false,
              }
            : { exitCode: 0 };
      },
      async (job) => {
        if (kind === "missing") throw Error("Missing result");
        return report(job, kind === "identity" ? { trial: 99 } : {});
      },
      { signal: controller.signal },
    );
    assert.equal(calls, 1);
    assert.ok(result.stop);
    assert.equal(
      result.statuses.slice(1).every((s) => s.status === "not_started"),
      true,
    );
  },
);

test("source drift between otherwise passing pairs cannot be ignored as sample insufficiency", async () => {
  const result = await executePairedSuiteJobs(
    jobs(),
    async () => ({ exitCode: 0 }),
    async (job) =>
      report(
        job,
        job.caseId === "two" && job.arm === "candidate"
          ? { runtimeArtifactSha256: "9".repeat(64) }
          : {},
      ),
  );
  assert.equal(result.stop.reason, "evidence_invalid");
  assert.equal(result.statuses.filter((s) => s.status === "settled").length, 4);
  assert.match(
    result.stop.quality.evidenceBlockers.join("\n"),
    /changed within campaign/,
  );
});

test("malformed adjacent pairs are refused before any execution", async () => {
  let calls = 0;
  await assert.rejects(
    executePairedSuiteJobs(
      jobs().slice(1),
      async () => {
        calls++;
      },
      report,
    ),
    /adjacent complete trial pairs/,
  );
  assert.equal(calls, 0);
});

test.each(["baseline", "candidate"])(
  "an unsettled %s first arm stops before spending on its counterpart",
  async (arm) => {
    const planned = jobs().slice(0, 2).sort((a) => (a.arm === arm ? -1 : 1));
    const before = {
      kind: "napier.harness-spending-budget",
      schemaVersion: 1,
      currency: "CNY",
      maxFen: 10000,
      priorSpendFen: 0,
      committedFen: 100,
      remainingFen: 9900,
      requests: 1,
      reservedRequests: 0,
      denied: 0,
      policy: FLASH_CACHE_SPENDING_POLICY,
    };
    const original = report(planned[0], {
      spendingBudget: {
        before,
        after: {
          ...before,
          committedFen: 700,
          remainingFen: 9300,
          requests: 2,
          reservedRequests: 1,
        },
      },
    });
    const preserved = structuredClone(original);
    let calls = 0;
    const result = await executePairedSuiteJobs(
      planned,
      async () => {
        calls++;
        return { exitCode: 0 };
      },
      async () => original,
    );
    assert.equal(calls, 1);
    assert.equal(result.stop.reason, "evidence_invalid");
    assert.equal(result.statuses[0].status, "settled");
    assert.equal(result.statuses[1].status, "not_started");
    assert.deepEqual(original, preserved);
    assert.equal(original.taskSuccess, true);
  },
);
