import type { RunEvaluationRecord } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  createEvaluationCasebook,
  createEvaluationCasebookArtifact,
  createEvaluationCasebookCalibrationReport,
  curateEvaluationCase,
  currentCasebookRevision,
  currentEvaluationCasebookCases,
  migrateLegacyEvaluationCasebook,
  removeEvaluationCase,
  reviewRunEvaluation,
  updateEvaluationCasebook,
  validateEvaluationCasebook,
  validateEvaluationCasebookArtifact,
} from "../src/index.js";
import {
  assertEvaluationCasebookTemplateCoverage,
  missingEvaluationCasebookTemplateCases,
  RELEASE_PRODUCT_CASEBOOK_TEMPLATE_ID,
} from "../src/evaluation-casebook-templates.js";

function evaluation(id: string, verdict: RunEvaluationRecord["verdict"] = "right_better"): RunEvaluationRecord {
  return {
    id,
    threadId: `thread_${id}`,
    leftRunId: `run_left_${id}`,
    rightRunId: `run_right_${id}`,
    leftSnapshotSha256: "a".repeat(64),
    rightSnapshotSha256: "b".repeat(64),
    rubric: {
      name: "Release evidence",
      criteria: [
        {
          id: "correctness",
          name: "Correctness",
          description: "The outcome is grounded in evidence.",
        },
      ],
    },
    scores: [
      {
        criterionId: "correctness",
        leftScore: 3,
        rightScore: 4,
        reason: "The candidate records stronger evidence.",
      },
    ],
    verdict,
    reason: "The candidate is better supported.",
    evidence: "Compared immutable replay evidence.",
    evaluatorModel: { provider: "faux", id: "judge-1" },
    createdAt: "2026-07-25T00:00:00.000Z",
  };
}

describe("evaluation Casebooks", () => {
  it("binds reviewed evidence to the fixed Release Product Casebook coverage", () => {
    const first = evaluation("evaluation_release_settings");
    const second = evaluation("evaluation_release_settings_replacement");
    const firstTruth = reviewRunEvaluation(undefined, first, {
      expectedVerdict: "right_better",
      note: "First settings flow reviewed.",
    });
    const secondTruth = reviewRunEvaluation(undefined, second, {
      expectedVerdict: "right_better",
      note: "Replacement settings flow reviewed.",
    });
    const created = createEvaluationCasebook({
      name: "Release Product Casebook",
      templateId: RELEASE_PRODUCT_CASEBOOK_TEMPLATE_ID,
    });
    const curated = curateEvaluationCase(created, first, firstTruth, undefined, "settings");
    expect(curated.templateId).toBe(RELEASE_PRODUCT_CASEBOOK_TEMPLATE_ID);
    expect(currentEvaluationCasebookCases(curated)).toEqual([
      expect.objectContaining({
        templateCaseId: "settings",
        sourceEvaluationId: first.id,
      }),
    ]);
    expect(missingEvaluationCasebookTemplateCases(curated)).toHaveLength(9);
    expect(() => assertEvaluationCasebookTemplateCoverage(curated)).toThrow("template coverage is incomplete");

    const replaced = curateEvaluationCase(curated, second, secondTruth, undefined, "settings");
    expect(currentEvaluationCasebookCases(replaced)).toEqual([
      expect.objectContaining({
        templateCaseId: "settings",
        sourceEvaluationId: second.id,
      }),
    ]);
    expect(currentCasebookRevision(replaced).source).toBe("case_refreshed");
    expect(() => curateEvaluationCase(created, first, firstTruth)).toThrow("template case is invalid");
  });

  it("maintains append-only metadata, curation, refresh, and removal revisions", () => {
    const record = evaluation("evaluation_casebook_one");
    const firstTruth = reviewRunEvaluation(undefined, record, {
      expectedVerdict: "right_better",
      note: "Human review confirmed the candidate.",
    });
    const created = createEvaluationCasebook({
      name: "  Release   gold set ",
      description: " Reviewed release evidence. ",
    });
    expect(created).toEqual(
      expect.objectContaining({
        currentRevision: 1,
        revisions: [
          expect.objectContaining({
            name: "Release gold set",
            description: "Reviewed release evidence.",
            source: "created",
            caseIds: [],
            contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          }),
        ],
      }),
    );
    expect(
      updateEvaluationCasebook(created, {
        name: "Release gold set",
        description: "Reviewed release evidence.",
      }),
    ).toEqual(created);

    const renamed = updateEvaluationCasebook(created, {
      description: "Reviewed release and rollback evidence.",
    });
    expect(renamed.currentRevision).toBe(2);
    expect(currentCasebookRevision(renamed).source).toBe("metadata_updated");

    const curated = curateEvaluationCase(renamed, record, firstTruth);
    const curatedRevision = currentCasebookRevision(curated);
    expect(curatedRevision).toEqual(
      expect.objectContaining({
        revision: 3,
        source: "case_curated",
        sourceEvaluationId: record.id,
        caseIds: [expect.stringMatching(/^evalcase_/)],
      }),
    );
    expect(currentEvaluationCasebookCases(curated)).toEqual([
      expect.objectContaining({
        sourceThreadId: record.threadId,
        sourceEvaluationId: record.id,
        sourceAdjudicationId: firstTruth.id,
        evaluation: record,
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    ]);
    expect(curateEvaluationCase(curated, record, firstTruth)).toEqual(curated);

    const revisedTruth = reviewRunEvaluation(firstTruth, record, {
      expectedVerdict: "tie",
      note: "A second review found equivalent outcomes.",
    });
    const refreshed = curateEvaluationCase(curated, record, revisedTruth);
    const refreshedRevision = currentCasebookRevision(refreshed);
    expect(refreshedRevision).toEqual(
      expect.objectContaining({
        revision: 4,
        source: "case_refreshed",
        caseIds: [expect.stringMatching(/^evalcase_/)],
      }),
    );
    expect(currentEvaluationCasebookCases(refreshed)).toEqual([
      expect.objectContaining({
        adjudicationRevision: expect.objectContaining({
          revision: 2,
          expectedVerdict: "tie",
        }),
      }),
    ]);
    expect(refreshedRevision.caseIds[0]).not.toBe(curatedRevision.caseIds[0]);
    expect(validateEvaluationCasebook(refreshed)).toEqual(refreshed);
    const legacy = structuredClone(refreshed) as unknown as Record<string, unknown> & {
      revisions: Array<Record<string, unknown>>;
    };
    const registry = refreshed.cases;
    delete legacy["cases"];
    legacy.revisions = refreshed.revisions.map((revision) => {
      const { caseIds, ...content } = revision;
      return {
        ...content,
        cases: caseIds.map((caseId) => registry.find((item) => item.id === caseId)!),
      };
    });
    expect(migrateLegacyEvaluationCasebook(legacy as unknown as typeof refreshed)).toEqual(refreshed);

    const removed = removeEvaluationCase(refreshed, refreshedRevision.caseIds[0]!);
    expect(currentCasebookRevision(removed)).toEqual(
      expect.objectContaining({
        revision: 5,
        source: "case_removed",
        caseIds: [],
      }),
    );
    const recurated = curateEvaluationCase(removed, record, revisedTruth);
    expect(currentCasebookRevision(recurated)).toEqual(
      expect.objectContaining({
        revision: 6,
        source: "case_curated",
        caseIds: refreshedRevision.caseIds,
      }),
    );
    expect(recurated.cases).toEqual(refreshed.cases);
    expect(refreshed.revisions[3]).toEqual(refreshedRevision);
  });

  it("builds stable calibration artifacts and rejects tampered truth", () => {
    const record = evaluation("evaluation_casebook_artifact");
    const truth = reviewRunEvaluation(undefined, record, {
      expectedVerdict: "right_better",
      note: "Reviewed against the release evidence.",
    });
    const casebook = curateEvaluationCase(createEvaluationCasebook({ name: "Evaluator gold set" }), record, truth);
    const report = createEvaluationCasebookCalibrationReport(casebook, new Date("2026-07-25T01:00:00.000Z"));
    expect(report).toEqual(
      expect.objectContaining({
        casebookId: casebook.id,
        casebookRevision: 2,
        sampleCount: 1,
        agreementCount: 1,
        agreementRate: 1,
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );

    const first = createEvaluationCasebookArtifact(casebook, new Date("2026-07-25T02:00:00.000Z"));
    const second = createEvaluationCasebookArtifact(casebook, new Date("2026-07-25T03:00:00.000Z"));
    expect(first.generatedAt).not.toBe(second.generatedAt);
    expect(first.contentSha256).toBe(second.contentSha256);
    expect(validateEvaluationCasebookArtifact(first)).toEqual(first);

    const tampered = structuredClone(first);
    tampered.casebook.cases[0]!.adjudicationRevision.note = "Tampered truth.";
    expect(() => validateEvaluationCasebookArtifact(tampered)).toThrow("adjudication hash mismatch");
  });
});
