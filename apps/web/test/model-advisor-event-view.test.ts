import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  modelAdvisorEventTraceSummary,
  modelAdvisorEventTraceView,
} from "../src/model-advisor-event-view";

describe("Model Advisor event trace view", () => {
  it("projects deterministic notices without diagnostic prose", () => {
    const event = advisorEvent("model.advisor.blocked", {
      kind: "napier.model-advisor-notice",
      source: "deterministic_stream_lint",
      turnSource: "user",
      status: "blocked",
      textSha256: "a".repeat(64),
      diagnosticCount: 2,
      diagnosticSetSha256: "b".repeat(64),
      diagnostics: [
        {
          ruleId: "destructive_command_reference",
          severity: "blocker",
          guidance: "TOP_SECRET_GUIDANCE",
        },
      ],
      evidence: { assistantTextBytes: 42 },
      contentSha256: "c".repeat(64),
    });

    expect(modelAdvisorEventTraceView(event)).toEqual({
      action: "blocked",
      status: "blocked",
      source: "deterministic_stream_lint",
      turnSource: "user",
      diagnosticCount: 2,
      textSha256: "a".repeat(64),
      diagnosticSetSha256: "b".repeat(64),
      contentSha256: "c".repeat(64),
    });
    expect(modelAdvisorEventTraceSummary(event)).toBe(
      `advisor / blocked / status blocked / source deterministic_stream_lint / turn user / diagnostics 2 / text ${"a".repeat(12)} / diagnostics ${"b".repeat(12)} / receipt ${"c".repeat(12)}`,
    );
    expect(modelAdvisorEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("projects stale verification evidence without diagnostic prose", () => {
    const event = advisorEvent("model.advisor.notice", {
      kind: "napier.model-advisor-notice",
      source: "deterministic_stream_lint",
      turnSource: "user",
      status: "notice",
      textSha256: "a".repeat(64),
      diagnosticCount: 1,
      diagnosticSetSha256: "b".repeat(64),
      diagnostics: [
        {
          ruleId: "unverified_verification_claim",
          severity: "warning",
          guidance: "TOP_SECRET_STALE_GUIDANCE",
        },
      ],
      evidence: {
        verificationToolCompleted: true,
        verificationToolPassed: true,
        workspaceWriteCompleted: true,
        verificationToolPassedAfterWorkspaceWrite: false,
        latestPassedVerificationSeq: 12,
        latestWorkspaceWriteSeq: 13,
      },
      contentSha256: "c".repeat(64),
    });

    expect(modelAdvisorEventTraceView(event)).toEqual({
      action: "notice",
      status: "notice",
      source: "deterministic_stream_lint",
      turnSource: "user",
      diagnosticCount: 1,
      verificationToolCompleted: true,
      verificationToolPassed: true,
      workspaceWriteCompleted: true,
      verificationToolPassedAfterWorkspaceWrite: false,
      latestWorkspaceWriteSeq: 13,
      latestPassedVerificationSeq: 12,
      textSha256: "a".repeat(64),
      diagnosticSetSha256: "b".repeat(64),
      contentSha256: "c".repeat(64),
    });
    expect(modelAdvisorEventTraceSummary(event)).toBe(
      `advisor / notice / status notice / source deterministic_stream_lint / turn user / diagnostics 1 / verification completed / verification passed / workspace-write / workspace-write-seq 13 / passed-verification-seq 12 / verification-stale / text ${"a".repeat(12)} / diagnostics ${"b".repeat(12)} / receipt ${"c".repeat(12)}`,
    );
    expect(modelAdvisorEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("projects stale plan and artifact evidence without prose", () => {
    const event = advisorEvent("model.advisor.notice", {
      kind: "napier.model-advisor-notice",
      source: "deterministic_stream_lint",
      turnSource: "user",
      status: "notice",
      textSha256: "a".repeat(64),
      diagnosticCount: 1,
      diagnosticSetSha256: "b".repeat(64),
      diagnostics: [
        {
          ruleId: "unverified_verification_claim",
          severity: "warning",
          guidance: "TOP_SECRET_PLAN_GUIDANCE",
        },
      ],
      evidence: {
        workspaceWriteCompleted: true,
        planCompleted: true,
        planArtifactVerified: true,
        goalSatisfied: true,
        planCompletedAfterWorkspaceWrite: false,
        planArtifactVerifiedAfterWorkspaceWrite: false,
        goalSatisfiedAfterWorkspaceWrite: false,
        latestWorkspaceWriteSeq: 17,
        latestPlanCompletedSeq: 12,
        latestPlanArtifactVerifiedSeq: 11,
        latestGoalSatisfiedSeq: 10,
      },
      contentSha256: "c".repeat(64),
    });

    expect(modelAdvisorEventTraceView(event)).toEqual({
      action: "notice",
      status: "notice",
      source: "deterministic_stream_lint",
      turnSource: "user",
      diagnosticCount: 1,
      workspaceWriteCompleted: true,
      planCompleted: true,
      planArtifactVerified: true,
      goalSatisfied: true,
      planCompletedAfterWorkspaceWrite: false,
      planArtifactVerifiedAfterWorkspaceWrite: false,
      goalSatisfiedAfterWorkspaceWrite: false,
      latestWorkspaceWriteSeq: 17,
      latestPlanCompletedSeq: 12,
      latestPlanArtifactVerifiedSeq: 11,
      latestGoalSatisfiedSeq: 10,
      textSha256: "a".repeat(64),
      diagnosticSetSha256: "b".repeat(64),
      contentSha256: "c".repeat(64),
    });
    expect(modelAdvisorEventTraceSummary(event)).toBe(
      `advisor / notice / status notice / source deterministic_stream_lint / turn user / diagnostics 1 / workspace-write / workspace-write-seq 17 / plan-completed / plan-completed-seq 12 / plan-completion-stale / artifact-verified / artifact-verified-seq 11 / artifact-verification-stale / goal-satisfied / goal-satisfied-seq 10 / goal-satisfaction-stale / text ${"a".repeat(12)} / diagnostics ${"b".repeat(12)} / receipt ${"c".repeat(12)}`,
    );
    expect(modelAdvisorEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("projects independent reviews without issue guidance text", () => {
    const event = advisorEvent("model.advisor.independent.reviewed", {
      kind: "napier.independent-model-advisor-review",
      turnSource: "user",
      verdict: "revise",
      risk: "medium",
      score: 62,
      issues: [
        {
          code: "evidence",
          severity: "warning",
          guidance: "TOP_SECRET_ISSUE_GUIDANCE",
        },
      ],
      diagnosticCodes: ["needs_evidence"],
      candidateTextSha256: "d".repeat(64),
      evidenceSha256: "e".repeat(64),
      evidenceSummary: {
        verificationToolCompleted: true,
        verificationToolPassed: true,
        workspaceWriteCompleted: false,
        verificationToolPassedAfterWorkspaceWrite: true,
        latestPassedVerificationSeq: 22,
      },
      inputSha256: "f".repeat(64),
      promptSha256: "0".repeat(64),
      responseSha256: "1".repeat(64),
      issueSetSha256: "2".repeat(64),
      modelContextEnvelope: { contentSha256: "3".repeat(64) },
      contentSha256: "4".repeat(64),
    });

    expect(modelAdvisorEventTraceView(event)).toEqual({
      action: "independent.reviewed",
      turnSource: "user",
      verdict: "revise",
      risk: "medium",
      score: 62,
      diagnosticCount: 1,
      issueCount: 1,
      verificationToolCompleted: true,
      verificationToolPassed: true,
      workspaceWriteCompleted: false,
      verificationToolPassedAfterWorkspaceWrite: true,
      latestPassedVerificationSeq: 22,
      candidateTextSha256: "d".repeat(64),
      evidenceSha256: "e".repeat(64),
      inputSha256: "f".repeat(64),
      promptSha256: "0".repeat(64),
      responseSha256: "1".repeat(64),
      issueSetSha256: "2".repeat(64),
      envelopeSha256: "3".repeat(64),
      contentSha256: "4".repeat(64),
    });
    expect(modelAdvisorEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("projects correction receipts without prompt or response text", () => {
    const requested = advisorEvent("model.advisor.correction.requested", {
      source: "combined_advisor",
      turnSource: "advisor_correction",
      attempt: 1,
      maxAttempts: 2,
      predecessorTextSha256: "5".repeat(64),
      diagnosticSetSha256: "6".repeat(64),
      blockerRuleIds: ["independent_review:evidence"],
      correctivePrompt: "TOP_SECRET_CORRECTION_PROMPT",
      correctivePromptSha256: "7".repeat(64),
      contentSha256: "8".repeat(64),
    });
    const outcome = advisorEvent("model.advisor.correction.outcome", {
      source: "combined_advisor",
      status: "blocked",
      attempt: 1,
      maxAttempts: 2,
      requestContentSha256: "8".repeat(64),
      responseText: "TOP_SECRET_RESPONSE",
      responseTextSha256: "9".repeat(64),
      diagnosticSetSha256: "a".repeat(64),
      contentSha256: "b".repeat(64),
    });

    expect(modelAdvisorEventTraceSummary(requested)).toBe(
      `advisor / correction.requested / source combined_advisor / turn advisor_correction / blockers 1 / attempt 1/2 / diagnostics ${"6".repeat(12)} / receipt ${"8".repeat(12)}`,
    );
    expect(modelAdvisorEventTraceSummary(outcome)).toBe(
      `advisor / correction.outcome / status blocked / source combined_advisor / attempt 1/2 / diagnostics ${"a".repeat(12)} / request ${"8".repeat(12)} / response-text ${"9".repeat(12)} / receipt ${"b".repeat(12)}`,
    );
    expect(modelAdvisorEventTraceSummary(requested)).not.toContain(
      "TOP_SECRET",
    );
    expect(modelAdvisorEventTraceSummary(outcome)).not.toContain("TOP_SECRET");
  });

  it("fails closed for malformed advisor receipts", () => {
    expect(
      modelAdvisorEventTraceSummary(
        advisorEvent("model.advisor.independent.reviewed", [
          "TOP_SECRET_REVIEW",
        ]),
      ),
    ).toBe("model advisor receipt");
  });
});

function advisorEvent(type: string, payload: RunEvent["payload"]): RunEvent {
  return {
    id: `event_${type.replaceAll(".", "_")}`,
    threadId: "thread_advisor",
    runId: "runctl_advisor",
    seq: 19,
    type,
    category: "system",
    visibility: "debug",
    payload,
    createdAt: "2026-07-28T12:00:00.000Z",
  };
}
