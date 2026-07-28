import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  createCombinedModelAdvisorBlock,
  createModelAdvisorCorrectionOutcome,
  createModelAdvisorCorrectionRequest,
  createModelAdvisorCorrectionRequestFromBlock,
  createModelAdvisorNotice,
  ModelAdvisorBlockedError,
} from "../src/model-advisor.js";

const DEFAULT_POLICY = {
  mode: "observe" as const,
  enabledRules: [
    "unverified_verification_claim" as const,
    "destructive_command_reference" as const,
  ],
  maxCorrectionAttempts: 0,
};

describe("model advisor stream lint", () => {
  it("records hash-only notice evidence for unverified verification claims", () => {
    const notice = createModelAdvisorNotice({
      assistantText: "The build and tests passed.",
      runEvents: [],
      turnSource: "user",
      policy: DEFAULT_POLICY,
    });

    expect(notice).toEqual(
      expect.objectContaining({
        kind: "napier.model-advisor-notice",
        schemaVersion: 1,
        source: "deterministic_stream_lint",
        status: "notice",
        diagnosticCount: 1,
        diagnostics: [
          expect.objectContaining({
            ruleId: "unverified_verification_claim",
            severity: "warning",
            matchCount: 1,
            evidenceSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          }),
        ],
        textSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        diagnosticSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(JSON.stringify(notice)).not.toContain("build and tests passed");
  });

  it("suppresses verification-claim notices after verify_workspace succeeds", () => {
    const notice = createModelAdvisorNotice({
      assistantText: "The build and tests passed.",
      turnSource: "user",
      policy: DEFAULT_POLICY,
      runEvents: [
        {
          id: "evt_1",
          threadId: "thread_1",
          runId: "run_1",
          seq: 1,
          type: "tool.completed",
          category: "tool",
          visibility: "user",
          createdAt: "2026-07-27T00:00:00.000Z",
          payload: {
            callId: "tool_1",
            toolName: "verify_workspace",
            status: "completed",
            details: { status: "passed" },
          },
        },
      ],
    });

    expect(notice).toBeUndefined();
  });

  it("does not suppress verification claims after failed verification", () => {
    const notice = createModelAdvisorNotice({
      assistantText: "The build and tests passed.",
      turnSource: "user",
      policy: DEFAULT_POLICY,
      runEvents: [
        {
          id: "evt_1",
          threadId: "thread_1",
          runId: "run_1",
          seq: 1,
          type: "tool.completed",
          category: "tool",
          visibility: "user",
          createdAt: "2026-07-27T00:00:00.000Z",
          payload: {
            callId: "tool_1",
            toolName: "verify_workspace",
            status: "completed",
            details: { status: "failed" },
          },
        },
      ],
    });

    expect(notice).toEqual(
      expect.objectContaining({
        evidence: expect.objectContaining({
          verificationToolCompleted: true,
          verificationToolPassed: false,
        }),
        diagnostics: [
          expect.objectContaining({
            ruleId: "unverified_verification_claim",
          }),
        ],
      }),
    );
  });

  it("does not suppress verification claims after later workspace writes", () => {
    const notice = createModelAdvisorNotice({
      assistantText: "The build and tests passed.",
      turnSource: "user",
      policy: DEFAULT_POLICY,
      runEvents: [
        toolCompleted(1, {
          callId: "tool_1",
          toolName: "verify_workspace",
          status: "completed",
          details: { status: "passed" },
        }),
        toolCompleted(2, {
          callId: "tool_2",
          toolName: "apply_patch",
          status: "completed",
          details: {
            operation: "replace",
            afterSha256: "a".repeat(64),
          },
        }),
      ],
    });

    expect(notice).toEqual(
      expect.objectContaining({
        evidence: expect.objectContaining({
          verificationToolPassed: true,
          workspaceWriteCompleted: true,
          verificationToolPassedAfterWorkspaceWrite: false,
          latestWorkspaceWriteSeq: 2,
          latestPassedVerificationSeq: 1,
        }),
        diagnostics: [
          expect.objectContaining({
            ruleId: "unverified_verification_claim",
          }),
        ],
      }),
    );
  });

  it("suppresses verification claims after writes are re-verified", () => {
    const notice = createModelAdvisorNotice({
      assistantText: "The build and tests passed.",
      turnSource: "user",
      policy: DEFAULT_POLICY,
      runEvents: [
        toolCompleted(1, {
          callId: "tool_1",
          toolName: "apply_patch",
          status: "completed",
          details: {
            operation: "replace",
            afterSha256: "a".repeat(64),
          },
        }),
        toolCompleted(2, {
          callId: "tool_2",
          toolName: "verify_workspace",
          status: "completed",
          details: { status: "passed" },
        }),
      ],
    });

    expect(notice).toBeUndefined();
  });

  it("flags plan completion and artifact verification claims without ledger evidence", () => {
    const notice = createModelAdvisorNotice({
      assistantText:
        "The execution plan is complete and the artifact is verified.",
      turnSource: "user",
      policy: DEFAULT_POLICY,
      runEvents: [],
    });

    expect(notice).toEqual(
      expect.objectContaining({
        evidence: expect.objectContaining({
          planCompleted: false,
          planArtifactVerified: false,
          planCompletedAfterWorkspaceWrite: false,
          planArtifactVerifiedAfterWorkspaceWrite: false,
        }),
        diagnostics: [
          expect.objectContaining({
            ruleId: "unverified_verification_claim",
            matchCount: 2,
          }),
        ],
      }),
    );
  });

  it("suppresses plan and artifact claims when current ledger evidence exists", () => {
    const notice = createModelAdvisorNotice({
      assistantText:
        "The execution plan is complete and the artifact is verified.",
      turnSource: "user",
      policy: DEFAULT_POLICY,
      runEvents: [
        planEvent(1, "plan.artifact.verified", {
          planId: "plan_1",
          artifactId: "artifact_1",
          status: "verified",
        }),
        planEvent(2, "plan.step.completed", {
          planId: "plan_1",
          stepId: "step_1",
          status: "completed",
          planStatus: "completed",
        }),
      ],
    });

    expect(notice).toBeUndefined();
  });

  it("marks plan and artifact evidence stale after later workspace writes", () => {
    const notice = createModelAdvisorNotice({
      assistantText:
        "The execution plan is complete and the artifact is verified.",
      turnSource: "user",
      policy: DEFAULT_POLICY,
      runEvents: [
        planEvent(1, "plan.artifact.verified", {
          planId: "plan_1",
          artifactId: "artifact_1",
          status: "verified",
        }),
        planEvent(2, "plan.step.completed", {
          planId: "plan_1",
          stepId: "step_1",
          status: "completed",
          planStatus: "completed",
        }),
        toolCompleted(3, {
          callId: "tool_3",
          toolName: "apply_patch",
          status: "completed",
          details: {
            operation: "replace",
            afterSha256: "a".repeat(64),
          },
        }),
      ],
    });

    expect(notice).toEqual(
      expect.objectContaining({
        evidence: expect.objectContaining({
          planCompleted: true,
          planArtifactVerified: true,
          planCompletedAfterWorkspaceWrite: false,
          planArtifactVerifiedAfterWorkspaceWrite: false,
          latestWorkspaceWriteSeq: 3,
          latestPlanCompletedSeq: 2,
          latestPlanArtifactVerifiedSeq: 1,
        }),
        diagnostics: [
          expect.objectContaining({
            ruleId: "unverified_verification_claim",
            matchCount: 2,
          }),
        ],
      }),
    );
  });

  it("flags destructive command references without copying text", () => {
    const notice = createModelAdvisorNotice({
      assistantText: "Never run git reset --hard here.",
      runEvents: [],
      turnSource: "user",
      policy: DEFAULT_POLICY,
    });

    expect(notice?.diagnostics).toEqual([
      expect.objectContaining({
        ruleId: "destructive_command_reference",
        severity: "blocker",
      }),
    ]);
    expect(JSON.stringify(notice)).not.toContain("git reset --hard");
  });

  it("marks blocker diagnostics as blocked when policy enforces advisor output", () => {
    const notice = createModelAdvisorNotice({
      assistantText: "Never run git reset --hard here.",
      runEvents: [],
      turnSource: "user",
      policy: {
        mode: "enforce",
        enabledRules: ["destructive_command_reference"],
        maxCorrectionAttempts: 0,
      },
    });

    expect(notice).toEqual(
      expect.objectContaining({
        status: "blocked",
        policy: {
          mode: "enforce",
          enabledRules: ["destructive_command_reference"],
          maxCorrectionAttempts: 0,
        },
        diagnostics: [
          expect.objectContaining({
            ruleId: "destructive_command_reference",
            severity: "blocker",
          }),
        ],
      }),
    );
    if (!notice) throw new Error("Expected blocked notice");
    const legacyError = new ModelAdvisorBlockedError(notice);
    expect(legacyError.notice).toBe(notice);
    expect(legacyError.block).toEqual(
      expect.objectContaining({
        evidenceSha256: notice.diagnosticSetSha256,
        correctable: true,
      }),
    );
  });

  it("does not record notices when advisor policy is off", () => {
    expect(
      createModelAdvisorNotice({
        assistantText:
          "The build and tests passed. Never run git reset --hard.",
        runEvents: [],
        turnSource: "user",
        policy: {
          mode: "off",
          enabledRules: [
            "unverified_verification_claim",
            "destructive_command_reference",
          ],
          maxCorrectionAttempts: 0,
        },
      }),
    ).toBeUndefined();
  });

  it("creates hash-only correction requests and outcomes", () => {
    const notice = createModelAdvisorNotice({
      assistantText: "Never run git reset --hard here.",
      runEvents: [],
      turnSource: "user",
      policy: {
        mode: "enforce",
        enabledRules: ["destructive_command_reference"],
        maxCorrectionAttempts: 1,
      },
    });
    if (!notice) throw new Error("Expected a blocked advisor notice");

    const request = createModelAdvisorCorrectionRequest({
      notice,
      turnSource: "user",
      attempt: 1,
      maxAttempts: 1,
    });
    expect(request.payload).toEqual(
      expect.objectContaining({
        kind: "napier.model-advisor-correction-request",
        attempt: 1,
        maxAttempts: 1,
        predecessorTextSha256: notice.textSha256,
        diagnosticSetSha256: notice.diagnosticSetSha256,
        blockerRuleIds: ["destructive_command_reference"],
        correctivePromptSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(JSON.stringify(request.payload)).not.toContain("git reset --hard");
    expect(request.prompt).not.toContain("git reset --hard");

    const outcome = createModelAdvisorCorrectionOutcome({
      request: request.payload,
      status: "accepted",
      responseTextSha256: "a".repeat(64),
    });
    expect(outcome).toEqual(
      expect.objectContaining({
        kind: "napier.model-advisor-correction-outcome",
        status: "accepted",
        requestContentSha256: request.payload.contentSha256,
        responseTextSha256: "a".repeat(64),
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
  });

  it("combines independent review guidance without persisting its prose", () => {
    const guidance =
      "Remove the unsupported claim and state the remaining evidence gap.";
    const review = {
      kind: "napier.independent-model-advisor-review" as const,
      schemaVersion: 1 as const,
      policyId: "napier.independent-model-advisor.v1" as const,
      turnSource: "user",
      candidateModel: { provider: "worker", id: "worker-1" },
      reviewerModel: { provider: "reviewer", id: "reviewer-1" },
      verdict: "revise" as const,
      score: 65,
      risk: "medium" as const,
      issues: [
        {
          code: "evidence" as const,
          severity: "warning" as const,
          guidanceSha256: "a".repeat(64),
        },
      ],
      diagnosticCodes: [],
      candidateTextSha256: "b".repeat(64),
      candidateTextBytes: 42,
      turnPromptSha256: "c".repeat(64),
      evidenceSha256: "d".repeat(64),
      criteriaSha256: "e".repeat(64),
      inputSha256: "f".repeat(64),
      promptSha256: "1".repeat(64),
      responseSha256: "2".repeat(64),
      reviewSchemaSha256: "3".repeat(64),
      issueSetSha256: "4".repeat(64),
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0.01,
      },
      contentSha256: "5".repeat(64),
    };
    const block = createCombinedModelAdvisorBlock({
      review,
      reviewGuidance: [{ code: "evidence", severity: "warning", guidance }],
      policy: {
        mode: "enforce",
        enabledRules: [],
        maxCorrectionAttempts: 1,
        reviewModel: review.reviewerModel,
      },
    });
    if (!block) throw new Error("Expected independent review blocker");
    expect(block.correctable).toBe(true);
    const request = createModelAdvisorCorrectionRequestFromBlock({
      block,
      turnSource: "user",
      attempt: 1,
      maxAttempts: 1,
    });

    expect(request.prompt).toContain(guidance);
    expect(request.payload).toEqual(
      expect.objectContaining({
        source: "combined_advisor",
        blockerRuleIds: ["independent_review:evidence"],
        predecessorTextSha256: review.candidateTextSha256,
      }),
    );
    expect(JSON.stringify(request.payload)).not.toContain(guidance);

    const inconclusive = createCombinedModelAdvisorBlock({
      review: {
        ...review,
        verdict: "inconclusive",
        score: 0,
        risk: "high",
        issues: [],
        diagnosticCodes: ["review_failed_closed"],
      },
      policy: {
        mode: "enforce",
        enabledRules: [],
        maxCorrectionAttempts: 1,
        reviewModel: review.reviewerModel,
      },
    });
    expect(inconclusive?.correctable).toBe(false);
    expect(() =>
      createModelAdvisorCorrectionRequestFromBlock({
        block: inconclusive!,
        turnSource: "user",
        attempt: 1,
        maxAttempts: 1,
      }),
    ).toThrow("correction request is invalid");
  });
});

function toolCompleted(
  seq: number,
  payload: Record<string, unknown>,
): RunEvent {
  return {
    id: `evt_${seq}`,
    threadId: "thread_1",
    runId: "run_1",
    seq,
    type: "tool.completed",
    category: "tool",
    visibility: "user",
    createdAt: "2026-07-27T00:00:00.000Z",
    payload,
  };
}

function planEvent(
  seq: number,
  type: "plan.artifact.verified" | "plan.step.completed",
  payload: Record<string, unknown>,
): RunEvent {
  return {
    id: `evt_${seq}`,
    threadId: "thread_1",
    runId: "run_1",
    seq,
    type,
    category: "plan",
    visibility: "user",
    createdAt: "2026-07-27T00:00:00.000Z",
    payload,
  };
}
