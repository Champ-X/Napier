import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  channelEventTraceSummary,
  channelEventTraceView,
} from "../src/channel-event-view";

describe("Channel event trace view", () => {
  it("projects channel administration metadata without channel names", () => {
    const event = channelEvent("channel.created", {
      channelId: "channel_1234567890",
      name: "TOP_SECRET_CHANNEL_NAME",
      type: "webhook",
      adapter: "github_webhook",
      status: "active",
      token: "TOP_SECRET_RAW_TOKEN",
      tokenFingerprint: "abc123def456",
      policyTemplate: "signed_standard",
      signatureRequired: true,
      signatureAlgorithm: "hmac_sha256",
      retryMaxAttempts: 3,
      retryBaseDelayMs: 250,
      revision: 1,
    });

    expect(channelEventTraceView(event)).toEqual({
      action: "created",
      channelId: "channel_1234567890",
      type: "webhook",
      adapter: "github_webhook",
      status: "active",
      tokenFingerprint: "abc123def456",
      policyTemplate: "signed_standard",
      signatureRequired: true,
      signatureAlgorithm: "hmac_sha256",
      retryMaxAttempts: 3,
      retryBaseDelayMs: 250,
      revision: 1,
    });
    expect(channelEventTraceSummary(event)).toBe(
      "channel / created / channel 1234567890 / type webhook / adapter github_webhook / status active / policy signed_standard / signature-required true / signature-algorithm hmac_sha256 / retry 3/250ms / revision 1 / token-fp abc123def456",
    );
    expect(channelEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("projects delivery failures without error prose or queued message text", () => {
    const event = channelEvent("channel.delivery.failed", {
      channelId: "channel_1234567890",
      deliveryId: "delivery_1234567890",
      runId: "run_1234567890",
      adapter: "github_webhook",
      status: "failed",
      error: "TOP_SECRET_DELIVERY_ERROR",
      message: "TOP_SECRET_QUEUED_MESSAGE",
      attempt: 1,
      maxAttempts: 3,
      retryBaseMs: 250,
      channelRevision: 2,
      bodySha256: "a".repeat(64),
      adapterCatalogSha256: "b".repeat(64),
    });

    expect(channelEventTraceSummary(event)).toBe(
      `channel / delivery.failed / channel 1234567890 / delivery 1234567890 / run 1234567890 / adapter github_webhook / status failed / max-attempts 3 / retry-base-ms 250 / attempt 1/3 / channel-revision 2 / body ${"a".repeat(12)} / adapter-catalog ${"b".repeat(12)}`,
    );
    expect(channelEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("projects delivery acceptance and retry metadata as hashes and counts", () => {
    const accepted = channelEvent("channel.delivery.accepted", {
      channelId: "channel_1234567890",
      deliveryId: "delivery_1234567890",
      adapter: "linear_webhook",
      channelRevision: 4,
      status: "accepted",
      idempotencyFingerprint: "idemp12345678",
      maxAttempts: 5,
      retryBaseMs: 500,
      bodySha256: "c".repeat(64),
      adapterCatalogSha256: "d".repeat(64),
      text: "TOP_SECRET_DELIVERY_TEXT",
    });
    const retry = channelEvent("channel.delivery.retry.requested", {
      channelId: "channel_1234567890",
      deliveryId: "delivery_1234567890",
      status: "retrying",
      attemptCount: 2,
      maxAttempts: 5,
      nextAttemptAt: "2026-07-28T12:05:00.000Z",
      source: "dead_letter_bulk",
      previewSha256: "e".repeat(64),
      reason: "TOP_SECRET_RETRY_REASON",
    });

    expect(channelEventTraceSummary(accepted)).toBe(
      `channel / delivery.accepted / channel 1234567890 / delivery 1234567890 / adapter linear_webhook / status accepted / max-attempts 5 / retry-base-ms 500 / channel-revision 4 / idempotency-fp idemp12345678 / body ${"c".repeat(12)} / adapter-catalog ${"d".repeat(12)}`,
    );
    expect(channelEventTraceSummary(retry)).toBe(
      `channel / delivery.retry.requested / channel 1234567890 / delivery 1234567890 / status retrying / source dead_letter_bulk / max-attempts 5 / attempt-count 2 / next-attempt 2026-07-28T12:05:00.000Z / preview ${"e".repeat(12)}`,
    );
    expect(channelEventTraceSummary(accepted)).not.toContain("TOP_SECRET");
    expect(channelEventTraceSummary(retry)).not.toContain("TOP_SECRET");
  });

  it("projects dead-letter receipts as counts and hashes", () => {
    const exported = channelEvent("channel.dead_letters.exported", {
      channelId: "channel_1234567890",
      schemaVersion: 1,
      deliveryCount: 3,
      contentSha256: "f".repeat(64),
      currentAdapterCatalogSha256: "1".repeat(64),
      qualifiedCount: 1,
      evidenceMissingCount: 1,
      adapterCatalogDriftCount: 1,
      summary: "TOP_SECRET_DEAD_LETTER_SUMMARY",
    });
    const applied = channelEvent("channel.dead_letters.retry_applied", {
      channelId: "channel_1234567890",
      retriedCount: 1,
      skippedCount: 0,
      applyResultSha256: "2".repeat(64),
      previewSha256: "3".repeat(64),
      artifactSha256: "4".repeat(64),
      previewCandidateSetSha256: "5".repeat(64),
      previewRetryableDeliveryIdsSha256: "6".repeat(64),
      previewBlockedDeliveryIdsSha256: "7".repeat(64),
      retriedDeliveryIdsSha256: "8".repeat(64),
      skippedDeliveryIdsSha256: "9".repeat(64),
      diagnostics: ["TOP_SECRET_RETRY_DIAGNOSTIC"],
    });

    expect(channelEventTraceSummary(exported)).toBe(
      `channel / dead_letters.exported / channel 1234567890 / schema 1 / deliveries 3 / qualified 1 / evidence-missing 1 / catalog-drift 1 / content ${"f".repeat(12)} / current-catalog ${"1".repeat(12)}`,
    );
    expect(channelEventTraceSummary(applied)).toBe(
      `channel / dead_letters.retry_applied / channel 1234567890 / retried 1 / skipped 0 / apply ${"2".repeat(12)} / preview ${"3".repeat(12)} / artifact ${"4".repeat(12)} / preview-candidates ${"5".repeat(12)} / preview-retryable ${"6".repeat(12)} / preview-blocked ${"7".repeat(12)} / retried ${"8".repeat(12)} / skipped ${"9".repeat(12)}`,
    );
    expect(channelEventTraceSummary(exported)).not.toContain("TOP_SECRET");
    expect(channelEventTraceSummary(applied)).not.toContain("TOP_SECRET");
  });

  it("fails closed for malformed and unknown channel receipts", () => {
    expect(channelEventTraceSummary(channelEvent("channel.created", []))).toBe(
      "channel receipt",
    );
    expect(
      channelEventTraceSummary(
        channelEvent("channel.future", {
          name: "TOP_SECRET_FUTURE_CHANNEL",
        }),
      ),
    ).toBe("channel");
  });
});

function channelEvent(type: string, payload: RunEvent["payload"]): RunEvent {
  return {
    id: `event_${type.replaceAll(".", "_")}`,
    threadId: "thread_channel",
    runId: "run_channel",
    seq: 45,
    type,
    category: "channel",
    visibility: "user",
    payload,
    createdAt: "2026-07-28T12:00:00.000Z",
  };
}
