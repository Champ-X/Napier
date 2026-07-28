import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  evaluationEventTraceSummary,
  evaluationEventTraceView,
} from "../src/evaluation-event-view";

describe("Evaluation event trace view", () => {
  it("projects completed evaluations without reason or evidence text", () => {
    const event = evaluationEvent("evaluation.completed", {
      evaluationId: "evaluation_1234567890",
      leftRunId: "run_left_1234567890",
      rightRunId: "run_right_0987654321",
      verdict: "right_better",
      reason: "TOP_SECRET_EVALUATOR_REASON",
      evidence: "TOP_SECRET_EVALUATOR_EVIDENCE",
      rubric: "TOP_SECRET_RUBRIC_NAME",
      leftSnapshotSha256: "a".repeat(64),
      rightSnapshotSha256: "b".repeat(64),
      comparisonGovernanceSha256: "c".repeat(64),
      contextCoverageStatus: "clean",
      contextCoverageDiagnosticsSha256: "d".repeat(64),
    });

    expect(evaluationEventTraceView(event)).toEqual({
      action: "completed",
      evaluationId: "evaluation_1234567890",
      leftRunId: "run_left_1234567890",
      rightRunId: "run_right_0987654321",
      verdict: "right_better",
      contextCoverageStatus: "clean",
      leftSnapshotSha256: "a".repeat(64),
      rightSnapshotSha256: "b".repeat(64),
      comparisonGovernanceSha256: "c".repeat(64),
      contextCoverageDiagnosticsSha256: "d".repeat(64),
    });
    expect(evaluationEventTraceSummary(event)).toBe(
      `evaluation / completed / evaluation 1234567890 / left-run 1234567890 / right-run 0987654321 / verdict right_better / context clean / left-snapshot ${"a".repeat(12)} / right-snapshot ${"b".repeat(12)} / governance ${"c".repeat(12)} / context-diagnostics ${"d".repeat(12)}`,
    );
    expect(evaluationEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("projects casebook and suite metadata without names", () => {
    const casebook = evaluationEvent("evaluation.casebook.case.curated", {
      casebookId: "casebook_1234567890",
      name: "TOP_SECRET_CASEBOOK_NAME",
      description: "TOP_SECRET_CASEBOOK_DESCRIPTION",
      revision: 3,
      source: "case_curated",
      caseCount: 4,
      caseId: "case_abcdef1234",
      sourceEvaluationId: "evaluation_source_1234567890",
      contentSha256: "e".repeat(64),
    });
    const suite = evaluationEvent("evaluation.suite.created", {
      suiteId: "suite_1234567890",
      name: "TOP_SECRET_SUITE_NAME",
      revision: 2,
      baselineRunId: "run_baseline_1234567890",
      candidateRunIds: ["run_candidate_one", "run_candidate_two"],
      rubric: "TOP_SECRET_SUITE_RUBRIC",
      evaluatorModel: { provider: "openai", id: "gpt-4.1" },
      gate: {
        minimumPassRate: 0.75,
        minimumCandidateScore: 80,
        allowInconclusive: false,
      },
    });

    expect(evaluationEventTraceSummary(casebook)).toBe(
      `evaluation / casebook.case.curated / casebook 1234567890 / case abcdef1234 / source-evaluation 1234567890 / revision 3 / source case_curated / cases 4 / content ${"e".repeat(12)}`,
    );
    expect(evaluationEventTraceSummary(suite)).toBe(
      "evaluation / suite.created / suite 1234567890 / baseline-run 1234567890 / revision 2 / evaluator openai/gpt-4.1 / allow-inconclusive false / candidates 2 / min-pass-rate 0.750 / min-candidate-score 80",
    );
    expect(evaluationEventTraceSummary(casebook)).not.toContain("TOP_SECRET");
    expect(evaluationEventTraceSummary(suite)).not.toContain("TOP_SECRET");
  });

  it("projects consensus and qualification receipts as bounded counts", () => {
    const consensus = evaluationEvent("evaluation.consensus.resolved", {
      evaluationId: "evaluation_1234567890",
      resolutionId: "resolution_1234567890",
      reviewerCount: 3,
      consensusVerdict: "tie",
      agreementRate: 0.667,
      reportSha256: "f".repeat(64),
      adjudicationId: "adjudication_1234567890",
      adjudicationRevision: 2,
      adjudicationSha256: "0".repeat(64),
      resolutionSha256: "1".repeat(64),
    });
    const qualification = evaluationEvent(
      "evaluation.casebook.qualification.completed",
      {
        casebookId: "casebook_1234567890",
        casebookRevision: 4,
        executionId: "casequal_1234567890",
        evaluatorModel: { provider: "anthropic", id: "claude-4" },
        sampleCount: 5,
        agreementCount: 4,
        inconclusiveCount: 1,
        unverifiedCount: 0,
        agreementRate: 0.8,
        status: "passed",
        contentSha256: "2".repeat(64),
      },
    );

    expect(evaluationEventTraceSummary(consensus)).toBe(
      `evaluation / consensus.resolved / evaluation 1234567890 / adjudication 1234567890 / resolution 1234567890 / adjudication-revision 2 / consensus tie / reviewers 3 / agreement-rate 0.667 / adjudication ${"0".repeat(12)} / report ${"f".repeat(12)} / resolution ${"1".repeat(12)}`,
    );
    expect(evaluationEventTraceSummary(qualification)).toBe(
      `evaluation / casebook.qualification.completed / casebook 1234567890 / execution 1234567890 / casebook-revision 4 / status passed / evaluator anthropic/claude-4 / samples 5 / agreements 4 / inconclusive 1 / unverified 0 / agreement-rate 0.800 / content ${"2".repeat(12)}`,
    );
  });

  it("fails closed for malformed and unknown evaluation receipts", () => {
    expect(
      evaluationEventTraceSummary(
        evaluationEvent("evaluation.completed", ["TOP_SECRET_REASON"]),
      ),
    ).toBe("evaluation receipt");
    expect(
      evaluationEventTraceSummary(
        evaluationEvent("evaluation.future", {
          reason: "TOP_SECRET_FUTURE_REASON",
        }),
      ),
    ).toBe("evaluation");
  });
});

function evaluationEvent(type: string, payload: RunEvent["payload"]): RunEvent {
  return {
    id: `event_${type.replaceAll(".", "_")}`,
    threadId: "thread_eval",
    runId: "runctl_eval",
    seq: 31,
    type,
    category: "evaluation",
    visibility: "debug",
    payload,
    createdAt: "2026-07-28T12:00:00.000Z",
  };
}
