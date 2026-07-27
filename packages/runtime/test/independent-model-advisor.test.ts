import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { canonicalJson, sha256 } from "../src/ed25519.js";
import {
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
        issues: [
          {
            code: "evidence",
            severity: "warning",
            guidanceSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          },
        ],
        candidateTextSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        promptSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
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
  });
});

function event(
  seq: number,
  type: string,
  payload: RunEvent["payload"],
): RunEvent {
  return {
    id: `event_advisor_${seq}`,
    threadId: "thread_advisor",
    runId: "run_advisor",
    seq,
    type,
    category: "system",
    visibility: "debug",
    createdAt: new Date(1_780_000_000_000 + seq * 1_000).toISOString(),
    payload,
  };
}
