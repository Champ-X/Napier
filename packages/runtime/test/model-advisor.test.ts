import { describe, expect, it } from "vitest";

import { createModelAdvisorNotice } from "../src/model-advisor.js";

const DEFAULT_POLICY = {
  mode: "observe" as const,
  enabledRules: [
    "unverified_verification_claim" as const,
    "destructive_command_reference" as const,
  ],
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
        },
      }),
    ).toBeUndefined();
  });
});
