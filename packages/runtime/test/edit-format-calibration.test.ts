import { expect, it } from "vitest";
import { fauxProvider } from "@earendil-works/pi-ai";
import { createHarnessPolicyProfile } from "../src/harness-policy-profile.js";
import { createModelHarnessExperimentProfile } from "../src/model-harness-experiment-profile.js";
import {
  createEditFormatCalibrationCatalog,
  selectCalibratedEditProfile,
  validateEditFormatCalibrationCatalog,
  type EditFormatCalibrationEntry,
} from "../src/edit-format-calibration.js";
import { formatEditDialectGuidance } from "../src/edit-dialect-adapter.js";
import { inheritedHarnessPolicyOptions } from "../src/harness-run-policy.js";
import { modelHarnessExperimentProfileApplied } from "../src/model-harness-experiment-profile.js";
import type { RunEvent } from "@napier/contracts";

const preference = {
  provider: "deepseek",
  model: "deepseek-v4-flash",
  api: "openai-completions",
  taskPhase: "coding",
  dialect: "unified_diff",
} as const;
const profile = createModelHarnessExperimentProfile({
  id: "calibration-test.v1",
  maxActiveTools: 28,
  policies: createHarnessPolicyProfile({
    id: "calibration-test",
    revision: 1,
    context: { prompt: "legacy", memory: "legacy", workingState: "legacy" },
    toolSurface: {
      editReferences: true,
      unifiedDiff: true,
      editPreference: preference,
    },
    verification: "node-v1",
  }),
});
const identity = {
  provider: preference.provider,
  id: preference.model,
  api: preference.api,
};
const artifact = "a".repeat(64);
function entry(): EditFormatCalibrationEntry {
  return {
    id: "test-only",
    preference,
    profile,
    runtimeArtifactSha256: artifact,
    reportSetSha256: "b".repeat(64),
    gateSha256: "c".repeat(64),
    assessment: {
      cases: 30,
      minimumPairedTrials: 3,
      comparablePairs: 90,
      candidateFormatObserved: 90,
      regressions: 0,
      blockers: 0,
    },
  };
}
const select = (entries: EditFormatCalibrationEntry[], changes = {}) =>
  selectCalibratedEditProfile({
    catalog: createEditFormatCalibrationCatalog(entries),
    model: identity,
    taskPhases: ["coding"],
    runtimeArtifactSha256: artifact,
    ...changes,
  });

it("binds an eligible preference to the tested model, task, runtime and profile without mutating caller data", () => {
  const source = entry();
  const selected = select([source]);
  expect(selected.receipt.status).toBe("selected");
  expect(selected.profile).toEqual(profile);
  source.profile = { ...profile, id: "changed" };
  expect(selected.profile?.id).toBe("calibration-test.v1");
  expect(
    select([entry()], { model: { ...identity, id: "different" } }).profile,
  ).toBeUndefined();
  expect(
    select([entry()], { model: { ...identity, api: "openai-responses" } })
      .profile,
  ).toBeUndefined();
  expect(
    select([entry()], { taskPhases: ["coding", "research"] }).profile,
  ).toBeUndefined();
  expect(
    select([entry()], { runtimeArtifactSha256: "d".repeat(64) }).profile,
  ).toBeUndefined();
  expect(
    select([entry(), { ...entry(), id: "duplicate-scope" }]).receipt.status,
  ).toBe("ambiguous");
});

it.each([
  { cases: 1, comparablePairs: 3, candidateFormatObserved: 3 },
  { minimumPairedTrials: 2 },
  { regressions: 1 },
  { blockers: 1 },
  { candidateFormatObserved: 89 },
])(
  "preserves the current policy when qualification is incomplete: %j",
  (patch) => {
    const candidate = entry();
    candidate.assessment = { ...candidate.assessment, ...patch };
    expect(select([candidate]).receipt.status).toBe("insufficient_evidence");
    expect(select([candidate]).profile).toBeUndefined();
  },
);

it("rejects catalog tampering, a preference different from the tested profile and missing format support", () => {
  const catalog = createEditFormatCalibrationCatalog([entry()]);
  catalog.entries[0]!.preference = { ...preference, model: "different" };
  expect(() => validateEditFormatCalibrationCatalog(catalog)).toThrow();
  expect(() =>
    createEditFormatCalibrationCatalog([
      { ...entry(), preference: { ...preference, dialect: "hashline" } },
    ]),
  ).toThrow("tested profile");
  expect(() =>
    createHarnessPolicyProfile({
      ...profile.policies!,
      toolSurface: { editReferences: true, editPreference: preference },
    }),
  ).toThrow();
});

it("adapts guidance on every invocation and restores the default on fallback or a new task", () => {
  const model = { ...fauxProvider().getModel(), ...identity };
  const messages = [
    { role: "user" as const, content: "Fix the code.", timestamp: 0 },
  ];
  const input = {
    model,
    availableToolNames: ["apply_patch"],
    messages,
    editPreference: preference,
    preferredContentDialect: "unified_diff" as const,
  };
  expect(formatEditDialectGuidance(input)).toContain("dialect: unified_diff");
  expect(
    formatEditDialectGuidance({
      ...input,
      model: { ...model, id: "different" },
    }),
  ).toContain("dialect: hashline");
  expect(
    formatEditDialectGuidance({
      ...input,
      messages: [{ role: "user", content: "Hello", timestamp: 0 }],
    }),
  ).toContain("dialect: hashline");
  expect(formatEditDialectGuidance({ ...input, availableToolNames: [] })).toBe(
    "",
  );
});

it("recovers the original tested preference rather than consulting a changed catalog", () => {
  const applied = modelHarnessExperimentProfileApplied({
    profile,
    receiptSha256: "d".repeat(64),
  });
  const inherited = inheritedHarnessPolicyOptions(
    [
      {
        runId: "run_one",
        type: "harness.experiment.profile.applied",
        payload: applied,
      } as RunEvent,
    ],
    "run_one",
  );
  expect(inherited.harnessExperimentProfile).toEqual(profile);
});
