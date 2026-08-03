import type { ThreadDetail } from "@napier/contracts";
import type { Context } from "hono";

import {
  jsonByteLength,
  setBodyContentSha256Header,
  sha256Json,
} from "./http-response-evidence.js";

export function setThreadDetailProjectionHeaders(
  context: Context,
  detail: ThreadDetail,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, detail);
  context.header("X-Napier-Thread-Id", detail.thread.id);
  context.header(
    "X-Napier-Thread-Detail-Bytes",
    String(jsonByteLength(detail)),
  );
  context.header(
    "X-Napier-Thread-Event-Bytes",
    String(jsonByteLength(detail.events)),
  );
  context.header("X-Napier-Run-Count", String(detail.runs.length));
  context.header("X-Napier-Event-Count", String(detail.events.length));
  context.header("X-Napier-Plan-Count", String(detail.plans.length));
  context.header(
    "X-Napier-Evaluation-Count",
    String(detail.evaluations.length),
  );
  context.header("X-Napier-Subagent-Count", String(detail.subagents.length));
  context.header(
    "X-Napier-Run-Control-Message-Count",
    String(detail.runControlMessages.length),
  );
  context.header(
    "X-Napier-Operator-Decision-Count",
    String(detail.operatorDecisions.length),
  );
  context.header(
    "X-Napier-Recovery-Assessment-Count",
    String(detail.automaticRecoveryAssessments.length),
  );
  context.header(
    "X-Napier-Recovery-Attempt-Count",
    String(detail.automaticRecoveryAttempts.length),
  );
  setImportProvenanceHeaders(context, detail);
}

function setImportProvenanceHeaders(
  context: Context,
  detail: ThreadDetail,
): void {
  const provenance = detail.thread.importProvenance;
  if (!provenance) return;
  context.header("X-Napier-Import-Source-Thread-Id", provenance.sourceThreadId);
  context.header(
    "X-Napier-Import-Source-API-Version",
    provenance.sourceApiVersion,
  );
  context.header(
    "X-Napier-Import-Source-Content-SHA256",
    provenance.sourceContentSha256,
  );
  context.header(
    "X-Napier-Import-Source-Event-Stream-SHA256",
    provenance.sourceEventStreamSha256,
  );
  context.header(
    "X-Napier-Import-Source-Event-Count",
    String(provenance.sourceEventCount),
  );
  setOptionalProvenanceHeaders(context, provenance);
  context.header("X-Napier-Imported-At", provenance.importedAt);
  const receipt = importProvenanceReceipt(detail);
  if (receipt) {
    context.header("X-Napier-Import-Receipt-Seq", String(receipt.seq));
    context.header("X-Napier-Import-Receipt-SHA256", receipt.payloadSha256);
  }
}

function setOptionalProvenanceHeaders(
  context: Context,
  provenance: NonNullable<ThreadDetail["thread"]["importProvenance"]>,
): void {
  if (provenance.localImportedThroughSeq !== undefined) {
    context.header(
      "X-Napier-Import-Local-Imported-Through-Seq",
      String(provenance.localImportedThroughSeq),
    );
  }
  if (provenance.sourceModelContextEnvelopeCount !== undefined) {
    context.header(
      "X-Napier-Import-Source-Model-Context-Envelope-Count",
      String(provenance.sourceModelContextEnvelopeCount),
    );
  }
  if (provenance.sourceEmbeddedModelContextEnvelopeCount !== undefined) {
    context.header(
      "X-Napier-Import-Source-Embedded-Model-Context-Envelope-Count",
      String(provenance.sourceEmbeddedModelContextEnvelopeCount),
    );
  }
}

function importProvenanceReceipt(
  detail: ThreadDetail,
): { seq: number; payloadSha256: string } | undefined {
  const provenance = detail.thread.importProvenance;
  if (provenance?.localImportedThroughSeq === undefined) return undefined;
  const event = detail.events.find(
    (candidate) =>
      candidate.type === "thread.imported" &&
      candidate.seq === provenance.localImportedThroughSeq &&
      candidate.category === "lifecycle" &&
      candidate.visibility === "debug" &&
      candidate.createdAt === provenance.importedAt,
  );
  return event
    ? { seq: event.seq, payloadSha256: sha256Json(event.payload) }
    : undefined;
}
