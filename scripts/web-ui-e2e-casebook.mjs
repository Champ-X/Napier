import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";

import { DEFAULT_EVALUATION_RUBRIC } from "../packages/runtime/dist/index.js";
import { createRunReplaySnapshot } from "../packages/runtime/dist/run-replay.js";

export async function seedWebUiCasebook(store, thread, agent) {
  const left = await completedEvidenceRun(
    store,
    thread.id,
    agent.id,
    "Baseline answer without a verification note.",
  );
  const right = await completedEvidenceRun(
    store,
    thread.id,
    agent.id,
    "Candidate answer with a verified source note.",
  );
  const [leftSnapshot, rightSnapshot] = await Promise.all([
    createRunReplaySnapshot(store, thread.id, left.id),
    createRunReplaySnapshot(store, thread.id, right.id),
  ]);
  const evaluation = await store.saveRunEvaluation({
    id: "evaluation_web_ui_release_casebook",
    threadId: thread.id,
    leftRunId: left.id,
    rightRunId: right.id,
    leftSnapshotSha256: leftSnapshot.eventStreamSha256,
    rightSnapshotSha256: rightSnapshot.eventStreamSha256,
    rubric: structuredClone(DEFAULT_EVALUATION_RUBRIC),
    scores: DEFAULT_EVALUATION_RUBRIC.criteria.map((criterion) => ({
      criterionId: criterion.id,
      leftScore: 3,
      rightScore: 4,
      reason: `${criterion.name} is stronger in the candidate.`,
    })),
    verdict: "right_better",
    reason: "The candidate records stronger evidence.",
    evidence: "Compared immutable replay snapshots.",
    evaluatorModel: { provider: "openai", id: "gpt-4" },
    createdAt: new Date().toISOString(),
  });
  await store.reviewRunEvaluation(thread.id, evaluation.id, {
    expectedVerdict: "right_better",
    note: "Human review confirmed the candidate.",
  });
  const created = await store.createEvaluationCasebook({
    threadId: thread.id,
    name: "Reviewed comparison gold set",
    description: "Reviewed product evidence for repeated qualification.",
  });
  const casebook = await store.curateEvaluationCasebookCase(created.id, {
    threadId: thread.id,
    evaluationId: evaluation.id,
  });
  const item = casebook.cases[0];
  if (!item) throw new Error("Web UI Casebook fixture is unavailable");
  const onboardingThread = await store.createThread({
    agentId: agent.id,
    title: "Prepare release Casebook",
  });
  return {
    id: casebook.id,
    name: casebook.revisions.at(-1).name,
    revision: casebook.currentRevision,
    revisionSha256: casebook.revisions.at(-1).contentSha256,
    case: item,
    onboardingThreadId: onboardingThread.id,
  };
}

export async function verifyCasebookQualificationTrials(page, expected) {
  const origin = new URL(page.url()).origin;
  await page.goto(
    `${origin}/?thread=${encodeURIComponent(expected.onboardingThreadId)}`,
  );
  await openCasebookInspector(page);
  await page.locator("#evaluation-suite-title").waitFor({
    state: "visible",
    timeout: 30_000,
  });
  const onboardingButton = page.getByRole("button", {
    name: "Use release template",
  });
  await onboardingButton.waitFor({ state: "visible", timeout: 30_000 });
  const onboardingAvailable = await onboardingButton.isVisible();
  await onboardingButton.click();
  const onboardingCoverage = page.locator(".casebook-template-coverage");
  await onboardingCoverage.waitFor({ state: "visible", timeout: 30_000 });
  const releaseCasebookId = await page
    .locator(".casebook-toolbar select")
    .inputValue();
  const templateCoverageCount =
    (await onboardingCoverage
      .locator("header > strong")
      .first()
      .textContent()) ?? "";
  const templateCoverageOptions = await page
    .getByLabel("Product Casebook coverage slot")
    .locator("option")
    .count();
  const qualificationBlocked = await page
    .getByRole("button", { name: "Qualify evaluator" })
    .isDisabled();
  await onboardingCoverage.locator("details > summary").first().click();
  await onboardingCoverage
    .getByRole("button", { name: "Use in composer" })
    .first()
    .click();
  const onboardingComposerLoaded = (
    await page.locator(".composer textarea").inputValue()
  ).startsWith("Configure Napier from the product UI");
  await page.goto(
    `${origin}/?thread=${encodeURIComponent(expected.case.sourceThreadId)}`,
  );
  await openCasebookInspector(page);
  await page.locator("#evaluation-suite-title").waitFor({
    state: "visible",
    timeout: 30_000,
  });
  await page
    .locator(".casebook-toolbar select")
    .selectOption(releaseCasebookId);
  const productTrial = page.locator(".release-product-trial");
  await productTrial.waitFor({ state: "visible", timeout: 30_000 });
  const productTrialRunOptions = await page
    .getByLabel("Release product Run")
    .locator("option")
    .count();
  await page.waitForFunction(
    () => {
      const button = [
        ...document.querySelectorAll(".release-product-trial > button"),
      ].find((candidate) =>
        candidate.textContent?.includes("Record product trial"),
      );
      return button instanceof HTMLButtonElement && !button.disabled;
    },
    undefined,
    { timeout: 30_000 },
  );
  await productTrial
    .getByRole("button", { name: "Record product trial" })
    .click();
  await page.waitForFunction(
    () =>
      document
        .querySelector(".release-product-version")
        ?.textContent?.includes("1/10 Cases") === true,
    undefined,
    { timeout: 30_000 },
  );
  const productTrialRecorded =
    (await productTrial.locator(".release-product-version").textContent()) ??
    "";
  const controlledHarness = page.locator(".controlled-harness-evidence");
  await controlledHarness.waitFor({ state: "visible", timeout: 30_000 });
  await page
    .getByLabel("Controlled Harness evidence bundle")
    .setInputFiles(
      path.resolve(
        import.meta.dirname,
        "../docs/artifacts/controlled-harness-evidence-0.1.2.json",
      ),
    );
  await page.waitForFunction(
    () =>
      document
        .querySelector(".controlled-harness-evidence")
        ?.textContent?.includes("Coding vs OMP") === true,
    undefined,
    { timeout: 30_000 },
  );
  const controlledHarnessGate =
    (await controlledHarness.locator("header > strong").textContent()) ?? "";
  const controlledHarnessEvidence =
    (await controlledHarness.textContent()) ?? "";
  await page.locator(".casebook-toolbar select").selectOption(expected.id);
  await page.getByText(expected.name, { exact: true }).waitFor({
    state: "visible",
    timeout: 30_000,
  });
  const pattern = `**/api/evaluation-casebooks/${expected.id}/qualifications`;
  let requestCount = 0;
  let activeRequests = 0;
  let maximumConcurrentRequests = 0;
  await page.route(pattern, async (route) => {
    const request = qualificationTrialRequest(route.request());
    if (!request) {
      await route.fallback();
      return;
    }
    requestCount += 1;
    activeRequests += 1;
    maximumConcurrentRequests = Math.max(
      maximumConcurrentRequests,
      activeRequests,
    );
    assert.equal(request.threadId.length > 0, true);
    assert.equal(request.model.provider, "openai");
    assert.equal(request.gate.minimumAgreementRate, 0.8);
    const passed = requestCount !== 2;
    const body = JSON.stringify(
      qualificationExecution(expected, request, requestCount, passed),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      headers: verifiedHeaders(body),
      body,
    });
    activeRequests -= 1;
  });
  try {
    const count = page.getByLabel("Qualification trial count");
    await count.selectOption("3");
    await page.getByRole("button", { name: "Run 3 trials" }).click();
    const summary = page.locator(".casebook-qualification-trial-summary");
    await summary.waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForFunction(
      () =>
        document
          .querySelector(".casebook-qualification-trial-summary")
          ?.textContent?.includes("3/3 completed") === true,
      undefined,
      { timeout: 30_000 },
    );
    return {
      onboardingAvailable,
      onboardingComposerLoaded,
      templateCoverageCount,
      templateCoverageOptions,
      qualificationBlocked,
      productTrialRunOptions,
      productTrialRecorded,
      controlledHarnessGate,
      controlledHarnessEvidence,
      requestCount,
      maximumConcurrentRequests,
      summary: (await summary.textContent()) ?? "",
      historyCount:
        (await page
          .locator(".casebook-qualification-history > summary code")
          .textContent()) ?? "",
    };
  } finally {
    await page.unroute(pattern);
    await page.locator("#inspector-group-task").click();
  }
}

async function openCasebookInspector(page) {
  const group = page.locator("#inspector-group-studio");
  await group.waitFor({ state: "attached", timeout: 30_000 });
  if (!(await group.isVisible())) {
    await page.locator(".inspector-drawer-trigger").click();
  }
  await group.click();
  await page.locator("#inspector-tab-lab").click();
}

export function qualificationTrialRequest(request) {
  if (request.method() !== "POST") return undefined;
  const value = request.postDataJSON();
  assert.equal(
    value !== null && typeof value === "object" && !Array.isArray(value),
    true,
    "Qualification trial request body is invalid",
  );
  return value;
}

async function completedEvidenceRun(store, threadId, agentId, text) {
  const run = await store.createRun({
    threadId,
    agentId,
    model: { provider: "napier", id: "demo" },
  });
  await store.appendEvent({
    threadId,
    runId: run.id,
    type: "message.assistant",
    category: "message",
    visibility: "user",
    payload: { text },
  });
  await store.finishRun(run.id, "completed");
  return run;
}

function qualificationExecution(expected, request, index, passed) {
  const agreementRate = passed ? 1 : 0;
  const actualVerdict = passed ? "right_better" : "left_better";
  const item = expected.case;
  return {
    id: `casequal_web_ui_trial_${String(index)}`,
    casebookId: expected.id,
    casebookRevision: expected.revision,
    casebookRevisionSha256: expected.revisionSha256,
    auditThreadId: request.threadId,
    name: expected.name,
    evaluatorModel: request.model,
    gate: request.gate,
    caseIds: [item.id],
    results: [
      {
        caseId: item.id,
        sourceThreadId: item.sourceThreadId,
        sourceEvaluationId: item.sourceEvaluationId,
        caseSha256: item.contentSha256,
        evaluationSha256: item.adjudicationRevision.evaluationSha256,
        rubricSha256: item.rubricSha256,
        expectedVerdict: "right_better",
        actualVerdict,
        agreement: passed,
        evidenceState: "verified",
        reason: "Repeated qualification fixture judgment.",
        evidence: "The frozen replay snapshots were compared.",
        scores: item.evaluation.scores,
        expectedLeftSnapshotSha256: item.evaluation.leftSnapshotSha256,
        expectedRightSnapshotSha256: item.evaluation.rightSnapshotSha256,
        observedLeftSnapshotSha256: item.evaluation.leftSnapshotSha256,
        observedRightSnapshotSha256: item.evaluation.rightSnapshotSha256,
        status: passed ? "agreed" : "disagreed",
      },
    ],
    sampleCount: 1,
    agreementCount: passed ? 1 : 0,
    inconclusiveCount: 0,
    unverifiedCount: 0,
    agreementRate,
    status: passed ? "passed" : "failed",
    contentSha256: String(index).repeat(64).slice(0, 64),
    startedAt: "2026-08-13T00:00:00.000Z",
    finishedAt: `2026-08-13T00:00:0${String(index)}.000Z`,
  };
}

function verifiedHeaders(body) {
  return {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Napier-Content-SHA256": createHash("sha256").update(body).digest("hex"),
    "X-Napier-Content-SHA256-Mode": "body",
  };
}
