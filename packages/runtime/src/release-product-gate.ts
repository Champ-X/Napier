import type { EvaluationCasebook, RunRecord } from "@napier/contracts";
import type {
  CreateReleaseProductTrialRequest,
  ReleaseProductGateProjection,
  ReleaseProductTrial,
  ReleaseProductTrialAdoption,
  ReleaseProductTrialRunStatus,
  ReleaseProductVersionGate,
} from "@napier/contracts/release-product-trial";

import {
  getEvaluationCasebookTemplate,
  RELEASE_PRODUCT_CASEBOOK_TEMPLATE_ID,
} from "./evaluation-casebook-templates.js";
import { createId, nowIso } from "./ids.js";
import { NAPIER_PRODUCT_VERSION } from "./release-product-identity.js";
import {
  consecutivePassingProductVersions,
  distinctReleaseProductIdentities,
  releaseProductVersionRequiresIdentity,
  resolveReleaseProductIdentity,
  validateRunReleaseIdentity,
} from "./release-product-identity-policy.js";
import { parseReleaseProductTrialAdoption } from "./release-product-trial-adoption.js";
import {
  canonicalJson,
  FAILURE_REASONS,
  RUN_STATUSES,
  sha256,
  STATUSES,
  validCount,
  validProductVersion,
  validTrialIdentity,
  validTrialKeys,
  validTrialMetrics,
  validTrialOutcome,
  validTrialTiming,
} from "./release-product-trial-validation.js";
import { projectReleaseProductVersion } from "./release-product-version-gate.js";

export { NAPIER_PRODUCT_VERSION } from "./release-product-identity.js";
export const RELEASE_PRODUCT_MINIMUM_SUCCESS_RATE = 0.9;
export const RELEASE_PRODUCT_REQUIRED_CONSECUTIVE_VERSIONS = 3;
export const RELEASE_PRODUCT_TRIAL_EVENT_TYPE =
  "evaluation.release-product.trial.recorded";


export function createReleaseProductTrial(
  casebook: EvaluationCasebook,
  run: RunRecord,
  request: CreateReleaseProductTrialRequest,
  options: {
    id?: string;
    recordedAt?: string;
    currentProductVersion?: string;
    currentReleaseIdentitySha256?: string;
  } = {},
): ReleaseProductTrial {
  const currentProductVersion =
    options.currentProductVersion ?? NAPIER_PRODUCT_VERSION;
  const currentReleaseIdentitySha256 = resolveReleaseProductIdentity(
    currentProductVersion,
    options.currentReleaseIdentitySha256,
  );
  if (
    casebook.id !== request.casebookId ||
    casebook.templateId !== RELEASE_PRODUCT_CASEBOOK_TEMPLATE_ID
  ) {
    throw new Error(
      "Release Product Trial requires the fixed Release Product Casebook",
    );
  }
  if (
    currentReleaseIdentitySha256 &&
    run.releaseIdentitySha256 !== currentReleaseIdentitySha256
  ) {
    throw new Error(
      "Release Product Trial Run does not belong to the running release identity",
    );
  }
  const template = getEvaluationCasebookTemplate(casebook.templateId);
  if (!template.cases.some((item) => item.id === request.templateCaseId)) {
    throw new Error(
      `Release Product Case is unknown: ${request.templateCaseId}`,
    );
  }
  if (request.productVersion !== currentProductVersion) {
    throw new Error(
      `Release Product Trial must use the running product version: ${currentProductVersion}`,
    );
  }
  if (
    run.threadId === "" ||
    run.id !== request.runId ||
    !RUN_STATUSES.has(run.status as ReleaseProductTrialRunStatus) ||
    !run.finishedAt
  ) {
    throw new Error(
      "Release Product Trial requires a terminal Run from the selected Thread",
    );
  }
  if (request.status === "passed" && run.status !== "completed") {
    throw new Error("A non-completed Run cannot pass a Release Product Trial");
  }
  assertReleaseProductTrialRequest(request);
  const evidence = {
    threadId: run.threadId,
    casebookId: casebook.id,
    templateId: template.id,
    templateVersion: template.version,
    templateCaseId: request.templateCaseId,
    runId: run.id,
    runStatus: run.status as ReleaseProductTrialRunStatus,
    runStartedAt: run.startedAt,
    runFinishedAt: run.finishedAt,
    productVersion: request.productVersion,
    ...(currentReleaseIdentitySha256
      ? { releaseIdentitySha256: currentReleaseIdentitySha256 }
      : {}),
    status: request.status,
    ...(request.failureReason ? { failureReason: request.failureReason } : {}),
    configurationInterventions: request.configurationInterventions,
    humanInterventions: request.humanInterventions,
    recoveryEvents: request.recoveryEvents,
    uxScore: request.uxScore,
  };
  const trial: ReleaseProductTrial = {
    id: options.id ?? createId("release_trial"),
    ...evidence,
    recordedAt: options.recordedAt ?? nowIso(),
    contentSha256: "",
  };
  trial.contentSha256 = hashReleaseProductTrial(trial);
  return trial;
}

export function parseReleaseProductTrial(
  input: unknown,
): ReleaseProductTrial | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return undefined;
  const value = input as Record<string, unknown>;
  const candidate = value as unknown as ReleaseProductTrial;
  if (
    !validTrialKeys(value) ||
    !validTrialIdentity(candidate) ||
    !validTrialTiming(candidate) ||
    !validTrialOutcome(candidate, value["failureReason"]) ||
    !validTrialMetrics(candidate) ||
    !/^[a-f0-9]{64}$/.test(candidate.contentSha256) ||
    hashReleaseProductTrial(candidate) !== candidate.contentSha256
  ) {
    return undefined;
  }
  return structuredClone(candidate);
}

export function parseDirectReleaseProductGate(
  input: unknown,
): ReleaseProductGateProjection | undefined {
  return parseDirectReleaseProductGateWithIdentity(input);
}

/**
 * Verifies an immutable historical Gate against the release identity recorded
 * when it was produced. Runtime ingestion must continue to use
 * parseDirectReleaseProductGate so current-version evidence stays bound to the
 * running source tree.
 */
export function parseHistoricalDirectReleaseProductGate(
  input: unknown,
  expectedReleaseIdentitySha256: string,
): ReleaseProductGateProjection | undefined {
  let expectedIdentity: string | undefined;
  try {
    expectedIdentity = validateRunReleaseIdentity(
      expectedReleaseIdentitySha256,
    );
  } catch {
    return undefined;
  }
  if (!expectedIdentity) return undefined;
  return parseDirectReleaseProductGateWithIdentity(input, expectedIdentity);
}

function parseDirectReleaseProductGateWithIdentity(
  input: unknown,
  historicalReleaseIdentitySha256?: string,
): ReleaseProductGateProjection | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return undefined;
  const value = input as Record<string, unknown>;
  const keys = Object.keys(value).sort();
  const expectedKeys = [
    "casebookId",
    "consecutivePassingVersions",
    "contentSha256",
    "currentProductVersion",
    "defaultTrackReady",
    "kind",
    "minimumSuccessRate",
    "requiredConsecutiveVersions",
    "schemaVersion",
    "templateId",
    "templateVersion",
    "trials",
    "versions",
    ...(releaseProductVersionRequiresIdentity(
      String(value["currentProductVersion"]),
    )
      ? ["currentReleaseIdentitySha256"]
      : []),
  ].sort();
  if (
    keys.join(",") !== expectedKeys.join(",") ||
    !/^casebook_[a-z0-9]{8,80}$/.test(String(value["casebookId"])) ||
    typeof value["currentProductVersion"] !== "string" ||
    !Array.isArray(value["trials"])
  ) {
    return undefined;
  }
  let currentReleaseIdentitySha256: string | undefined;
  try {
    const recordedIdentity =
      typeof value["currentReleaseIdentitySha256"] === "string"
        ? value["currentReleaseIdentitySha256"]
        : undefined;
    currentReleaseIdentitySha256 = historicalReleaseIdentitySha256
      ? recordedIdentity === historicalReleaseIdentitySha256
        ? historicalReleaseIdentitySha256
        : undefined
      : resolveReleaseProductIdentity(
          value["currentProductVersion"],
          recordedIdentity,
        );
  } catch {
    return undefined;
  }
  if (historicalReleaseIdentitySha256 && !currentReleaseIdentitySha256)
    return undefined;
  const trials = value["trials"].map(parseReleaseProductTrial);
  if (trials.some((trial) => !trial)) return undefined;
  const validTrials = trials as ReleaseProductTrial[];
  if (
    new Set(validTrials.map((trial) => trial.id)).size !== validTrials.length ||
    new Set(
      validTrials.map((trial) => `${trial.runId}:${trial.productVersion}`),
    ).size !== validTrials.length
  ) {
    return undefined;
  }
  const projection = projectReleaseProductGate(
    {
      id: String(value["casebookId"]),
      templateId: RELEASE_PRODUCT_CASEBOOK_TEMPLATE_ID,
    } as EvaluationCasebook,
    validTrials,
    value["currentProductVersion"],
    [],
    currentReleaseIdentitySha256,
  );
  return canonicalJson(projection) === canonicalJson(input)
    ? projection
    : undefined;
}

export function projectReleaseProductGate(
  casebook: EvaluationCasebook,
  trialsInput: ReleaseProductTrial[],
  currentProductVersion = NAPIER_PRODUCT_VERSION,
  adoptionsInput: ReleaseProductTrialAdoption[] = [],
  currentReleaseIdentitySha256 = resolveReleaseProductIdentity(
    currentProductVersion,
  ),
): ReleaseProductGateProjection {
  if (casebook.templateId !== RELEASE_PRODUCT_CASEBOOK_TEMPLATE_ID) {
    throw new Error(
      "Release Product Gate requires the fixed Release Product Casebook",
    );
  }
  const template = getEvaluationCasebookTemplate(casebook.templateId);
  const validCaseIds = new Set(template.cases.map((item) => item.id));
  const criticalCaseIds = template.cases
    .filter((item) => item.critical)
    .map((item) => item.id);
  const trials = trialsInput
    .filter(
      (trial) =>
        trial.casebookId === casebook.id &&
        trial.templateId === template.id &&
        trial.templateVersion === template.version &&
        validCaseIds.has(trial.templateCaseId),
    )
    .slice()
    .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt));
  const adoptions = validAdoptions(casebook, adoptionsInput);
  const effectiveTrials = [
    ...trials,
    ...adoptions.flatMap((adoption) =>
      adoption.sourceTrialIds.flatMap((trialId) => {
        const trial = adoption.sourceGate.trials.find(
          (candidate) => candidate.id === trialId,
        );
        return trial ? [trial] : [];
      }),
    ),
  ].sort((left, right) => left.recordedAt.localeCompare(right.recordedAt));
  const byVersion = new Map<string, ReleaseProductTrial[]>();
  for (const trial of effectiveTrials) {
    const current = byVersion.get(trial.productVersion) ?? [];
    current.push(trial);
    byVersion.set(trial.productVersion, current);
  }
  const versions = [...byVersion.entries()]
    .map(([productVersion, versionTrials]) =>
      releaseProductVersionGate(
        productVersion,
        versionTrials,
        template.cases.length,
        criticalCaseIds,
        productVersion === currentProductVersion
          ? currentReleaseIdentitySha256
          : undefined,
      ),
    )
    .sort((left, right) =>
      (left.lastRecordedAt ?? "").localeCompare(right.lastRecordedAt ?? ""),
    );
  const consecutivePassingVersions =
    consecutivePassingProductVersions(versions);
  const evidence = {
    kind: "napier.release-product-gate" as const,
    schemaVersion: 1 as const,
    currentProductVersion,
    ...(currentReleaseIdentitySha256 ? { currentReleaseIdentitySha256 } : {}),
    casebookId: casebook.id,
    templateId: template.id,
    templateVersion: template.version,
    minimumSuccessRate: RELEASE_PRODUCT_MINIMUM_SUCCESS_RATE,
    requiredConsecutiveVersions: RELEASE_PRODUCT_REQUIRED_CONSECUTIVE_VERSIONS,
    versions,
    consecutivePassingVersions,
    defaultTrackReady:
      consecutivePassingVersions.length >=
        RELEASE_PRODUCT_REQUIRED_CONSECUTIVE_VERSIONS &&
      consecutivePassingVersions.at(-1) === currentProductVersion &&
      distinctReleaseProductIdentities(versions, consecutivePassingVersions),
    trials,
    ...(adoptions.length ? { adoptions } : {}),
  };
  return { ...evidence, contentSha256: sha256(canonicalJson(evidence)) };
}

export function hashReleaseProductTrial(trial: ReleaseProductTrial): string {
  const { contentSha256: _contentSha256, ...evidence } = trial;
  return sha256(canonicalJson(evidence));
}

function validAdoptions(
  casebook: EvaluationCasebook,
  input: ReleaseProductTrialAdoption[],
): ReleaseProductTrialAdoption[] {
  const seenSourceTrialIds = new Set<string>();
  return input
    .flatMap((value) => {
      const adoption = parseReleaseProductTrialAdoption(value);
      if (!adoption || adoption.casebookId !== casebook.id) return [];
      if (!parseDirectReleaseProductGate(adoption.sourceGate)) return [];
      if (
        adoption.sourceTrialIds.some((trialId) =>
          seenSourceTrialIds.has(trialId),
        )
      ) {
        return [];
      }
      for (const trialId of adoption.sourceTrialIds)
        seenSourceTrialIds.add(trialId);
      return [adoption];
    })
    .sort((left, right) => left.adoptedAt.localeCompare(right.adoptedAt));
}

function releaseProductVersionGate(
  productVersion: string,
  trials: ReleaseProductTrial[],
  caseCount: number,
  criticalCaseIds: string[],
  expectedReleaseIdentitySha256?: string,
): ReleaseProductVersionGate {
  return projectReleaseProductVersion(
    productVersion,
    trials,
    caseCount,
    criticalCaseIds,
    RELEASE_PRODUCT_MINIMUM_SUCCESS_RATE,
    releaseProductVersionRequiresIdentity(productVersion),
    expectedReleaseIdentitySha256,
  );
}

function assertReleaseProductTrialRequest(
  request: CreateReleaseProductTrialRequest,
): void {
  if (
    !validProductVersion(request.productVersion) ||
    !STATUSES.has(request.status) ||
    (request.status === "passed" && request.failureReason !== undefined) ||
    (request.status !== "passed" &&
      (!request.failureReason ||
        !FAILURE_REASONS.has(request.failureReason))) ||
    !validCount(request.configurationInterventions) ||
    !validCount(request.humanInterventions) ||
    !validCount(request.recoveryEvents) ||
    !Number.isInteger(request.uxScore) ||
    request.uxScore < 1 ||
    request.uxScore > 5
  ) {
    throw new Error("Release Product Trial request is invalid");
  }
}
