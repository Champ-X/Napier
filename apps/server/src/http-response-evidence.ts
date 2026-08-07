import { createHash } from "node:crypto";

import type { JsonValue, RunEvent, RunMetrics } from "@napier/contracts";
import { managementHttpErrorCodeForStatus } from "@napier/contracts/management-http";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export type ContentSha256Mode = "body" | "stable";

export type LedgerEventReceiptProjection = {
  ledgerEventId: string;
  ledgerEventSeq: number;
  ledgerEventSha256: string;
};

export function sha256Json(value: JsonValue): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function sha256Bytes(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function setContentSha256Header(
  context: Context,
  digest: string,
  mode: ContentSha256Mode,
): void {
  context.header("X-Napier-Content-SHA256", digest);
  context.header("X-Napier-Content-SHA256-Mode", mode);
}

export function setBodyContentSha256Header(
  context: Context,
  body: unknown,
): void {
  setContentSha256Header(context, sha256Text(JSON.stringify(body)), "body");
}

export function setStableContentSha256Header(
  context: Context,
  digest: string,
): void {
  setContentSha256Header(context, digest, "stable");
}

export function createLedgerEventReceiptProjection(
  event: RunEvent,
): LedgerEventReceiptProjection {
  return {
    ledgerEventId: event.id,
    ledgerEventSeq: event.seq,
    ledgerEventSha256: sha256Json(event as unknown as JsonValue),
  };
}

export function setLedgerEventReceiptHeaders(
  context: Context,
  receipt: Partial<LedgerEventReceiptProjection>,
): void {
  if (receipt.ledgerEventId) {
    context.header("X-Napier-Ledger-Event-Id", receipt.ledgerEventId);
  }
  if (receipt.ledgerEventSeq !== undefined) {
    context.header("X-Napier-Ledger-Event-Seq", String(receipt.ledgerEventSeq));
  }
  if (receipt.ledgerEventSha256) {
    context.header("X-Napier-Ledger-Event-SHA256", receipt.ledgerEventSha256);
  }
}

export function jsonByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

export function safeFilenameSegment(value: string, fallback: string): string {
  const normalized = value.replace(/[^A-Za-z0-9._-]/gu, "_");
  return normalized.length > 0 ? normalized : fallback;
}

export function setEventBoundaryHeaders(
  context: Context,
  events: readonly RunEvent[],
): void {
  const firstSeq = events[0]?.seq;
  const lastSeq = events.at(-1)?.seq;
  if (firstSeq !== undefined) {
    context.header("X-Napier-First-Event-Seq", String(firstSeq));
  }
  if (lastSeq !== undefined) {
    context.header("X-Napier-Last-Event-Seq", String(lastSeq));
  }
}

export function setRunMetricsHeaders(
  context: Context,
  prefix: string,
  metrics: Omit<RunMetrics, "assistantTextSha256"> & {
    assistantTextSha256?: string;
  },
): void {
  context.header(`${prefix}-Duration-Ms`, String(metrics.durationMs));
  context.header(`${prefix}-Event-Count`, String(metrics.eventCount));
  context.header(`${prefix}-Message-Count`, String(metrics.messageCount));
  context.header(
    `${prefix}-Model-Response-Count`,
    String(metrics.modelResponseCount),
  );
  context.header(
    `${prefix}-Model-Context-Envelope-Count`,
    String(metrics.modelContextEnvelopeCount),
  );
  context.header(
    `${prefix}-Embedded-Model-Context-Envelope-Count`,
    String(metrics.embeddedModelContextEnvelopeCount),
  );
  context.header(
    `${prefix}-Model-Context-Bound-Response-Count`,
    String(metrics.modelContextBoundResponseCount),
  );
  context.header(
    `${prefix}-Model-Context-Unbound-Response-Count`,
    String(metrics.modelContextUnboundResponseCount),
  );
  context.header(`${prefix}-Tool-Call-Count`, String(metrics.toolCallCount));
  context.header(
    `${prefix}-Tool-Completed-Count`,
    String(metrics.toolCompletedCount),
  );
  context.header(
    `${prefix}-Tool-Failed-Count`,
    String(metrics.toolFailedCount),
  );
  context.header(
    `${prefix}-Tool-Blocked-Count`,
    String(metrics.toolBlockedCount),
  );
  context.header(`${prefix}-Subagent-Count`, String(metrics.subagentCount));
  context.header(`${prefix}-Input-Tokens`, String(metrics.inputTokens));
  context.header(`${prefix}-Output-Tokens`, String(metrics.outputTokens));
  context.header(
    `${prefix}-Cache-Read-Tokens`,
    String(metrics.cacheReadTokens),
  );
  context.header(
    `${prefix}-Cache-Write-Tokens`,
    String(metrics.cacheWriteTokens),
  );
  context.header(`${prefix}-Cost-Usd`, String(metrics.costUsd));
  if (metrics.assistantTextSha256) {
    context.header(
      `${prefix}-Assistant-Text-SHA256`,
      metrics.assistantTextSha256,
    );
  }
}

export function jsonError(
  context: Context,
  message: string,
  status: ContentfulStatusCode,
): Response {
  const body = { error: message };
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, body);
  context.header("X-Napier-Error-Status", String(status));
  context.header(
    "X-Napier-Error-Code",
    managementHttpErrorCodeForStatus(status),
  );
  context.header("X-Napier-Error-Message-SHA256", sha256Text(body.error));
  return context.json(body, status);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
