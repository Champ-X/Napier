import { describe, expect, it } from "vitest";

import { summarizeThreadReplayBundleCoverage } from "../src/use-workspace-view-model";

describe("Run Lab fixture coverage projection", () => {
  it("counts ledger-backed and embedded context envelopes separately", () => {
    const envelope = {
      kind: "napier.model-context-envelope",
      contentSha256:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    };
    const bundle = {
      events: [
        { type: "context.model_envelope" },
        {
          type: "subagent.reviewed",
          payload: {
            review: {
              modelContextEnvelope: envelope,
            },
          },
        },
      ],
      runs: [{ id: "run_1" }, { id: "run_2" }],
      plans: [{ id: "plan_1" }],
      evaluations: [{ id: "evaluation_1" }],
      subagents: [
        {
          outcome: {
            modelContextEnvelope: envelope,
          },
        },
      ],
    };

    expect(summarizeThreadReplayBundleCoverage(bundle)).toEqual({
      eventCount: 2,
      runCount: 2,
      planCount: 1,
      evaluationCount: 1,
      modelContextEnvelopeCount: 1,
      embeddedModelContextEnvelopeCount: 2,
    });
  });
});
