import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import { collectEditOperationEvidence } from "./harness-edit-operation-evidence.mjs";
import { observation } from "./harness-campaign-test-fixture.mjs";
import { FLASH_SPENDING_POLICY } from "./harness-spending-budget.mjs";
import {
  buildFailureCase,
  evaluateCampaignQuality,
} from "./harness-campaign-evidence.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");

test("a failed baseline Run cannot hide regression of its passing code", () => {
  const result = evaluateCampaignQuality(
    [
      observation("baseline", {
        status: "failed",
        taskSuccess: false,
        graderExitCode: 0,
      }),
      observation("candidate", {
        status: "failed",
        taskSuccess: false,
        graderExitCode: 1,
      }),
    ],
    { minimumCases: 1, minimumTrials: 1 },
  );
  assert.equal(result.verdict, "regressed");
  assert.ok(
    result.regressions.includes("case_one:0: external behavior regressed"),
  );
  assert.equal(result.promotionReady, false);
});
test.each([1, null])(
  "failed or incomplete candidate grading cannot qualify when both Runs fail: %s",
  (status) => {
    const result = evaluateCampaignQuality(
      [
        observation("baseline", {
          status: "failed",
          taskSuccess: false,
          graderExitCode: 1,
        }),
        observation("candidate", {
          status: "failed",
          taskSuccess: false,
          graderExitCode: status,
        }),
      ],
      { minimumCases: 1, minimumTrials: 1 },
    );
    assert.equal(result.promotionReady, false);
    assert.ok(
      result.evidenceBlockers.includes(
        "case_one:0: candidate external behavior did not pass",
      ),
    );
  },
);
test("improved independent code outcome does not erase a candidate Run failure", () => {
  const result = evaluateCampaignQuality(
    [
      observation("baseline", { graderExitCode: 0 }),
      observation("candidate", {
        status: "failed",
        taskSuccess: false,
        graderExitCode: 0,
      }),
    ],
    { minimumCases: 1, minimumTrials: 1 },
  );
  assert.ok(
    result.regressions.includes("case_one:0: task completion regressed"),
  );
});

test("component probes cannot qualify as independent campaign observations", () => {
  assert.equal(
    evaluateCampaignQuality(
      [observation("baseline"), observation("candidate")],
      { minimumCases: 1, minimumTrials: 1 },
    ).promotionReady,
    true,
  );
  const result = evaluateCampaignQuality(
    [
      observation("baseline"),
      observation("candidate", { componentProbe: { passed: true } }),
    ],
    { minimumCases: 1, minimumTrials: 1 },
  );
  assert.equal(result.promotionReady, false);
});

test("paired spending policies must match even when neither arm exhausts its funds", () => {
  const spending = (maxFen) => {
    const before = {
      kind: "napier.harness-spending-budget",
      schemaVersion: 1,
      currency: "CNY",
      maxFen,
      priorSpendFen: 0,
      committedFen: 0,
      remainingFen: maxFen,
      requests: 0,
      reservedRequests: 0,
      denied: 0,
      policy: FLASH_SPENDING_POLICY,
    };
    return {
      before,
      after: {
        ...before,
        committedFen: 1,
        remainingFen: maxFen - 1,
        requests: 1,
      },
    };
  };
  const pair = (maxFen) => [
    observation("baseline", { spendingBudget: spending(5000) }),
    observation("candidate", { spendingBudget: spending(maxFen) }),
  ];
  const limits = { minimumCases: 1, minimumTrials: 1 };
  assert.equal(evaluateCampaignQuality(pair(5000), limits).comparablePairs, 1);
  const different = evaluateCampaignQuality(pair(6000), limits);
  assert.equal(different.comparablePairs, 0);
  assert.ok(
    different.blockers.some((value) => value.includes("budget evidence")),
  );
  const beforeIncrease = pair(5000);
  const afterIncrease = ["baseline", "candidate"].map((arm) =>
    observation(arm, {
      caseId: "case_two",
      fixtureSha256: hash("second independent fixture"),
      spendingBudget: spending(10000),
    }),
  );
  const extended = evaluateCampaignQuality(
    [...beforeIncrease, ...afterIncrease],
    {
      minimumCases: 2,
      minimumTrials: 1,
    },
  );
  assert.equal(extended.comparablePairs, 2);
  assert.equal(extended.promotionReady, true);
});

test("edit format evidence uses invocation capsules and leaves uncaptured writes unknown", async () => {
  const events = [
    {
      runId: "run_one",
      type: "tool.started",
      payload: {
        callId: "call_one",
        toolName: "apply_patch",
        inputRedacted: true,
      },
    },
    {
      runId: "run_one",
      type: "tool.completed",
      payload: { callId: "call_one", toolName: "apply_patch" },
    },
  ];
  const capsules = {
    read: async () => ({
      sourceRunId: "run_one",
      contextEnvelopeSha256: "envelope",
      context: {
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "toolCall",
                id: "call_one",
                name: "apply_patch",
                arguments: {
                  operation: "unified_diff",
                  diff: "PRIVATE_SOURCE",
                },
              },
            ],
          },
        ],
      },
    }),
  };
  assert.equal(
    (await collectEditOperationEvidence(events, capsules)).complete,
    false,
  );
  events.push({
    runId: "run_one",
    type: "context.model_invocation",
    payload: { capsuleSha256: "capsule", contextEnvelopeSha256: "envelope" },
  });
  const evidence = await collectEditOperationEvidence(events, capsules);
  assert.equal(evidence.complete, true);
  assert.equal(evidence.operations[0].operation, "unified_diff");
  assert.equal(evidence.operations[0].status, "completed");
  assert.equal(JSON.stringify(evidence).includes("PRIVATE_SOURCE"), false);
  await assert.rejects(
    collectEditOperationEvidence(events, {
      read: async () => ({
        ...(await capsules.read()),
        sourceRunId: "foreign",
      }),
    }),
    /different invocation/,
  );
});

test("a pilot cannot claim the full default quality gate", () => {
  const reports = [observation("baseline"), observation("candidate")];
  assert.equal(
    evaluateCampaignQuality(reports).verdict,
    "insufficient_evidence",
  );
  assert.equal(
    evaluateCampaignQuality(reports, { minimumCases: 1, minimumTrials: 1 })
      .verdict,
    "passed_scoped_gate",
  );
});

test("does not pool different Kernel policy adapters behind the same Runtime snapshot", () => {
  const pipeline = (name) => ({
    policyAdapterId: name,
    contentSha256: hash(name),
  });
  const reports = [
    observation("baseline", { trial: 0 }),
    observation("candidate", {
      trial: 0,
      experimentalTurnPipeline: pipeline("first"),
    }),
    observation("baseline", { trial: 1 }),
    observation("candidate", {
      trial: 1,
      experimentalTurnPipeline: pipeline("second"),
    }),
  ];
  const gate = evaluateCampaignQuality(reports, {
    minimumCases: 1,
    minimumTrials: 2,
  });
  assert.equal(gate.promotionReady, false);
  assert.ok(
    gate.blockers.some((reason) =>
      reason.includes("source or profile changed"),
    ),
  );
  reports[3].experimentalTurnPipeline = pipeline("first");
  assert.equal(
    evaluateCampaignQuality(reports, { minimumCases: 1, minimumTrials: 2 })
      .promotionReady,
    true,
  );
});

test("missing, foreign or changed dependency evidence blocks attribution without concealing regressions", () => {
  for (const patch of [
    { runtimeDependencyEvidence: undefined },
    {
      runtimeDependencyEvidence:
        observation("baseline").runtimeDependencyEvidence,
    },
    {
      runtimeDependencyEvidence: {
        ...observation("candidate").runtimeDependencyEvidence,
        stable: false,
      },
    },
  ]) {
    const result = evaluateCampaignQuality([
      observation("baseline"),
      observation("candidate", { ...patch, taskSuccess: false }),
    ]);
    assert.equal(result.comparablePairs, 0);
    assert.equal(result.verdict, "regressed");
    assert.ok(
      result.blockers.some((b) => b.includes("runtime dependency evidence")),
    );
  }
});

test("cost improvements cannot conceal a task regression or changed runtime", () => {
  const baseline = observation("baseline");
  assert.equal(
    evaluateCampaignQuality([
      baseline,
      observation("candidate", { taskSuccess: false, durationMs: 1 }),
    ]).verdict,
    "regressed",
  );
  const invalid = evaluateCampaignQuality([
    baseline,
    observation("candidate", { sourceStable: false }),
  ]);
  assert.equal(invalid.comparablePairs, 0);
  assert.equal(invalid.promotionReady, false);
  assert.equal(
    evaluateCampaignQuality([
      baseline,
      observation("candidate", { sandbox: "different" }),
    ]).comparablePairs,
    0,
  );
  assert.throws(
    () => evaluateCampaignQuality([baseline, baseline]),
    /Duplicate/,
  );
});

test("API budget limits bind comparisons and exhaustion never hides adverse outcomes", () => {
  const evidence = (maxRequests = 2, denied = 0, minIntervalMs = 1000) => {
    const policy = { maxRequests, minIntervalMs };
    const before = {
      kind: "napier.harness-api-request-budget",
      schemaVersion: 1,
      ...policy,
      policySha256: hash(JSON.stringify(policy)),
      admitted: 0,
      denied: 0,
      remaining: maxRequests,
      billingCeilingEstablished: false,
    };
    return {
      before,
      after: { ...before, admitted: 1, remaining: maxRequests - 1, denied },
    };
  };
  const baseline = observation("baseline", {
    schemaVersion: 7,
    apiRequestBudget: evidence(),
  });
  const candidate = observation("candidate", {
    schemaVersion: 7,
    apiRequestBudget: evidence(),
  });
  assert.equal(
    evaluateCampaignQuality([baseline, candidate]).comparablePairs,
    1,
  );
  for (const apiRequestBudget of [
    undefined,
    evidence(3),
    evidence(2, 1),
    evidence(2, 0, 500),
  ]) {
    const result = evaluateCampaignQuality([
      baseline,
      {
        ...candidate,
        apiRequestBudget,
        taskSuccess: false,
        allowedChanges: false,
      },
    ]);
    assert.equal(result.comparablePairs, 0);
    assert.equal(result.promotionReady, false);
    assert.equal(result.verdict, "regressed");
    assert.ok(result.blockers.some((b) => b.includes("API request budget")));
    assert.ok(result.regressions.some((b) => b.includes("scope")));
  }
  const subsequentPair = (maxRequests) =>
    ["baseline", "candidate"].map((arm) =>
      observation(arm, {
        schemaVersion: 7,
        caseId: "case_two",
        fixtureSha256: hash("different cadence task"),
        apiRequestBudget: evidence(maxRequests, 0, 500),
      }),
    );
  assert.equal(
    evaluateCampaignQuality([baseline, candidate, ...subsequentPair(2)], {
      minimumCases: 2,
      minimumTrials: 1,
    }).promotionReady,
    true,
  );
  assert.equal(
    evaluateCampaignQuality([baseline, candidate, ...subsequentPair(3)], {
      minimumCases: 2,
      minimumTrials: 1,
    }).promotionReady,
    false,
  );
});

test("environment failures and unequal budgets cannot qualify or hide scope violations", () => {
  const baseline = observation("baseline");
  for (const patch of [
    { environmentEvidence: undefined },
    {
      environmentEvidence: { ...baseline.environmentEvidence, eligible: false },
    },
    { environmentEvidence: baseline.environmentEvidence },
    { runLimits: { maxTurns: 999 } },
  ]) {
    const result = evaluateCampaignQuality([
      baseline,
      observation("candidate", patch),
    ]);
    assert.equal(result.comparablePairs, 0);
    assert.equal(result.promotionReady, false);
  }
  const unavailable = observation("candidate", {
    environmentEvidence: undefined,
    taskSuccess: false,
    allowedChanges: false,
  });
  const result = evaluateCampaignQuality([baseline, unavailable]);
  assert.equal(result.verdict, "regressed");
  assert.ok(result.regressions.some((reason) => reason.includes("scope")));
  assert.ok(result.blockers.some((reason) => reason.includes("environment")));
});

test("reproduction uses the original checked fixture and refuses mismatch and overwrite", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "napier-failure-case-test-"),
  );
  try {
    const original = path.join(root, "original");
    await mkdir(path.join(original, "fixture"), { recursive: true });
    await writeFile(path.join(original, "fixture", "source.py"), "print(1)\n");
    await writeFile(path.join(original, "prompt.md"), "Fix the source");
    await writeFile(
      path.join(original, "outcome.mjs"),
      "throw Error('not fixed')",
    );
    await writeFile(
      path.join(original, "manifest.json"),
      JSON.stringify({
        id: "case_one",
        promptPath: "prompt.md",
        fixturePath: "fixture",
        outcomeTestPath: "outcome.mjs",
      }),
    );
    const report = observation("candidate", {
      taskSuccess: false,
      toolFailures: 1,
      fixtureSha256: hash(JSON.stringify({ "source.py": hash("print(1)\n") })),
      promptSha256: hash("Fix the source"),
      outcomeSha256: hash("throw Error('not fixed')"),
    });
    const output = path.join(root, "bundle");
    const evidence = await buildFailureCase({
      report,
      caseRoot: original,
      output,
    });
    assert.equal(evidence.failureRecurrenceGuaranteed, false);
    assert.equal(
      await readFile(path.join(output, "fixture", "source.py"), "utf8"),
      "print(1)\n",
    );
    await assert.rejects(
      buildFailureCase({ report, caseRoot: original, output }),
      /already exists/,
    );
    const manifest = JSON.parse(
      await readFile(path.join(original, "manifest.json"), "utf8"),
    );
    const bound = {
      ...report,
      caseManifest: manifest,
      runLimits: { maxTurns: 24 },
      acceptanceSha256: hash(
        JSON.stringify({
          maxTurns: 24,
          requiredCompletedTools: [],
          processAcceptance: null,
        }),
      ),
    };
    await writeFile(
      path.join(original, "manifest.json"),
      JSON.stringify({ ...manifest, maxTurns: 48 }),
    );
    await assert.rejects(
      buildFailureCase({
        report: bound,
        caseRoot: original,
        output: path.join(root, "changed-budget"),
      }),
      /acceptance\/budget/,
    );
    await writeFile(
      path.join(original, "manifest.json"),
      JSON.stringify({ ...manifest, allowedChangedPaths: ["extra.py"] }),
    );
    await assert.rejects(
      buildFailureCase({
        report: bound,
        caseRoot: original,
        output: path.join(root, "changed-scope"),
      }),
      /acceptance\/budget/,
    );
    await writeFile(
      path.join(original, "manifest.json"),
      JSON.stringify(manifest),
    );
    const matched = await buildFailureCase({
      report: bound,
      caseRoot: original,
      output: path.join(root, "bound"),
    });
    assert.equal(matched.acceptanceSha256, bound.acceptanceSha256);
    assert.deepEqual(
      matched.runtimeDependencyEvidence,
      bound.runtimeDependencyEvidence,
    );
    const debuggerAcceptance = { runtime: "python", breakpointLine: 5 };
    await writeFile(
      path.join(original, "manifest.json"),
      JSON.stringify({ ...manifest, debuggerAcceptance }),
    );
    const debuggerReport = {
      ...bound,
      acceptanceSha256: hash(
        JSON.stringify({
          maxTurns: 24,
          requiredCompletedTools: [],
          processAcceptance: null,
          debuggerAcceptance,
        }),
      ),
    };
    await buildFailureCase({
      report: debuggerReport,
      caseRoot: original,
      output: path.join(root, "debugger-bound"),
    });
    for (const required of [false, true]) {
      const serviceReport = {
        ...debuggerReport,
        serviceObservationRequired: required,
        acceptanceSha256: hash(
          JSON.stringify({
            maxTurns: 24,
            requiredCompletedTools: [],
            processAcceptance: null,
            debuggerAcceptance,
            serviceObservationRequired: required,
          }),
        ),
      };
      const serviceEvidence = await buildFailureCase({
        report: serviceReport,
        caseRoot: original,
        output: path.join(root, `service-${required}`),
      });
      assert.equal(serviceEvidence.serviceObservationRequired, required);
      for (const changed of [!required, undefined, "false"]) {
        await assert.rejects(
          buildFailureCase({
            report: { ...serviceReport, serviceObservationRequired: changed },
            caseRoot: original,
            output: path.join(root, `service-changed-${required}-${changed}`),
          }),
          /acceptance\/budget/,
        );
      }
    }
    await assert.rejects(
      buildFailureCase({
        report: { ...debuggerReport, serviceObservationRequired: false },
        caseRoot: original,
        output: path.join(root, "service-not-bound"),
      }),
      /acceptance\/budget/,
    );
    await assert.rejects(
      buildFailureCase({
        report: bound,
        caseRoot: original,
        output: path.join(root, "debugger-unbound"),
      }),
      /acceptance\/budget/,
    );
    await writeFile(
      path.join(original, "manifest.json"),
      JSON.stringify({
        ...manifest,
        debuggerAcceptance: { ...debuggerAcceptance, breakpointLine: 6 },
      }),
    );
    await assert.rejects(
      buildFailureCase({
        report: debuggerReport,
        caseRoot: original,
        output: path.join(root, "debugger-changed"),
      }),
      /acceptance\/budget/,
    );
    await writeFile(
      path.join(original, "manifest.json"),
      JSON.stringify(manifest),
    );
    await writeFile(path.join(original, "fixture", "source.py"), "print(2)\n");
    await assert.rejects(
      buildFailureCase({
        report,
        caseRoot: original,
        output: path.join(root, "bad"),
      }),
      /do not match/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
