import { canonicalJson, sha256 } from "../packages/runtime/dist/index.js";

export const BROWSER_AUTONOMY_COMPARISON_TYPE =
  "napier.browser-autonomy-comparison";

export function createBrowserAutonomyComparison(content) {
  const report = {
    ...structuredClone(content),
    contentSha256: sha256(canonicalJson(content)),
  };
  const verification = verifyBrowserAutonomyComparison(report);
  if (!verification.valid)
    throw new Error(
      `Browser autonomy comparison is invalid: ${verification.diagnostics.join(",")}`,
    );
  return report;
}

export function verifyBrowserAutonomyComparison(input) {
  const diagnostics = [];
  if (
    !record(input) ||
    input.type !== BROWSER_AUTONOMY_COMPARISON_TYPE ||
    input.schemaVersion !== 1
  ) {
    return { valid: false, diagnostics: ["report_shape_invalid"] };
  }
  const { contentSha256, ...content } = input;
  if (
    !digest(contentSha256) ||
    sha256(canonicalJson(content)) !== contentSha256
  )
    diagnostics.push("report_hash_invalid");
  if (
    input.model?.provider !== "deepseek" ||
    input.model?.id !== "deepseek-v4-flash" ||
    !digest(input.case?.promptSha256) ||
    input.case?.taskFamily !== "dynamic_browser_evidence" ||
    !Number.isSafeInteger(input.trialCount) ||
    input.trialCount < 1 ||
    input.trialCount > 10
  ) {
    diagnostics.push("comparison_binding_invalid");
  }
  if (
    input.fairness?.sameModel !== true ||
    input.fairness?.samePrompt !== true ||
    input.fairness?.freshProfilePerTrial !== true ||
    input.fairness?.isolatedStatePerExecutor !== true ||
    input.fairness?.sameReadOnlyPolicy !== true ||
    input.fairness?.alternatingOrder !== true
  ) {
    diagnostics.push("fairness_invalid");
  }
  const trials = Array.isArray(input.trials) ? input.trials : [];
  if (
    trials.length !== input.trialCount ||
    !trials.every((trial, index) => validTrial(trial, index + 1))
  ) {
    diagnostics.push("trials_invalid");
  }
  const expectedSummary = summarizeBrowserAutonomyTrials(trials);
  if (canonicalJson(input.summary) !== canonicalJson(expectedSummary))
    diagnostics.push("summary_invalid");
  if (containsSensitiveKey(input) || containsRawEvidence(input))
    diagnostics.push("privacy_invalid");
  return {
    valid: diagnostics.length === 0,
    diagnostics,
    reportSha256: input.contentSha256,
    summary: expectedSummary,
  };
}

export function summarizeBrowserAutonomyTrials(trials) {
  const decisive = trials.filter(
    (trial) =>
      ["passed", "failed"].includes(trial.napier.status) &&
      ["passed", "failed"].includes(trial.browserUse.status),
  );
  const napierPassed = decisive.filter(
    (trial) => trial.napier.status === "passed",
  ).length;
  const browserUsePassed = decisive.filter(
    (trial) => trial.browserUse.status === "passed",
  ).length;
  const napierOnlyPassed = decisive.filter(
    (trial) =>
      trial.napier.status === "passed" && trial.browserUse.status !== "passed",
  ).length;
  const browserUseOnlyPassed = decisive.filter(
    (trial) =>
      trial.browserUse.status === "passed" && trial.napier.status !== "passed",
  ).length;
  const infrastructureFailureCount = trials.length - decisive.length;
  return {
    pairCount: trials.length,
    decisivePairCount: decisive.length,
    infrastructureFailureCount,
    napierPassed,
    browserUsePassed,
    bothPassed: decisive.filter(
      (trial) =>
        trial.napier.status === "passed" &&
        trial.browserUse.status === "passed",
    ).length,
    napierOnlyPassed,
    browserUseOnlyPassed,
    neitherPassed: decisive.filter(
      (trial) =>
        trial.napier.status !== "passed" &&
        trial.browserUse.status !== "passed",
    ).length,
    verdict:
      infrastructureFailureCount > 0 || decisive.length === 0
        ? "not_proven"
        : napierPassed >= browserUsePassed &&
            napierOnlyPassed >= browserUseOnlyPassed
          ? "napier_not_worse"
          : "napier_below_baseline",
  };
}

function validTrial(trial, expectedIndex) {
  return (
    record(trial) &&
    trial.trial === expectedIndex &&
    Array.isArray(trial.order) &&
    canonicalJson(trial.order) ===
      canonicalJson(
        expectedIndex % 2 === 1
          ? ["napier", "browser_use_local"]
          : ["browser_use_local", "napier"],
      ) &&
    validOutcome(trial.napier, "napier") &&
    validOutcome(trial.browserUse, "browser_use_local")
  );
}

function validOutcome(outcome, executor) {
  return (
    record(outcome) &&
    outcome.executor === executor &&
    ["passed", "failed", "inconclusive", "infrastructure_failure"].includes(
      outcome.status,
    ) &&
    typeof outcome.outcomePassed === "boolean" &&
    nonNegativeInteger(outcome.durationMs) &&
    nonNegativeInteger(outcome.stepCount) &&
    nonNegativeInteger(outcome.toolFailureCount) &&
    typeof outcome.secretLeakDetected === "boolean" &&
    outcome.freshProfile === true &&
    digest(outcome.finalOutputSha256) &&
    digest(outcome.diagnosticSetSha256) &&
    (outcome.costUsd === null || nonNegativeNumber(outcome.costUsd)) &&
    (outcome.totalTokens === null || nonNegativeInteger(outcome.totalTokens))
  );
}

function containsSensitiveKey(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsSensitiveKey);
  return Object.entries(value).some(
    ([key, child]) =>
      /(?:api.?key|authorization|cookie|credential|password|secret|token)$/iu.test(
        key,
      ) || containsSensitiveKey(child),
  );
}

function containsRawEvidence(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsRawEvidence);
  return Object.entries(value).some(
    ([key, child]) =>
      /^(?:answer|prompt|quote|reasoning|result|transcript|url)$/iu.test(key) ||
      containsRawEvidence(child),
  );
}

function record(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function digest(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function nonNegativeNumber(value) {
  return Number.isFinite(value) && value >= 0;
}
