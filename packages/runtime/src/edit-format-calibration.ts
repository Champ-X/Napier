import type {
  EditFormatPreference,
  HarnessExperimentProfile,
} from "@napier/contracts/harness-experiments";
import { canonicalJson, sha256 } from "./ed25519.js";
import {
  validEditFormatPreference,
  matchedEditFormatPreference,
} from "./edit-format-preference.js";
import { validateModelHarnessExperimentProfile } from "./model-harness-experiment-profile.js";

export const EDIT_FORMAT_ADAPTER_REVISION =
  "edit-intent.exact-hashline-unified.v1";
const HASH = /^[a-f0-9]{64}$/u;

export interface EditFormatCalibrationEntry {
  id: string;
  preference: EditFormatPreference;
  profile: HarnessExperimentProfile;
  runtimeArtifactSha256: string;
  reportSetSha256: string;
  gateSha256: string;
  assessment: {
    cases: number;
    minimumPairedTrials: number;
    comparablePairs: number;
    candidateFormatObserved: number;
    regressions: number;
    blockers: number;
  };
}

export interface EditFormatCalibrationCatalog {
  kind: "napier.edit-format-calibration";
  schemaVersion: 1;
  adapterRevision: string;
  entries: EditFormatCalibrationEntry[];
  contentSha256: string;
}

/** Derived deployment configuration. Report/capsule inspection belongs to the
 * builder; this catalog grants no tools and never relaxes edit preconditions. */
export function createEditFormatCalibrationCatalog(
  entries: readonly EditFormatCalibrationEntry[],
): EditFormatCalibrationCatalog {
  if (!Array.isArray(entries) || entries.length > 64)
    throw new Error("Edit calibration entries exceed the catalog limit");
  const normalized = entries
    .map(validateEntry)
    .sort((a, b) => a.id.localeCompare(b.id));
  if (new Set(normalized.map((entry) => entry.id)).size !== normalized.length)
    throw new Error(
      "Edit calibration entries exceed limits or duplicate an identity",
    );
  const content = {
    kind: "napier.edit-format-calibration" as const,
    schemaVersion: 1 as const,
    adapterRevision: EDIT_FORMAT_ADAPTER_REVISION,
    entries: normalized,
  };
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}

export function validateEditFormatCalibrationCatalog(
  value: unknown,
): EditFormatCalibrationCatalog {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid edit calibration catalog");
  const input = value as EditFormatCalibrationCatalog;
  if (!Array.isArray(input.entries))
    throw new Error("Missing edit calibration entries");
  const rebuilt = createEditFormatCalibrationCatalog(input.entries);
  if (canonicalJson(rebuilt) !== canonicalJson(input))
    throw new Error(
      "Edit calibration catalog binding or adapter revision is invalid",
    );
  return rebuilt;
}

export function selectCalibratedEditProfile(input: {
  catalog: EditFormatCalibrationCatalog;
  model: { provider: string; id: string; api: string };
  taskPhases: readonly string[];
  runtimeArtifactSha256: string;
}) {
  const catalog = validateEditFormatCalibrationCatalog(input.catalog);
  if (!HASH.test(input.runtimeArtifactSha256))
    throw new Error("Invalid current runtime identity");
  const matching = catalog.entries.filter(
    (entry) =>
      entry.runtimeArtifactSha256 === input.runtimeArtifactSha256 &&
      matchedEditFormatPreference(
        entry.preference,
        input.model,
        input.taskPhases,
      ) !== undefined,
  );
  const candidates = matching.filter(isQualified);
  const status =
    candidates.length === 1
      ? "selected"
      : candidates.length > 1
        ? "ambiguous"
        : matching.length
          ? "insufficient_evidence"
          : "no_matching_evidence";
  const selected = candidates.length === 1 ? candidates[0] : undefined;
  const receipt = {
    kind: "napier.edit-format-calibration-selection",
    schemaVersion: 1,
    catalogSha256: catalog.contentSha256,
    adapterRevision: catalog.adapterRevision,
    model: input.model,
    taskPhases: [...input.taskPhases],
    runtimeArtifactSha256: input.runtimeArtifactSha256,
    status,
    ...(selected
      ? {
          entryId: selected.id,
          entrySha256: sha256(canonicalJson(selected)),
          reportSetSha256: selected.reportSetSha256,
          gateSha256: selected.gateSha256,
          profileSha256: selected.profile.contentSha256,
          dialect: selected.preference.dialect,
        }
      : {}),
  };
  return {
    ...(selected ? { profile: structuredClone(selected.profile) } : {}),
    receipt: { ...receipt, contentSha256: sha256(canonicalJson(receipt)) },
  };
}

function isQualified(entry: EditFormatCalibrationEntry): boolean {
  const proof = entry.assessment;
  return (
    proof.cases >= 30 &&
    proof.minimumPairedTrials >= 3 &&
    proof.comparablePairs >= proof.cases * proof.minimumPairedTrials &&
    proof.candidateFormatObserved === proof.comparablePairs &&
    proof.regressions === 0 &&
    proof.blockers === 0
  );
}

function validateEntry(
  value: EditFormatCalibrationEntry,
): EditFormatCalibrationEntry {
  if (
    !value ||
    typeof value !== "object" ||
    !/^[a-z][a-z0-9_.-]{2,79}$/u.test(value.id) ||
    !validEditFormatPreference(value.preference) ||
    ![
      value.runtimeArtifactSha256,
      value.reportSetSha256,
      value.gateSha256,
    ].every((hash) => HASH.test(hash)) ||
    !value.assessment ||
    Object.keys(value.assessment).sort().join() !==
      "blockers,candidateFormatObserved,cases,comparablePairs,minimumPairedTrials,regressions" ||
    !Object.values(value.assessment).every(
      (count) => Number.isSafeInteger(count) && count >= 0 && count <= 10000,
    )
  )
    throw new Error("Invalid edit calibration entry");
  const profile = validateModelHarnessExperimentProfile(value.profile);
  if (
    canonicalJson(profile.policies?.toolSurface.editPreference) !==
    canonicalJson(value.preference)
  )
    throw new Error(
      "Edit calibration preference is not bound to the tested profile",
    );
  if (
    Object.keys(value).sort().join() !==
    "assessment,gateSha256,id,preference,profile,reportSetSha256,runtimeArtifactSha256"
  )
    throw new Error("Unexpected edit calibration entry field");
  return structuredClone({ ...value, profile });
}
