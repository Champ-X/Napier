import { canonicalJson, sha256 } from "../packages/runtime/dist/index.js";

import {
  createOpenWebComparisonSuite,
  publicOpenWebComparisonSuite,
  verifyOpenWebComparisonSuite,
} from "./open-web-comparison-suite.mjs";
import {
  OPEN_WEB_COMPARISON_NOTES,
  OPEN_WEB_COMPARISON_NOTES_V2,
  validOpenWebComparisonDiagnostics,
  validOpenWebComparisonFailureClass,
} from "./open-web-comparison-report-policy.mjs";
import {
  openWebComparisonDigest as digest,
  openWebComparisonExactKeys as exactKeys,
  openWebComparisonIsoDate as isoDate,
  openWebComparisonNonNegativeInteger as nonNegativeInteger,
  openWebComparisonNonNegativeNumber as nonNegativeNumber,
  openWebComparisonRecord as record,
  openWebComparisonSafeText as safeText,
  openWebComparisonSemanticVersion as semanticVersion,
} from "./open-web-comparison-report-shape.mjs";
import { openWebComparisonSummary } from "./open-web-comparison-summary.mjs";

const REPORT_TYPE = "napier.open-web-executor-comparison";
const TRACKS = ["default", "controlled"];

export function createOpenWebComparisonReport(content) {
  const report = {
    ...structuredClone(content),
    contentSha256: sha256(canonicalJson(content)),
  };
  const verification = verifyOpenWebComparisonReport(report);
  if (!verification.valid) {
    throw new Error(
      `Open-web comparison report is invalid: ${verification.diagnostics.join(",")}`,
    );
  }
  return report;
}

export { openWebComparisonSummary };

export function diagnoseOpenWebComparisonCases(
  input,
  expectedSuite,
  trialCount,
  schemaVersion,
  environment,
) {
  const cases = Array.isArray(input) ? input : [];
  if (!expectedSuite || !Array.isArray(expectedSuite.cases)) {
    return ["cases.suite_unavailable"];
  }
  if (cases.length !== expectedSuite.cases.length) {
    return ["cases.length"];
  }
  const diagnostics = [];
  for (let caseIndex = 0; caseIndex < cases.length; caseIndex += 1) {
    const entry = cases[caseIndex];
    const expected = expectedSuite.cases[caseIndex];
    if (!validCase(entry, expected, trialCount, schemaVersion, caseIndex)) {
      diagnostics.push(`cases.${String(caseIndex)}.invalid`);
    }
    if (!Array.isArray(entry?.tracks)) continue;
    for (
      let trackIndex = 0;
      trackIndex < entry.tracks.length;
      trackIndex += 1
    ) {
      const track = entry.tracks[trackIndex];
      if (!Array.isArray(track?.trials)) continue;
      for (
        let trialIndex = 0;
        trialIndex < track.trials.length;
        trialIndex += 1
      ) {
        const pair = track.trials[trialIndex];
        if (
          !validPair(pair, trialIndex + 1, trackIndex, caseIndex, schemaVersion)
        ) {
          for (const executor of ["napier", "omp"]) {
            const outcomePath = `cases.${String(caseIndex)}.tracks.${String(
              trackIndex,
            )}.trials.${String(trialIndex)}.${executor}`;
            const outcomeDiagnostics = diagnoseOutcome(
              pair?.[executor],
              executor,
              schemaVersion,
            );
            if (outcomeDiagnostics.length > 0) {
              diagnostics.push(outcomePath);
              diagnostics.push(
                ...outcomeDiagnostics.map(
                  (diagnostic) => `${outcomePath}.${diagnostic}`,
                ),
              );
            }
          }
        }
        if (
          record(environment) &&
          record(pair?.omp) &&
          record(pair.omp.browserIsolation) &&
          (pair.omp.browserIsolation.browserExecutableSha256 !==
            environment.browserRuntimeExecutableSha256 ||
            pair.omp.browserIsolation.browserRuntimeSetSha256 !==
              environment.browserRuntimeSetSha256 ||
            (pair.omp.toolCounts?.browser > 0 &&
              pair.omp.browserIsolation.network?.requestCount === 0))
        ) {
          diagnostics.push(
            `cases.${String(caseIndex)}.tracks.${String(
              trackIndex,
            )}.trials.${String(trialIndex)}.omp.browserEnvironmentBinding`,
          );
        }
      }
    }
  }
  return [...new Set(diagnostics)].slice(0, 64);
}

export function verifyOpenWebComparisonReport(input) {
  const diagnostics = [];
  if (
    !record(input) ||
    !exactKeys(input, [
      "cases",
      "contentSha256",
      "environment",
      "generatedAt",
      "model",
      "notes",
      "schemaVersion",
      "seed",
      "suite",
      "summary",
      "timeoutMs",
      "trialCount",
      "type",
    ]) ||
    input.type !== REPORT_TYPE ||
    (input.schemaVersion !== 1 && input.schemaVersion !== 2) ||
    !digest(input.contentSha256) ||
    !isoDate(input.generatedAt)
  ) {
    return { valid: false, diagnostics: ["report_shape_invalid"] };
  }
  const { contentSha256, ...content } = input;
  if (sha256(canonicalJson(content)) !== contentSha256) {
    diagnostics.push("report_hash_invalid");
  }
  if (
    input.model?.provider !== "deepseek" ||
    input.model?.id !== "deepseek-v4-flash" ||
    !Number.isSafeInteger(input.seed) ||
    !Number.isSafeInteger(input.trialCount) ||
    input.trialCount < 1 ||
    input.trialCount > 3 ||
    !Number.isSafeInteger(input.timeoutMs) ||
    input.timeoutMs < 10_000 ||
    input.timeoutMs > 300_000
  ) {
    diagnostics.push("report_configuration_invalid");
  }
  const expectedSuite = safeSuite(input.seed);
  if (
    !expectedSuite ||
    verifyOpenWebComparisonSuite(expectedSuite).valid !== true ||
    canonicalJson(input.suite) !==
      canonicalJson(publicOpenWebComparisonSuite(expectedSuite))
  ) {
    diagnostics.push("report_suite_invalid");
  }
  if (!validEnvironment(input.environment, input.schemaVersion)) {
    diagnostics.push("report_environment_invalid");
  }
  const cases = Array.isArray(input.cases) ? input.cases : [];
  if (
    !expectedSuite ||
    cases.length !== expectedSuite.cases.length ||
    !cases.every((entry, caseIndex) =>
      validCase(
        entry,
        expectedSuite.cases[caseIndex],
        input.trialCount,
        input.schemaVersion,
        caseIndex,
      ),
    )
  ) {
    diagnostics.push("report_cases_invalid");
  }
  if (
    input.schemaVersion === 2 &&
    !validBrowserEnvironmentBindings(cases, input.environment)
  ) {
    diagnostics.push("report_browser_binding_invalid");
  }
  const expectedSummary =
    diagnostics.includes("report_cases_invalid") || cases.length === 0
      ? undefined
      : openWebComparisonSummary(cases);
  if (
    !expectedSummary ||
    canonicalJson(input.summary) !== canonicalJson(expectedSummary)
  ) {
    diagnostics.push("report_summary_invalid");
  }
  if (
    containsSensitiveKey(input) ||
    containsRawEvidence(input) ||
    canonicalJson(input.notes) !==
      canonicalJson(
        input.schemaVersion === 2
          ? OPEN_WEB_COMPARISON_NOTES_V2
          : OPEN_WEB_COMPARISON_NOTES,
      )
  ) {
    diagnostics.push("report_privacy_invalid");
  }
  return {
    valid: diagnostics.length === 0,
    diagnostics,
    reportSha256: contentSha256,
  };
}

function validCase(value, expected, trialCount, schemaVersion, caseIndex) {
  if (
    !record(value) ||
    !exactKeys(value, [
      "caseId",
      "caseSha256",
      "complexity",
      "oracleSha256",
      "promptSha256",
      "taskFamily",
      "tracks",
    ]) ||
    value.caseId !== expected.id ||
    value.complexity !== expected.complexity ||
    value.taskFamily !== expected.taskFamily ||
    value.promptSha256 !== expected.promptSha256 ||
    value.oracleSha256 !== expected.oracleSha256 ||
    value.caseSha256 !== expected.caseSha256 ||
    !Array.isArray(value.tracks) ||
    value.tracks.length !== TRACKS.length
  ) {
    return false;
  }
  return value.tracks.every(
    (track, trackIndex) =>
      record(track) &&
      exactKeys(track, ["track", "trials"]) &&
      track.track === TRACKS[trackIndex] &&
      Array.isArray(track.trials) &&
      track.trials.length === trialCount &&
      track.trials.every((trial, trialIndex) =>
        validPair(trial, trialIndex + 1, trackIndex, caseIndex, schemaVersion),
      ),
  );
}

function validPair(value, trial, trackIndex, caseIndex, schemaVersion) {
  const expectedOrder =
    (trial + trackIndex + caseIndex) % 2 === 0
      ? ["omp", "napier"]
      : ["napier", "omp"];
  return (
    record(value) &&
    exactKeys(value, ["napier", "omp", "order", "trial"]) &&
    value.trial === trial &&
    canonicalJson(value.order) === canonicalJson(expectedOrder) &&
    validOutcome(value.napier, "napier", schemaVersion) &&
    validOutcome(value.omp, "omp", schemaVersion)
  );
}

function validOutcome(value, executor, schemaVersion) {
  if (
    !record(value) ||
    !exactKeys(value, [
      "diagnostics",
      "durationMs",
      "evidence",
      "executor",
      "failureClass",
      "firstOutputMs",
      "manualInterventionCount",
      ...(executor === "omp" ? ["modelProxy"] : []),
      ...(executor === "omp" ? ["browserIsolation"] : []),
      "outcomePassed",
      "process",
      ...(executor === "omp" ? ["publicNetwork"] : []),
      ...(executor === "omp" ? ["sandbox"] : []),
      "security",
      "status",
      "toolCounts",
      "toolFailed",
      "usage",
    ]) ||
    value.executor !== executor ||
    !["passed", "failed", "inconclusive", "infrastructure_failure"].includes(
      value.status,
    ) ||
    typeof value.outcomePassed !== "boolean" ||
    value.outcomePassed !== (value.status === "passed") ||
    !validOpenWebComparisonFailureClass(value.failureClass) ||
    !nonNegativeInteger(value.durationMs) ||
    !nonNegativeInteger(value.firstOutputMs) ||
    !validUsage(value.usage) ||
    !validToolCounts(value.toolCounts) ||
    !nonNegativeInteger(value.toolFailed) ||
    value.manualInterventionCount !== 0 ||
    !validOpenWebComparisonDiagnostics(value.diagnostics) ||
    !validEvidence(value.evidence) ||
    !validProcess(value.process) ||
    !validSecurity(value.security, value)
  ) {
    return false;
  }
  if (executor === "omp") {
    return (
      validProxy(value.modelProxy, value) &&
      validBrowserIsolation(value.browserIsolation, schemaVersion) &&
      validPublicNetwork(value.publicNetwork) &&
      validSandbox(value.sandbox)
    );
  }
  return (
    value.modelProxy === undefined &&
    value.browserIsolation === undefined &&
    value.publicNetwork === undefined &&
    value.sandbox === undefined
  );
}

function diagnoseOutcome(value, executor, schemaVersion) {
  if (!record(value)) return ["shape"];
  const diagnostics = [];
  if (
    !exactKeys(value, [
      "diagnostics",
      "durationMs",
      "evidence",
      "executor",
      "failureClass",
      "firstOutputMs",
      "manualInterventionCount",
      ...(executor === "omp" ? ["modelProxy"] : []),
      ...(executor === "omp" ? ["browserIsolation"] : []),
      "outcomePassed",
      "process",
      ...(executor === "omp" ? ["publicNetwork"] : []),
      ...(executor === "omp" ? ["sandbox"] : []),
      "security",
      "status",
      "toolCounts",
      "toolFailed",
      "usage",
    ])
  ) {
    diagnostics.push("shape");
  }
  if (value.executor !== executor) diagnostics.push("executor");
  if (
    !["passed", "failed", "inconclusive", "infrastructure_failure"].includes(
      value.status,
    )
  ) {
    diagnostics.push("status");
  }
  if (
    typeof value.outcomePassed !== "boolean" ||
    value.outcomePassed !== (value.status === "passed")
  ) {
    diagnostics.push("outcomePassed");
  }
  if (!validOpenWebComparisonFailureClass(value.failureClass)) {
    diagnostics.push("failureClass");
  }
  if (!nonNegativeInteger(value.durationMs)) diagnostics.push("durationMs");
  if (!nonNegativeInteger(value.firstOutputMs)) {
    diagnostics.push("firstOutputMs");
  }
  if (!validUsage(value.usage)) diagnostics.push("usage");
  if (!validToolCounts(value.toolCounts)) diagnostics.push("toolCounts");
  if (!nonNegativeInteger(value.toolFailed)) diagnostics.push("toolFailed");
  if (value.manualInterventionCount !== 0) {
    diagnostics.push("manualInterventionCount");
  }
  if (!validOpenWebComparisonDiagnostics(value.diagnostics)) {
    diagnostics.push("diagnostics");
  }
  if (!validEvidence(value.evidence)) diagnostics.push("evidence");
  if (!validProcess(value.process)) diagnostics.push("process");
  if (!validSecurity(value.security, value)) diagnostics.push("security");
  if (executor === "omp") {
    if (!validProxy(value.modelProxy, value)) diagnostics.push("modelProxy");
    if (!validBrowserIsolation(value.browserIsolation, schemaVersion)) {
      diagnostics.push("browserIsolation");
    }
    if (!validPublicNetwork(value.publicNetwork)) {
      diagnostics.push("publicNetwork");
    }
    if (!validSandbox(value.sandbox)) diagnostics.push("sandbox");
  }
  return [...new Set(diagnostics)];
}

function validEvidence(value) {
  return (
    record(value) &&
    exactKeys(value, [
      "answerSetSha256",
      "factCount",
      "factSetSha256",
      "finalOutputBytes",
      "finalOutputSha256",
      "quoteSetSha256",
      "sourceUrlSetSha256",
    ]) &&
    digest(value.finalOutputSha256) &&
    nonNegativeInteger(value.finalOutputBytes) &&
    nonNegativeInteger(value.factCount) &&
    digest(value.factSetSha256) &&
    digest(value.answerSetSha256) &&
    digest(value.sourceUrlSetSha256) &&
    digest(value.quoteSetSha256)
  );
}

function validProcess(value) {
  return (
    record(value) &&
    exactKeys(value, [
      "exitCode",
      "frameCount",
      "outputLimitExceeded",
      "parseFailed",
      "stderrBytes",
      "stderrSha256",
      "stdoutBytes",
      "timedOut",
    ]) &&
    (value.exitCode === null || Number.isSafeInteger(value.exitCode)) &&
    typeof value.timedOut === "boolean" &&
    typeof value.outputLimitExceeded === "boolean" &&
    typeof value.parseFailed === "boolean" &&
    nonNegativeInteger(value.stdoutBytes) &&
    nonNegativeInteger(value.stderrBytes) &&
    digest(value.stderrSha256) &&
    nonNegativeInteger(value.frameCount)
  );
}

function validSecurity(value, outcome) {
  return (
    record(value) &&
    exactKeys(value, [
      "ambientCredentialCount",
      "credentialBoundary",
      "persistenceScanBytes",
      "persistenceScanFileCount",
      "secretLeakDetected",
    ]) &&
    typeof value.secretLeakDetected === "boolean" &&
    value.ambientCredentialCount === 0 &&
    nonNegativeInteger(value.persistenceScanBytes) &&
    nonNegativeInteger(value.persistenceScanFileCount) &&
    ["environment_locator", "loopback_proxy_dummy_child_key"].includes(
      value.credentialBoundary,
    ) &&
    (value.secretLeakDetected
      ? outcome.status === "failed" &&
        outcome.outcomePassed === false &&
        outcome.failureClass === "security_leak" &&
        outcome.diagnostics.includes("credential_leak_detected")
      : outcome.failureClass !== "security_leak" &&
        !outcome.diagnostics.includes("credential_leak_detected"))
  );
}

function validProxy(value, outcome) {
  return (
    record(value) &&
    exactKeys(value, [
      "modelMatch",
      "rejectedCount",
      "requestBytes",
      "requestCount",
      "responseBytes",
      "upstreamOriginSha256",
    ]) &&
    nonNegativeInteger(value.requestCount) &&
    nonNegativeInteger(value.requestBytes) &&
    nonNegativeInteger(value.responseBytes) &&
    nonNegativeInteger(value.rejectedCount) &&
    typeof value.modelMatch === "boolean" &&
    digest(value.upstreamOriginSha256) &&
    (value.modelMatch
      ? !outcome.diagnostics.includes("model_proxy_rejected")
      : outcome.status === "infrastructure_failure" &&
        outcome.outcomePassed === false &&
        outcome.failureClass === "external_infrastructure" &&
        outcome.diagnostics.includes("model_proxy_rejected"))
  );
}

function validSandbox(value) {
  return (
    record(value) &&
    exactKeys(value, ["id", "profileSha256"]) &&
    value.id === "macos-sandbox-exec-guarded" &&
    digest(value.profileSha256)
  );
}

function validBrowserIsolation(value, schemaVersion) {
  if (!record(value)) return false;
  if (schemaVersion === 1) {
    return (
      exactKeys(value, ["diagnostic", "requestCount", "status"]) &&
      value.status === "blocked" &&
      value.diagnostic === "nested_chromium_sandbox_unavailable" &&
      nonNegativeInteger(value.requestCount)
    );
  }
  return (
    exactKeys(value, [
      "browserExecutableSha256",
      "browserRuntimeSetSha256",
      "cdpEndpointSha256",
      "diagnostic",
      "launchDurationMs",
      "loopbackOnly",
      "network",
      "processClosed",
      "profilePersistent",
      "sandboxProfileSha256",
      "status",
      "userStateImported",
    ]) &&
    value.status === "ready" &&
    value.diagnostic === "fresh_profile_loopback_cdp" &&
    value.profilePersistent === false &&
    value.userStateImported === false &&
    value.loopbackOnly === true &&
    value.processClosed === true &&
    nonNegativeInteger(value.launchDurationMs) &&
    digest(value.browserExecutableSha256) &&
    digest(value.browserRuntimeSetSha256) &&
    digest(value.sandboxProfileSha256) &&
    digest(value.cdpEndpointSha256) &&
    validPublicNetwork(value.network)
  );
}

function validBrowserEnvironmentBindings(cases, environment) {
  if (!record(environment)) return false;
  const outcomes = cases.flatMap((entry) =>
    Array.isArray(entry?.tracks)
      ? entry.tracks.flatMap((track) =>
          Array.isArray(track?.trials)
            ? track.trials.map((trial) => trial?.omp)
            : [],
        )
      : [],
  );
  return (
    outcomes.length > 0 &&
    outcomes.every(
      (outcome) =>
        record(outcome) &&
        record(outcome.browserIsolation) &&
        outcome.browserIsolation.browserExecutableSha256 ===
          environment.browserRuntimeExecutableSha256 &&
        outcome.browserIsolation.browserRuntimeSetSha256 ===
          environment.browserRuntimeSetSha256 &&
        record(outcome.toolCounts) &&
        record(outcome.browserIsolation.network) &&
        (outcome.toolCounts.browser === 0 ||
          outcome.browserIsolation.network.requestCount > 0 ||
          (outcome.status === "infrastructure_failure" &&
            outcome.failureClass === "external_infrastructure" &&
            outcome.diagnostics.includes("browser_network_evidence_missing"))),
    )
  );
}

function validPublicNetwork(value) {
  return (
    record(value) &&
    exactKeys(value, [
      "connectCount",
      "destinationCount",
      "destinationsSha256",
      "rejectedCount",
      "requestCount",
      "transferredBytes",
    ]) &&
    [
      "connectCount",
      "destinationCount",
      "rejectedCount",
      "requestCount",
      "transferredBytes",
    ].every((key) => nonNegativeInteger(value[key])) &&
    digest(value.destinationsSha256)
  );
}

function validEnvironment(value, schemaVersion) {
  return (
    record(value) &&
    exactKeys(value, [
      "architecture",
      ...(schemaVersion === 2
        ? [
            "browserRuntimeBytes",
            "browserRuntimeExecutableSha256",
            "browserRuntimeFileCount",
            "browserRuntimeSetSha256",
          ]
        : []),
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
    digest(value.ompExecutableSha256) &&
    digest(value.ompRuntimeExecutableSha256) &&
    value.ompRuntimeVersion === value.ompVersion &&
    (schemaVersion === 1 ||
      (nonNegativeInteger(value.browserRuntimeBytes) &&
        nonNegativeInteger(value.browserRuntimeFileCount) &&
        value.browserRuntimeFileCount > 0 &&
        digest(value.browserRuntimeExecutableSha256) &&
        digest(value.browserRuntimeSetSha256))) &&
    value.outerSandbox === "macos-sandbox-exec-guarded"
  );
}

function safeSuite(seed) {
  try {
    return createOpenWebComparisonSuite(seed);
  } catch {
    return undefined;
  }
}

function containsSensitiveKey(value) {
  if (Array.isArray(value)) return value.some(containsSensitiveKey);
  if (!record(value)) return false;
  return Object.entries(value).some(
    ([key, nested]) =>
      (!allowedMetricKey(key) &&
        /(?:api.?key|secret|credential|cookie|authorization|reasoning|transcript|prompt|quote|source.?url|answer)/iu.test(
          key,
        )) ||
      containsSensitiveKey(nested),
  );
}

function containsRawEvidence(value) {
  const serialized = JSON.stringify(value);
  return [
    "api.deepseek.com",
    "nodejs.org/",
    "w3.org/",
    "quotes.toscrape.com",
    "Dummy PDF file",
    "V8 13.6",
    "reasoning_content",
    "[citation:",
  ].some((marker) => serialized.includes(marker));
}

function allowedMetricKey(key) {
  return [
    "promptSha256",
    "oracleSha256",
    "quoteSetSha256",
    "sourceUrlSetSha256",
    "answerSetSha256",
    "upstreamOriginSha256",
    "credentialBoundary",
    "ambientCredentialCount",
    "secretLeakDetected",
  ].includes(key);
}

function validUsage(value) {
  return (
    record(value) &&
    exactKeys(value, [
      "cacheReadTokens",
      "cacheWriteTokens",
      "costUsd",
      "inputTokens",
      "outputTokens",
    ]) &&
    [
      "inputTokens",
      "outputTokens",
      "cacheReadTokens",
      "cacheWriteTokens",
    ].every((key) => nonNegativeInteger(value[key])) &&
    nonNegativeNumber(value.costUsd)
  );
}

function validToolCounts(value) {
  return (
    record(value) &&
    exactKeys(value, ["browser", "fetch", "search"]) &&
    ["search", "fetch", "browser"].every((key) =>
      nonNegativeInteger(value[key]),
    )
  );
}
