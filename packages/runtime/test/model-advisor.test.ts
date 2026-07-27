import { describe, expect, it } from "vitest";

import {
  createModelAdvisorCorrectionOutcome,
  createModelAdvisorCorrectionRequest,
  createModelAdvisorNotice,
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
          },
        },
      ],
    });

    expect(notice).toBeUndefined();
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
});
