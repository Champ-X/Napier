import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  receiptEventTraceSummary,
  receiptEventTraceView,
} from "../src/receipt-event-view";

describe("Receipt event trace view", () => {
  it("projects signed receipts without publisher or source prose", () => {
    const event = receiptEvent("receipt.signed", {
      receiptKind: "napier.receipt-trust-anchor-directory-metadata-receipt",
      receiptSha256: "a".repeat(64),
      receiptArtifactSha256: "b".repeat(64),
      statementSha256: "c".repeat(64),
      envelopeSha256: "d".repeat(64),
      keyId: "key_1234567890",
      publisher: "TOP_SECRET_RECEIPT_PUBLISHER",
      directorySha256: "e".repeat(64),
      anchorSetSha256: "f".repeat(64),
      sourceUrlSha256: "1".repeat(64),
      sourceOriginSha256: "2".repeat(64),
      summary: "TOP_SECRET_RECEIPT_SUMMARY",
    });

    expect(receiptEventTraceView(event)).toEqual({
      action: "receipt.signed",
      receiptKind: "napier.receipt-trust-anchor-directory-metadata-receipt",
      keyId: "key_1234567890",
      receiptSha256: "a".repeat(64),
      receiptArtifactSha256: "b".repeat(64),
      statementSha256: "c".repeat(64),
      envelopeSha256: "d".repeat(64),
      directorySha256: "e".repeat(64),
      anchorSetSha256: "f".repeat(64),
      sourceUrlSha256: "1".repeat(64),
      sourceOriginSha256: "2".repeat(64),
    });
    expect(receiptEventTraceSummary(event)).toBe(
      `receipt / signed / kind napier.receipt-trust-anchor-directory-metadata-receipt / key key_1234567890 / receipt ${"a".repeat(12)} / receipt-artifact ${"b".repeat(12)} / statement ${"c".repeat(12)} / envelope ${"d".repeat(12)} / directory ${"e".repeat(12)} / anchor-set ${"f".repeat(12)} / source-url ${"1".repeat(12)} / source-origin ${"2".repeat(12)}`,
    );
    expect(receiptEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("projects subscription and apply events as IDs, counts, and hashes", () => {
    const refreshed = receiptEvent(
      "receipt.trust_checkpoint_subscription.refreshed",
      {
        subscriptionId: "subscription_1234567890",
        subscriptionRevision: 4,
        subscriptionSha256: "3".repeat(64),
        sourceUrlSha256: "4".repeat(64),
        sourceOriginSha256: "5".repeat(64),
        policySha256: "6".repeat(64),
        refreshStatus: "accepted",
        refreshResultSha256: "7".repeat(64),
        transparencyEntryCount: 8,
        transparencyTailSha256: "8".repeat(64),
        activeEnvelopeSha256: "9".repeat(64),
        activeCheckpointSha256: "a".repeat(64),
        activeSelectionCount: 2,
        activeSelectionChainTailSha256: "b".repeat(64),
        error: "TOP_SECRET_REFRESH_ERROR",
      },
    );
    const applied = receiptEvent(
      "receipt.trust_rotation_proposal_approval_apply.applied",
      {
        subscriptionId: "subscription_1234567890",
        approvalEnvelopeSha256: "c".repeat(64),
        approvalSha256: "d".repeat(64),
        proposalSha256: "e".repeat(64),
        preflightSha256: "f".repeat(64),
        resultSha256: "1".repeat(64),
        applied: true,
        selectionSha256: "2".repeat(64),
        selectionStateSha256: "3".repeat(64),
        activationDecisionRecordId: "decision_1234567890",
        reason: "TOP_SECRET_APPLY_REASON",
      },
    );

    expect(receiptEventTraceSummary(refreshed)).toBe(
      `receipt / trust_checkpoint_subscription.refreshed / subscription 1234567890 / refresh accepted / subscription-revision 4 / transparency-entries 8 / active-selections 2 / source-url ${"4".repeat(12)} / source-origin ${"5".repeat(12)} / subscription ${"3".repeat(12)} / policy ${"6".repeat(12)} / refresh-result ${"7".repeat(12)} / transparency-tail ${"8".repeat(12)} / active-envelope ${"9".repeat(12)} / active-checkpoint ${"a".repeat(12)} / active-selection-chain ${"b".repeat(12)}`,
    );
    expect(receiptEventTraceSummary(applied)).toBe(
      `receipt / trust_rotation_proposal_approval_apply.applied / subscription 1234567890 / decision 1234567890 / applied true / approval-envelope ${"c".repeat(12)} / approval ${"d".repeat(12)} / proposal ${"e".repeat(12)} / preflight ${"f".repeat(12)} / result ${"1".repeat(12)} / selection ${"2".repeat(12)} / selection-state ${"3".repeat(12)}`,
    );
    expect(receiptEventTraceSummary(refreshed)).not.toContain("TOP_SECRET");
    expect(receiptEventTraceSummary(applied)).not.toContain("TOP_SECRET");
  });

  it("projects legacy receipt_trust events through the same bounded view", () => {
    const event = receiptEvent(
      "receipt_trust.directory_quorum_promotion_baseline.imported",
      {
        status: "accepted",
        receiptSha256: "4".repeat(64),
        anchorCount: 5,
        trustedCount: 4,
        revokedCount: 1,
        message: "TOP_SECRET_LEGACY_MESSAGE",
      },
    );

    expect(receiptEventTraceSummary(event)).toBe(
      `receipt / trust.directory_quorum_promotion_baseline.imported / status accepted / anchors 5 / trusted 4 / revoked 1 / receipt ${"4".repeat(12)}`,
    );
    expect(receiptEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("fails closed for malformed receipt payloads and future prose fields", () => {
    expect(receiptEventTraceSummary(receiptEvent("receipt.signed", []))).toBe(
      "receipt trust receipt",
    );
    expect(
      receiptEventTraceSummary(
        receiptEvent("receipt.future", {
          summary: "TOP_SECRET_FUTURE_RECEIPT",
        }),
      ),
    ).toBe("receipt / future");
  });
});

function receiptEvent(type: string, payload: RunEvent["payload"]): RunEvent {
  return {
    id: `event_${type.replaceAll(".", "_")}`,
    threadId: "thread_receipt",
    runId: "run_receipt",
    seq: 49,
    type,
    category: "evaluation",
    visibility: "user",
    payload,
    createdAt: "2026-07-28T12:00:00.000Z",
  };
}
