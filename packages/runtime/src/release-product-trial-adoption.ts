import { createHash } from "node:crypto";

import type { EvaluationCasebook } from "@napier/contracts";
import type {
  ReleaseProductGateProjection,
  ReleaseProductTrialAdoption,
} from "@napier/contracts/release-product-trial";

import { RELEASE_PRODUCT_CASEBOOK_TEMPLATE_ID } from "./evaluation-casebook-templates.js";
import { createId, nowIso } from "./ids.js";

export const RELEASE_PRODUCT_TRIAL_ADOPTION_EVENT_TYPE =
  "evaluation.release-product.trial.adopted";

export function createReleaseProductTrialAdoption(
  casebook: EvaluationCasebook,
  sourceGate: ReleaseProductGateProjection,
  sourceTrialIds: string[],
  options: { id?: string; adoptedAt?: string } = {},
): ReleaseProductTrialAdoption {
  if (
    casebook.templateId !== RELEASE_PRODUCT_CASEBOOK_TEMPLATE_ID ||
    sourceGate.templateId !== RELEASE_PRODUCT_CASEBOOK_TEMPLATE_ID ||
    sourceGate.casebookId === casebook.id ||
    sourceGate.adoptions?.length
  ) {
    throw new Error(
      "Release Product Trial adoption requires distinct fixed Casebooks and direct source evidence",
    );
  }
  assertSourceTrialIds(sourceGate, sourceTrialIds);
  const adoption: ReleaseProductTrialAdoption = {
    id: options.id ?? createId("release_adoption"),
    casebookId: casebook.id,
    sourceCasebookId: sourceGate.casebookId,
    sourceGate: structuredClone(sourceGate),
    sourceTrialIds: [...sourceTrialIds],
    adoptedAt: options.adoptedAt ?? nowIso(),
    contentSha256: "",
  };
  adoption.contentSha256 = hashReleaseProductTrialAdoption(adoption);
  return adoption;
}

export function parseReleaseProductTrialAdoption(
  input: unknown,
): ReleaseProductTrialAdoption | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return undefined;
  const keys = Object.keys(input).sort();
  if (
    keys.join(",") !==
    [
      "adoptedAt",
      "casebookId",
      "contentSha256",
      "id",
      "sourceCasebookId",
      "sourceGate",
      "sourceTrialIds",
    ].join(",")
  ) {
    return undefined;
  }
  const candidate = input as ReleaseProductTrialAdoption;
  if (
    !/^release_adoption_[a-z0-9]{8,80}$/.test(candidate.id) ||
    !/^casebook_[a-z0-9]{8,80}$/.test(candidate.casebookId) ||
    !/^casebook_[a-z0-9]{8,80}$/.test(candidate.sourceCasebookId) ||
    candidate.casebookId === candidate.sourceCasebookId ||
    !candidate.sourceGate ||
    candidate.sourceGate.casebookId !== candidate.sourceCasebookId ||
    candidate.sourceGate.templateId !== RELEASE_PRODUCT_CASEBOOK_TEMPLATE_ID ||
    candidate.sourceGate.adoptions?.length ||
    !Number.isFinite(Date.parse(candidate.adoptedAt)) ||
    !/^[a-f0-9]{64}$/.test(candidate.contentSha256)
  ) {
    return undefined;
  }
  try {
    assertSourceTrialIds(candidate.sourceGate, candidate.sourceTrialIds);
  } catch {
    return undefined;
  }
  if (hashReleaseProductTrialAdoption(candidate) !== candidate.contentSha256) {
    return undefined;
  }
  return structuredClone(candidate);
}

export function hashReleaseProductTrialAdoption(
  adoption: ReleaseProductTrialAdoption,
): string {
  const { contentSha256: _contentSha256, ...evidence } = adoption;
  return createHash("sha256").update(canonicalJson(evidence)).digest("hex");
}

function assertSourceTrialIds(
  sourceGate: ReleaseProductGateProjection,
  sourceTrialIds: string[],
): void {
  if (
    !Array.isArray(sourceTrialIds) ||
    sourceTrialIds.length === 0 ||
    sourceTrialIds.length > 10 ||
    new Set(sourceTrialIds).size !== sourceTrialIds.length ||
    sourceTrialIds.some(
      (trialId) =>
        typeof trialId !== "string" ||
        !sourceGate.trials.some((trial) => trial.id === trialId),
    )
  ) {
    throw new Error("Release Product Trial adoption source set is invalid");
  }
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
