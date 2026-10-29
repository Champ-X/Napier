import { generateKeyPairSync } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  NAPIER_API_VERSION,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription as RotationSubscription,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApproval as RotationApproval,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview as PolicyReview,
} from "@napier/contracts";
import {
  createReceiptTrustAnchor,
  createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline,
  signTrustedReceipt,
  validatePersistedReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription,
  type PersistedReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription as PersistedSubscription,
} from "@napier/runtime";
import { canonicalJson, sha256 } from "@napier/runtime/core";
import { LocalStore } from "@napier/runtime/store";

export interface RotationFixtureOptions {
  status?: "active" | "paused";
  due?: boolean;
  claim?: "live" | "expired";
  approval?: "pending" | "applied" | "failed";
  policyApproval?: "pending" | "applied" | "failed";
}

/** Authored persisted lifecycle state, not evidence of an accepted approval gate.
 * Every object is validated and the real SQLite snapshot is reopened normally. */
export async function seedRotationWorkspace(
  identity: { root: string; dataRoot: string },
  options: RotationFixtureOptions[] = [{}],
  historicalBaseline = false,
) {
  const storeOptions = { workspaceRoot: identity.root, dataRoot: identity.dataRoot };
  const store = new LocalStore(storeOptions);
  await store.initialize();
  const thread = await store.createThread({ title: "Rotation lifecycle", agentId: store.listAgents()[0]!.id });
  store.close();
  const now = new Date().toISOString();
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const past = new Date(Date.now() - 86_400_000).toISOString();
  const environment = { NAPIER_TEST_ROTATION_LIFECYCLE_KEY: generateKeyPairSync("ed25519").privateKey.export({ format: "pem", type: "pkcs8" }).toString() };
  const anchor = createReceiptTrustAnchor({ threadId: thread.id, label: "Lifecycle fixture signer", source: { type: "environment", variable: "NAPIER_TEST_ROTATION_LIFECYCLE_KEY" } }, environment);
  const approvalPolicy = { minimumDistinctSignerCount: 1 };
  const baselines: ReturnType<typeof createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline>[] = [];
  const subscriptions = options.map((option, index) => {
    const sourceUrl = `https://rotation.example.test/proposal-${index}.json`;
    const subscription: RotationSubscription = hashed({
      kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-rotation-proposal-subscription" as const,
      schemaVersion: 1 as const, apiVersion: NAPIER_API_VERSION,
      id: `trustpropsub_${index.toString(16).padStart(20, "0")}`,
      auditThreadId: thread.id, label: `Rotation fixture ${index}`,
      status: option.status ?? "paused", revision: 1,
      sourceUrlSha256: sha256(sourceUrl), sourceOriginSha256: sha256(new URL(sourceUrl).origin),
      refreshIntervalMs: 300_000, nextRefreshAt: option.due ? past : future,
      policy: {}, policySha256: sha256(canonicalJson({})),
      transparencyEntryCount: 0, transparencyHistory: [], createdAt: now, updatedAt: now,
    });
    const approval: RotationApproval = hashed({
      kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-rotation-proposal-subscription-approval" as const,
      schemaVersion: 1 as const, apiVersion: NAPIER_API_VERSION,
      approvedAt: now, approvedByThreadId: thread.id,
      subscriptionId: subscription.id, subscriptionRevision: subscription.revision,
      subscriptionSha256: subscription.contentSha256, sourceUrlSha256: subscription.sourceUrlSha256,
      sourceOriginSha256: subscription.sourceOriginSha256, policySha256: subscription.policySha256,
      discoverySha256: sha256("fixture discovery"), envelopeSha256: sha256("fixture proposal envelope"),
      proposalSha256: sha256("fixture proposal"), proposalReviewSha256: sha256("fixture proposal review"),
      approvalPreflightSha256: sha256("fixture preflight"), activationDecisionRecordId: "trustqad_fixture00000000",
      expectedCurrentSelectionSha256: "", proposalSignerKeyId: anchor.keyId, proposalSignedAt: now,
    });
    const approvalEnvelope = signTrustedReceipt(approval, anchor, environment);
    const review: PolicyReview = hashed({
      kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-rotation-proposal-subscription-approval-policy-review" as const,
      schemaVersion: 1 as const, apiVersion: NAPIER_API_VERSION, reviewedAt: now,
      status: "accepted" as const, diagnostics: [], subscriptionId: subscription.id,
      subscriptionRevision: subscription.revision, subscriptionSha256: subscription.contentSha256,
      sourceUrlSha256: subscription.sourceUrlSha256, sourceOriginSha256: subscription.sourceOriginSha256,
      subscriptionPolicySha256: subscription.policySha256,
      expectedSubscriptionRevision: subscription.revision, expectedSubscriptionSha256: subscription.contentSha256,
      approvalPolicy, approvalPolicySha256: sha256(canonicalJson(approvalPolicy)),
      approvalEnvelopeCount: 1, acceptedApprovalCount: 1, distinctSignerCount: 1, requiredSignerCount: 0,
      approvalEnvelopeSetSha256: sha256(canonicalJson([approvalEnvelope.contentSha256])),
      acceptedApprovalEnvelopeSetSha256: sha256(canonicalJson([approvalEnvelope.contentSha256])),
      signerSetSha256: sha256(canonicalJson([anchor.keyId])),
      approvalEnvelopeSha256s: [approvalEnvelope.contentSha256], acceptedApprovalEnvelopeSha256s: [approvalEnvelope.contentSha256],
      acceptedApprovalSignerKeyIds: [anchor.keyId], proposalSha256: approval.proposalSha256,
    });
    const baseline = createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline(
      thread.id, signTrustedReceipt(review, anchor, environment),
    );
    if (historicalBaseline || option.policyApproval) baselines.push(baseline);
    const persisted: PersistedSubscription = {
      ...subscription, sourceUrl,
      ...(option.claim ? {
        claim: { ownerId: "fixture-worker", acquiredAt: past, expiresAt: option.claim === "live" ? future : past },
        claimTokenSha256: sha256("fixture claim token"),
      } : {}),
      ...(option.approval ? { pendingApprovalApply: {
        status: option.approval, queuedAt: now, applyAfter: future,
        approvalEnvelope, approvalEnvelopeSha256: approvalEnvelope.contentSha256, approvalSha256: approval.contentSha256,
        ...(option.approval !== "pending" ? { settledAt: now, resultSha256: sha256("fixture settled approval") } : {}),
      } } : {}),
      ...(option.policyApproval ? { pendingApprovalPolicyApply: {
        status: option.policyApproval, queuedAt: now, applyAfter: future,
        approvalEnvelopes: [approvalEnvelope], approvalEnvelopeSha256s: [approvalEnvelope.contentSha256],
        approvalPolicy, approvalPolicySha256: review.approvalPolicySha256, approvalPolicyBaselineSha256: baseline.contentSha256,
        ...(option.policyApproval !== "pending" ? { settledAt: now, resultSha256: sha256("fixture settled policy") } : {}),
      } } : {}),
    };
    return validatePersistedReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(persisted);
  });
  const database = new DatabaseSync(path.join(identity.dataRoot, "ledger.sqlite"));
  try {
    const row = database.prepare("SELECT state_json FROM workspace_state WHERE singleton = 1").get() as { state_json: string };
    const state = JSON.parse(row.state_json) as Record<string, unknown>;
    state["receiptTrustAnchors"] = [anchor];
    state["receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions"] = subscriptions;
    state["receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselines"] = baselines;
    database.prepare("UPDATE workspace_state SET state_json = ? WHERE singleton = 1").run(JSON.stringify(state));
  } finally { database.close(); }
  const reopened = new LocalStore(storeOptions);
  try {
    await reopened.initialize();
    reopened.listReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions();
    reopened.listReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselines();
  } finally { reopened.close(); }
  return { thread, subscriptions, baselines, storeOptions };
}

function hashed<T extends object>(content: T): T & { contentSha256: string } {
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}
