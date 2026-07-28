import { describe, expect, it } from "vitest";

import type { WebThreadDetail } from "../src/api";
import {
  importProvenanceReceiptView,
  summarizeThreadReplayBundleCoverage,
} from "../src/use-workspace-view-model";

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

  it("projects aligned imported provenance receipt metadata", () => {
    const detail = {
      thread: {
        importProvenance: {
          sourceThreadId: "thread_source",
          sourceApiVersion: "2026-07-25",
          sourceContentSha256: "a".repeat(64),
          sourceEventStreamSha256: "b".repeat(64),
          sourceEventCount: 3,
          localImportedThroughSeq: 4,
          importedAt: "2026-07-26T00:00:00.000Z",
        },
      },
      importReceipt: {
        seq: 4,
        payloadSha256: "c".repeat(64),
      },
    } as WebThreadDetail;

    expect(importProvenanceReceiptView(detail)).toEqual({
      seq: 4,
      payloadSha256: "c".repeat(64),
    });
    expect(
      importProvenanceReceiptView({
        ...detail,
        importReceipt: { seq: 5, payloadSha256: "d".repeat(64) },
      }),
    ).toBeUndefined();
  });
});
