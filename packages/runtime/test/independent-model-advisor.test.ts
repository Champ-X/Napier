import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { canonicalJson, sha256 } from "../src/ed25519.js";
import {
  buildIndependentModelAdvisorPrompt,
  INDEPENDENT_MODEL_ADVISOR_REVIEWED_EVENT,
  parseIndependentModelAdvisorResponse,
  projectIndependentModelAdvisorReviews,
  reviewIndependentModelAdvisorCandidate,
} from "../src/independent-model-advisor.js";
import { ModelRegistry } from "../src/models.js";

const CANDIDATE_TEXT =
  "Sensitive candidate prose that must never enter the durable review receipt.";
const GUIDANCE_TEXT =
  "Reconcile the claimed result with the available verification evidence.";

describe("independent Model Advisor", () => {
  it("distinguishes completed verification from passed verification evidence", () => {
    const prompt = buildIndependentModelAdvisorPrompt({
      turnPrompt: "Report release state.",
      candidateText: "The tests passed.",
      candidateModel: { provider: "worker", id: "worker-1" },
      runEvents: [
        event(1, "tool.completed", {
          toolName: "verify_workspace",
          details: { status: "failed" },
        }),
      ],
    });

    expect(prompt.user).toContain('"verificationToolCompleted":true');
    expect(prompt.user).toContain('"verificationToolPassed":false');
    expect(prompt.user).toContain('"workspaceWriteCompleted":false');
    expect(prompt.user).toContain(
      '"verificationToolPassedAfterWorkspaceWrite":false',
    );
  });

  it("reports stale verification evidence after workspace writes", () => {
    const prompt = buildIndependentModelAdvisorPrompt({
      turnPrompt: "Report release state.",
      candidateText: "The tests passed.",
      candidateModel: { provider: "worker", id: "worker-1" },
      runEvents: [
        event(1, "tool.completed", {
          toolName: "verify_workspace",
          status: "completed",
          details: { status: "passed" },
        }),
        event(2, "tool.completed", {
          toolName: "apply_patch",
          status: "completed",
          details: { operation: "replace" },
        }),
      ],
    });

    expect(prompt.user).toContain('"verificationToolPassed":true');
    expect(prompt.user).toContain('"workspaceWriteCompleted":true');
    expect(prompt.user).toContain(
      '"verificationToolPassedAfterWorkspaceWrite":false',
    );
    expect(prompt.user).toContain('"latestPassedVerificationSeq":1');
    expect(prompt.user).toContain('"latestWorkspaceWriteSeq":2');
  });

  it("reports plan, artifact, and goal freshness evidence", () => {
    const prompt = buildIndependentModelAdvisorPrompt({
      turnPrompt: "Report delivery state.",
      candidateText:
        "The plan is complete, the artifact is verified, and the goal is complete.",
      candidateModel: { provider: "worker", id: "worker-1" },
      runEvents: [
        event(1, "plan.artifact.verified", { status: "verified" }, "plan"),
        event(
          2,
          "plan.step.completed",
          { status: "completed", planStatus: "completed" },
          "plan",
        ),
        event(
          3,
          "goal.evaluated",
          { status: "completed", satisfied: true },
          "goal",
        ),
        event(4, "plan.artifact.missing", { status: "missing" }, "plan"),
        event(5, "tool.completed", {
          toolName: "apply_patch",
          status: "completed",
        }),
      ],
    });

    expect(prompt.user).toContain('"planCompleted":true');
    expect(prompt.user).toContain('"planArtifactVerified":true');
    expect(prompt.user).toContain('"goalSatisfied":true');
    expect(prompt.user).toContain('"planCompletedAfterWorkspaceWrite":false');
    expect(prompt.user).toContain(
      '"planArtifactVerifiedAfterWorkspaceWrite":false',
    );
    expect(prompt.user).toContain('"goalSatisfiedAfterWorkspaceWrite":false');
    expect(prompt.user).toContain('"latestPlanCompletedSeq":2');
    expect(prompt.user).toContain('"latestPlanArtifactVerifiedSeq":1');
    expect(prompt.user).toContain('"latestGoalSatisfiedSeq":3');
    expect(prompt.user).toContain('"latestPlanArtifactInvalidatedSeq":4');
  });

  it("uses a zero-tool reviewer and persists only hash-bound guidance", async () => {
    const faux = fauxProvider({ provider: "faux-independent-advisor" });
    faux.setResponses([
      (context) => {
        expect(context.tools).toEqual([]);
        expect(context.systemPrompt).toContain("independent, zero-tool");
        const messages = JSON.stringify(context.messages);
        expect(messages).toContain(CANDIDATE_TEXT);
        expect(messages).toContain("Inspect the release evidence.");
        return fauxAssistantMessage(
          JSON.stringify({
            verdict: "revise",
            score: 68,
            risk: "medium",
            issues: [
              {
                code: "evidence",
                severity: "warning",
                guidance: GUIDANCE_TEXT,
              },
            ],
          }),
        );
      },
    ]);
    const registry = new ModelRegistry();
    registry.registerProvider(faux.provider);

    const result = await reviewIndependentModelAdvisorCandidate(registry, {
      turnSource: "user",
      turnPrompt: "Inspect the release evidence.",
      candidateText: CANDIDATE_TEXT,
      candidateModel: { provider: "worker", id: "worker-1" },
      reviewerModel: { provider: faux.provider.id, id: "faux-1" },
      runEvents: [event(1, "tool.completed", { toolName: "read_file" })],
    });

    expect(result.review).toEqual(
      expect.objectContaining({
        kind: "napier.independent-model-advisor-review",
        verdict: "revise",
        score: 68,
        risk: "medium",
        evidenceSummary: expect.objectContaining({
          eventCount: 1,
          toolCompletedNameCount: 1,
          toolFailedNameCount: 0,
          verificationToolCompleted: false,
          verificationToolPassed: false,
          workspaceWriteCompleted: false,
          verificationToolPassedAfterWorkspaceWrite: false,
          planCompleted: false,
          planArtifactVerified: false,
          goalSatisfied: false,
          planCompletedAfterWorkspaceWrite: false,
          planArtifactVerifiedAfterWorkspaceWrite: false,
          goalSatisfiedAfterWorkspaceWrite: false,
          milestoneCount: 0,
          operatorDecisionRequested: false,
        }),
        issues: [
          {
            code: "evidence",
            severity: "warning",
            guidanceSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          },
        ],
        candidateTextSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        promptSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        modelContextEnvelope: expect.objectContaining({
          kind: "napier.model-context-envelope",
          schemaVersion: 1,
          turnIndex: 0,
          messageCount: 1,
          toolCount: 0,
          contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(result.guidance).toEqual([
      {
        code: "evidence",
        severity: "warning",
        guidance: GUIDANCE_TEXT,
      },
    ]);
    expect(JSON.stringify(result.review)).not.toContain(CANDIDATE_TEXT);
    expect(JSON.stringify(result.review)).not.toContain(GUIDANCE_TEXT);
    expect(JSON.stringify(result.review.modelContextEnvelope)).not.toContain(
      CANDIDATE_TEXT,
    );
    expect(JSON.stringify(result.review.modelContextEnvelope)).not.toContain(
      "Inspect the release evidence.",
    );

    const reviewEvent = event(
      2,
      INDEPENDENT_MODEL_ADVISOR_REVIEWED_EVENT,
      result.review,
    );
    expect(projectIndependentModelAdvisorReviews([reviewEvent])).toEqual([
      result.review,
    ]);
    const tampered = structuredClone(reviewEvent);
    tampered.payload = {
      ...result.review,
      score: 99,
    };
    expect(projectIndependentModelAdvisorReviews([tampered])).toEqual([]);
    const envelope = result.review.modelContextEnvelope;
    expect(envelope).toBeDefined();
    if (!envelope) throw new Error("Expected independent review envelope");
    const tamperedEnvelope = structuredClone(reviewEvent);
    tamperedEnvelope.payload = {
      ...result.review,
      modelContextEnvelope: {
        ...envelope,
        contentSha256: "b".repeat(64),
      },
    };
    expect(projectIndependentModelAdvisorReviews([tamperedEnvelope])).toEqual(
      [],
    );

    const forged = structuredClone(result.review);
    forged.turnSource = "forged_source";
    const { contentSha256: _contentSha256, ...forgedContent } = forged;
    forged.contentSha256 = sha256(canonicalJson(forgedContent));
    expect(
      projectIndependentModelAdvisorReviews([
        event(3, INDEPENDENT_MODEL_ADVISOR_REVIEWED_EVENT, forged),
      ]),
    ).toEqual([]);
  });

  it("rejects contradictory verdicts and duplicate issue codes", () => {
    expect(() =>
      parseIndependentModelAdvisorResponse(
        JSON.stringify({
          verdict: "accept",
          score: 95,
          risk: "low",
          issues: [
            {
              code: "correctness",
              severity: "warning",
              guidance: "Resolve the contradiction.",
            },
          ],
        }),
      ),
    ).toThrow("inconsistent");
    expect(() =>
      parseIndependentModelAdvisorResponse(
        JSON.stringify({
          verdict: "revise",
          score: 60,
          risk: "medium",
          issues: [
            {
              code: "scope",
              severity: "warning",
              guidance: "Return to the requested scope.",
            },
            {
              code: "scope",
              severity: "warning",
              guidance: "Avoid substituting another goal.",
            },
          ],
        }),
      ),
    ).toThrow("distinct");
  });

  it("fails closed without invoking a non-independent reviewer", async () => {
    const registry = new ModelRegistry();
    const result = await reviewIndependentModelAdvisorCandidate(registry, {
      turnSource: "user",
      turnPrompt: "Review this turn.",
      candidateText: CANDIDATE_TEXT,
      candidateModel: { provider: "same", id: "model-1" },
      reviewerModel: { provider: "same", id: "model-1" },
      runEvents: [],
    });

    expect(result.review).toEqual(
      expect.objectContaining({
        verdict: "inconclusive",
        score: 0,
        risk: "high",
        diagnosticCodes: ["reviewer_matches_candidate"],
      }),
    );
    expect(result.review).not.toHaveProperty("modelContextEnvelope");
  });

  it("keeps a hash-only envelope for live reviewer parse failures", async () => {
    const faux = fauxProvider({ provider: "faux-independent-advisor-failure" });
    faux.setResponses([fauxAssistantMessage("not json")]);
    const registry = new ModelRegistry();
    registry.registerProvider(faux.provider);

    const result = await reviewIndependentModelAdvisorCandidate(registry, {
      turnSource: "user",
      turnPrompt: "Inspect the release evidence.",
      candidateText: CANDIDATE_TEXT,
      candidateModel: { provider: "worker", id: "worker-1" },
      reviewerModel: { provider: faux.provider.id, id: "faux-1" },
      runEvents: [],
    });

    expect(result.review).toEqual(
      expect.objectContaining({
        verdict: "inconclusive",
        score: 0,
        risk: "high",
        diagnosticCodes: ["review_failed_closed"],
        modelContextEnvelope: expect.objectContaining({
          contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    );
    expect(JSON.stringify(result.review)).not.toContain("not json");
    expect(JSON.stringify(result.review.modelContextEnvelope)).not.toContain(
      CANDIDATE_TEXT,
    );
  });
});

function event(
  seq: number,
  type: string,
  payload: RunEvent["payload"],
  category = "system",
): RunEvent {
  return {
    id: `event_advisor_${seq}`,
    threadId: "thread_advisor",
    runId: "run_advisor",
    seq,
    type,
    category,
    visibility: "debug",
    createdAt: new Date(1_780_000_000_000 + seq * 1_000).toISOString(),
    payload,
  };
}
