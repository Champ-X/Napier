import type {
  OpenTelemetryTraceArtifactVerification,
  RunReplaySnapshotVerification,
  ThreadReplayBundleVerification,
} from "@napier/contracts";

import type { WebThreadDetail } from "./api";

export interface FixtureCoverageSummary {
  eventCount: number;
  runCount: number;
  planCount: number;
  evaluationCount: number;
  modelContextEnvelopeCount: number;
  embeddedModelContextEnvelopeCount: number;
}

export type FixtureTransferReceipt =
  | ({
      action: "exported" | "imported";
      contentSha256: string;
    } & FixtureCoverageSummary)
  | ({
      action: "verified";
      status: ThreadReplayBundleVerification["status"];
      diagnostics: string[];
      contentSha256?: string;
      eventStreamSha256?: string;
    } & FixtureCoverageSummary);

export interface RunReplayVerificationReceipt {
  status: RunReplaySnapshotVerification["status"];
  diagnostics: string[];
  runId?: string;
  contentSha256?: string;
  eventStreamSha256?: string;
  assistantTextSha256?: string;
  eventCount: number;
  subagentCount: number;
  modelContextEnvelopeCount: number;
  embeddedModelContextEnvelopeCount: number;
}

export interface OpenTelemetryTraceReceipt {
  scope: "thread" | "run";
  traceId: string;
  contentSha256: string;
  eventAnchorSetSha256?: string;
  eventCount: number;
  spanCount: number;
}

export interface OpenTelemetryTraceVerificationReceipt {
  status: OpenTelemetryTraceArtifactVerification["status"];
  diagnostics: string[];
  traceId?: string;
  contentSha256?: string;
  eventStreamSha256?: string;
  eventAnchorSetSha256?: string;
  eventCount: number;
  spanCount: number;
}

type FixtureCoverageSource = {
  events: readonly { type: string }[];
  runs: readonly unknown[];
  plans: readonly unknown[];
  evaluations: readonly unknown[];
};

export function summarizeThreadReplayBundleCoverage(
  bundle: FixtureCoverageSource,
): FixtureCoverageSummary {
  return {
    eventCount: bundle.events.length,
    runCount: bundle.runs.length,
    planCount: bundle.plans.length,
    evaluationCount: bundle.evaluations.length,
    modelContextEnvelopeCount: bundle.events.filter(
      (event) => event.type === "context.model_envelope",
    ).length,
    embeddedModelContextEnvelopeCount:
      countEmbeddedModelContextEnvelopes(bundle),
  };
}

export function importProvenanceReceiptView(
  detail: WebThreadDetail,
): { seq: number; payloadSha256: string } | undefined {
  const receipt = detail.importReceipt;
  const provenance = detail.thread.importProvenance;
  if (!receipt || !provenance) return undefined;
  if (provenance.localImportedThroughSeq !== receipt.seq) return undefined;
  return receipt;
}

function countEmbeddedModelContextEnvelopes(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  if (Array.isArray(value)) {
    return value.reduce(
      (total, item) => total + countEmbeddedModelContextEnvelopes(item),
      0,
    );
  }
  const record = value as Record<string, unknown>;
  const current = Object.hasOwn(record, "modelContextEnvelope") ? 1 : 0;
  return Object.entries(record).reduce((total, [key, child]) => {
    if (key === "modelContextEnvelope") return total;
    return total + countEmbeddedModelContextEnvelopes(child);
  }, current);
}
