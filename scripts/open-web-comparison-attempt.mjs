import { canonicalJson, sha256 } from "../packages/runtime/dist/index.js";

import {
  openWebComparisonDigest as digest,
  openWebComparisonExactKeys as exactKeys,
  openWebComparisonIsoDate as isoDate,
  openWebComparisonRecord as record,
  openWebComparisonSemanticVersion as semanticVersion,
} from "./open-web-comparison-report-shape.mjs";

const ATTEMPT_TYPE = "napier.open-web-executor-comparison-attempt";
const REPORT_DIAGNOSTICS = new Set([
  "comparison_cancelled",
  "harness_classification_invalid",
  "report_browser_binding_invalid",
  "report_cases_invalid",
  "report_configuration_invalid",
  "report_environment_invalid",
  "report_hash_invalid",
  "report_privacy_invalid",
  "report_shape_invalid",
  "report_suite_invalid",
  "report_summary_invalid",
  "trial_execution_aborted",
]);
const ATTEMPT_STATUSES = new Set([
  "cancelled",
  "execution_aborted",
  "report_invalid",
]);

export const OPEN_WEB_COMPARISON_ATTEMPT_NOTES = [
  "This receipt records a comparison attempt that did not produce a valid report.",
  "It retains only configuration, environment bindings, verifier diagnostics, and invalid field paths; no prompts, URLs, answers, quotes, model output, reasoning, transcripts, tool arguments, or credentials are retained.",
  "The attempt is not a comparison result and must not be included in campaign outcome aggregates.",
];

export function createOpenWebComparisonAttemptReceipt(input) {
  const content = {
    type: ATTEMPT_TYPE,
    schemaVersion: 1,
    generatedAt: input.generatedAt,
    seed: input.seed,
    trialCount: input.trialCount,
    timeoutMs: input.timeoutMs,
    model: structuredClone(input.model),
    environment: structuredClone(input.environment),
    status: input.status,
    diagnosticScope: input.diagnosticScope,
    diagnostics: [...input.diagnostics],
    caseDiagnostics: [...input.caseDiagnostics],
    notes: [...OPEN_WEB_COMPARISON_ATTEMPT_NOTES],
  };
  const receipt = {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
  const verification = verifyOpenWebComparisonAttemptReceipt(receipt);
  if (!verification.valid) {
    throw new Error(
      `Open-web comparison attempt receipt is invalid: ${verification.diagnostics.join(
        ",",
      )}`,
    );
  }
  return receipt;
}

export function verifyOpenWebComparisonAttemptReceipt(input) {
  if (
    !record(input) ||
    !exactKeys(input, [
      "caseDiagnostics",
      "contentSha256",
      "diagnostics",
      "diagnosticScope",
      "environment",
      "generatedAt",
      "model",
      "notes",
      "schemaVersion",
      "seed",
      "status",
      "timeoutMs",
      "trialCount",
      "type",
    ]) ||
    input.type !== ATTEMPT_TYPE ||
    input.schemaVersion !== 1 ||
    !isoDate(input.generatedAt) ||
    !positiveUint32(input.seed) ||
    !integerBetween(input.trialCount, 1, 3) ||
    !integerBetween(input.timeoutMs, 10_000, 300_000) ||
    canonicalJson(input.model) !==
      canonicalJson({ provider: "deepseek", id: "deepseek-v4-flash" }) ||
    !validEnvironment(input.environment) ||
    !ATTEMPT_STATUSES.has(input.status) ||
    !["captured_before_cleanup", "retrospective_after_cleanup"].includes(
      input.diagnosticScope,
    ) ||
    !validDiagnostics(input.diagnostics) ||
    !validCaseDiagnostics(input.caseDiagnostics) ||
    (input.diagnosticScope === "retrospective_after_cleanup" &&
      canonicalJson(input.caseDiagnostics) !==
        canonicalJson(["cases.unavailable_after_cleanup"])) ||
    (input.diagnosticScope === "captured_before_cleanup" &&
      input.caseDiagnostics.includes("cases.unavailable_after_cleanup")) ||
    (input.status === "report_invalid" &&
      !input.diagnostics.some((diagnostic) =>
        diagnostic.startsWith("report_"),
      )) ||
    (input.status === "execution_aborted" &&
      !input.diagnostics.includes("trial_execution_aborted")) ||
    (input.status === "cancelled" &&
      !input.diagnostics.includes("comparison_cancelled")) ||
    canonicalJson(input.notes) !==
      canonicalJson(OPEN_WEB_COMPARISON_ATTEMPT_NOTES) ||
    !digest(input.contentSha256)
  ) {
    return { valid: false, diagnostics: ["attempt_shape_invalid"] };
  }
  const { contentSha256, ...content } = input;
  if (sha256(canonicalJson(content)) !== contentSha256) {
    return { valid: false, diagnostics: ["attempt_hash_invalid"] };
  }
  if (containsRawEvidence(input) || containsSensitiveKey(input)) {
    return { valid: false, diagnostics: ["attempt_privacy_invalid"] };
  }
  return {
    valid: true,
    diagnostics: [],
    attemptSha256: input.contentSha256,
  };
}

export function openWebComparisonAttemptFileName(attempt) {
  const verification = verifyOpenWebComparisonAttemptReceipt(attempt);
  if (!verification.valid) {
    throw new Error("Open-web comparison attempt receipt is invalid");
  }
  return `napier-open-web-executor-comparison-attempt-seed-${String(
    attempt.seed,
  )}-${attempt.contentSha256.slice(0, 16)}.json`;
}

function validEnvironment(value) {
  return (
    record(value) &&
    exactKeys(value, [
      "architecture",
      "browserRuntimeBytes",
      "browserRuntimeExecutableSha256",
      "browserRuntimeFileCount",
      "browserRuntimeSetSha256",
      "napierVersion",
      "nodeVersion",
      "ompExecutableSha256",
      "ompRuntimeExecutableSha256",
      "ompRuntimeVersion",
      "ompVersion",
      "outerSandbox",
      "platform",
    ]) &&
    value.platform === "darwin" &&
    ["arm64", "x64"].includes(value.architecture) &&
    semanticVersion(value.nodeVersion) &&
    value.napierVersion === "0.1.0" &&
    semanticVersion(value.ompVersion) &&
    value.ompRuntimeVersion === value.ompVersion &&
    digest(value.ompExecutableSha256) &&
    digest(value.ompRuntimeExecutableSha256) &&
    digest(value.browserRuntimeExecutableSha256) &&
    digest(value.browserRuntimeSetSha256) &&
    positiveInteger(value.browserRuntimeFileCount) &&
    positiveInteger(value.browserRuntimeBytes) &&
    value.outerSandbox === "macos-sandbox-exec-guarded"
  );
}

function validDiagnostics(value) {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= REPORT_DIAGNOSTICS.size &&
    new Set(value).size === value.length &&
    value.every((diagnostic) => REPORT_DIAGNOSTICS.has(diagnostic))
  );
}

function validCaseDiagnostics(value) {
  return (
    Array.isArray(value) &&
    value.length <= 64 &&
    new Set(value).size === value.length &&
    value.every(
      (diagnostic) =>
        typeof diagnostic === "string" &&
        /^(?:cases\.(?:incomplete|length|not_started|suite_unavailable|[0-9]+\.invalid|[0-9]+\.tracks\.[0-9]+\.trials\.[0-9]+\.(?:napier|omp)(?:\.(?:shape|executor|status|outcomePassed|failureClass|durationMs|firstOutputMs|usage|toolCounts|toolFailed|manualInterventionCount|diagnostics|evidence|process|security|modelProxy|browserIsolation|browserEnvironmentBinding|publicNetwork|sandbox))?)|cases\.unavailable_after_cleanup)$/u.test(
          diagnostic,
        ),
    )
  );
}

function containsRawEvidence(value) {
  const serialized = JSON.stringify(value);
  return (
    /https?:\/\//iu.test(serialized) ||
    [
      "api.deepseek.com",
      "Dummy PDF file",
      "V8 13.6",
      "reasoning_content",
      "[citation:",
    ].some((marker) => serialized.includes(marker))
  );
}

function containsSensitiveKey(value) {
  if (Array.isArray(value)) return value.some(containsSensitiveKey);
  if (!record(value)) return false;
  return Object.entries(value).some(
    ([key, nested]) =>
      (!["contentSha256"].includes(key) &&
        /(?:api.?key|secret|credential|cookie|authorization|reasoning|transcript|prompt|quote|source.?url|answer|raw.?output)/iu.test(
          key,
        )) ||
      containsSensitiveKey(nested),
  );
}

function integerBetween(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function positiveUint32(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= 0xffff_ffff;
}
