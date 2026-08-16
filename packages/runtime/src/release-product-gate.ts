import { createHash } from "node:crypto";

import type { EvaluationCasebook, RunRecord } from "@napier/contracts";
import type {
  CreateReleaseProductTrialRequest,
  ReleaseProductGateProjection,
  ReleaseProductTrial,
  ReleaseProductTrialAdoption,
  ReleaseProductTrialFailureReason,
  ReleaseProductTrialRunStatus,
  ReleaseProductTrialStatus,
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
} from "./release-product-identity-policy.js";
import { parseReleaseProductTrialAdoption } from "./release-product-trial-adoption.js";
import { projectReleaseProductVersion } from "./release-product-version-gate.js";

export { NAPIER_PRODUCT_VERSION } from "./release-product-identity.js";
export const RELEASE_PRODUCT_MINIMUM_SUCCESS_RATE = 0.9;
export const RELEASE_PRODUCT_REQUIRED_CONSECUTIVE_VERSIONS = 3;
export const RELEASE_PRODUCT_TRIAL_EVENT_TYPE =
  "evaluation.release-product.trial.recorded";

const STATUSES = new Set<ReleaseProductTrialStatus>([
  "passed",
  "failed",
  "inconclusive",
]);
const RUN_STATUSES = new Set<ReleaseProductTrialRunStatus>([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);
const FAILURE_REASONS = new Set<ReleaseProductTrialFailureReason>([
  "task_result",
  "tool_failure",
  "configuration",
  "manual_intervention",
  "recovery_failure",
  "ux_blocker",
]);

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
    currentReleaseIdentitySha256 = resolveReleaseProductIdentity(
      value["currentProductVersion"],
      typeof value["currentReleaseIdentitySha256"] === "string"
        ? value["currentReleaseIdentitySha256"]
        : undefined,
    );
  } catch {
    return undefined;
  }
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

function validProductVersion(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9A-Za-z][0-9A-Za-z._+-]{0,31}$/.test(value)
  );
}

function validCount(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 100;
}

function validTrialIdentity(candidate: ReleaseProductTrial): boolean {
  const identityRequired = releaseProductVersionRequiresIdentity(
    candidate.productVersion,
  );
  return (
    /^release_trial_[a-z0-9]{8,80}$/.test(candidate.id) &&
    /^thread_[a-z0-9]{8,80}$/.test(candidate.threadId) &&
    /^casebook_[a-z0-9]{8,80}$/.test(candidate.casebookId) &&
    candidate.templateId === RELEASE_PRODUCT_CASEBOOK_TEMPLATE_ID &&
    Number.isInteger(candidate.templateVersion) &&
    candidate.templateVersion >= 1 &&
    typeof candidate.templateCaseId === "string" &&
    /^run_[a-z0-9]{8,80}$/.test(candidate.runId) &&
    RUN_STATUSES.has(candidate.runStatus) &&
    (identityRequired
      ? /^[a-f0-9]{64}$/.test(candidate.releaseIdentitySha256 ?? "")
      : candidate.releaseIdentitySha256 === undefined)
  );
}

function validTrialKeys(value: Record<string, unknown>): boolean {
  const allowed = new Set([
    "casebookId",
    "configurationInterventions",
    "contentSha256",
    "failureReason",
    "humanInterventions",
    "id",
    "productVersion",
    "releaseIdentitySha256",
    "recordedAt",
    "recoveryEvents",
    "runFinishedAt",
    "runId",
    "runStartedAt",
    "runStatus",
    "status",
    "templateCaseId",
    "templateId",
    "templateVersion",
    "threadId",
    "uxScore",
  ]);
  return Object.keys(value).every((key) => allowed.has(key));
}

function validTrialTiming(candidate: ReleaseProductTrial): boolean {
  return (
    Number.isFinite(Date.parse(candidate.runStartedAt)) &&
    Number.isFinite(Date.parse(candidate.runFinishedAt)) &&
    Date.parse(candidate.runFinishedAt) >= Date.parse(candidate.runStartedAt) &&
    Number.isFinite(Date.parse(candidate.recordedAt))
  );
}

function validTrialOutcome(
  candidate: ReleaseProductTrial,
  failureReason: unknown,
): boolean {
  if (
    !validProductVersion(candidate.productVersion) ||
    !STATUSES.has(candidate.status)
  )
    return false;
  if (candidate.status === "passed")
    return failureReason === undefined && candidate.runStatus === "completed";
  return (
    typeof failureReason === "string" &&
    FAILURE_REASONS.has(failureReason as ReleaseProductTrialFailureReason)
  );
}

function validTrialMetrics(candidate: ReleaseProductTrial): boolean {
  return (
    validCount(candidate.configurationInterventions) &&
    validCount(candidate.humanInterventions) &&
    validCount(candidate.recoveryEvents) &&
    Number.isInteger(candidate.uxScore) &&
    candidate.uxScore >= 1 &&
    candidate.uxScore <= 5
  );
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
