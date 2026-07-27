import { createHash } from "node:crypto";

import type {
  ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionResult,
  ImportReceiptTrustAnchorDirectoryQuorumPromotionBaselineResult,
  ReceiptTrustAnchorDirectory,
  ReceiptTrustAnchorDirectoryDiscovery,
  ReceiptTrustAnchorDirectoryMetadataVerification,
  ReceiptTrustAnchorDirectoryQuorum,
  ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory,
  ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistoryVerification,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationReview,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionState,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointVerification,
  ReceiptTrustAnchorDirectoryQuorumPromotionBaseline,
  ReceiptTrustAnchorDirectoryQuorumPromotionBaselineVerification,
  ReceiptTrustAnchorDirectoryQuorumPromotionReceipt,
  ReceiptTrustAnchorDirectorySubscription,
  ReceiptTrustAnchorDirectorySubscriptionRefreshResult,
  PromoteReceiptTrustAnchorDirectoryQuorumBaselineResult,
  ReceiptTrustAnchorDirectoryVerification,
  SignReceiptTrustAnchorDirectoryQuorumActivationDecisionResult,
  TrustedReceiptEnvelope,
  TrustedReceiptVerification,
} from "@napier/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyReceiptTrustAnchorDirectoryQuorumActivationSelection,
  createReceiptTrustAnchorDirectorySubscription,
  discoverReceiptTrustAnchorDirectory,
  evaluateReceiptTrustAnchorDirectoryQuorum,
  getSignedReceiptTrustAnchorDirectoryMetadata,
  getReceiptTrustAnchorDirectory,
  getReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory,
  getReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit,
  getReceiptTrustAnchorDirectoryQuorumActivationSelectionState,
  getReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint,
  importReceiptTrustAnchorDirectoryQuorumPromotionBaseline,
  listReceiptTrustAnchorDirectorySubscriptions,
  listReceiptTrustAnchorDirectoryQuorumPromotionBaselines,
  promoteReceiptTrustAnchorDirectoryQuorumBaseline,
  promoteReceiptTrustAnchorDirectoryQuorum,
  refreshReceiptTrustAnchorDirectorySubscription,
  reviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotation,
  signReceiptTrustAnchorDirectoryQuorumActivationDecision,
  updateReceiptTrustAnchorDirectorySubscription,
  verifyReceiptTrustAnchorDirectory,
  verifyReceiptTrustAnchorDirectoryMetadata,
  verifyReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory,
  verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint,
  verifyReceiptTrustAnchorDirectoryQuorumPromotionBaseline,
  verifyTrustedReceipt,
} from "../src/receipt-trust-api";

describe("receipt trust Web API wrappers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exports and verifies public anchor directories", async () => {
    const directory: ReceiptTrustAnchorDirectory = {
      kind: "napier.receipt-trust-anchor-directory",
      schemaVersion: 1,
      apiVersion: "0.1.0",
      generatedAt: "2026-07-27T00:00:00.000Z",
      receiptKinds: [
        "evaluation_gate",
        "casebook_qualification",
        "policy_retirement_proof_bundle",
        "receipt_trust_anchor_directory_metadata",
      ],
      anchorCount: 1,
      trustedCount: 1,
      revokedCount: 0,
      anchorSetSha256: "a".repeat(64),
      anchors: [
        {
          id: "trustkey_12345678",
          label: "Release signer",
          algorithm: "Ed25519",
          keyId: "b".repeat(64),
          publicKeySpki:
            "MCowBQYDK2VwAyEA000000000000000000000000000000000000000=",
          status: "trusted",
          createdAt: "2026-07-27T00:00:00.000Z",
          updatedAt: "2026-07-27T00:00:00.000Z",
          anchorSha256: "c".repeat(64),
        },
      ],
      contentSha256: "d".repeat(64),
    };
    const directoryPolicy = {
      maxAgeMs: 60_000,
      expectedAnchorSetSha256: directory.anchorSetSha256,
      minimumTrustedCount: 1,
      requiredTrustedKeyIds: [directory.anchors[0]!.keyId],
    };
    const verification: ReceiptTrustAnchorDirectoryVerification = {
      kind: "napier.receipt-trust-anchor-directory-verification",
      schemaVersion: 1,
      apiVersion: "0.1.0",
      generatedAt: "2026-07-27T00:00:01.000Z",
      status: "valid",
      diagnostics: [],
      policy: directoryPolicy,
      policySha256: "f".repeat(64),
      directoryGeneratedAt: directory.generatedAt,
      directoryAgeMs: 1_000,
      declaredContentSha256: directory.contentSha256,
      recomputedContentSha256: directory.contentSha256,
      declaredAnchorSetSha256: directory.anchorSetSha256,
      recomputedAnchorSetSha256: directory.anchorSetSha256,
      anchorCount: 1,
      trustedCount: 1,
      revokedCount: 0,
      contentSha256: "e".repeat(64),
    };
    const discovery: ReceiptTrustAnchorDirectoryDiscovery = {
      kind: "napier.receipt-trust-anchor-directory-discovery",
      schemaVersion: 1,
      apiVersion: "0.1.0",
      generatedAt: "2026-07-27T00:00:02.000Z",
      status: "valid",
      sourceUrlSha256: "0".repeat(64),
      sourceOriginSha256: "1".repeat(64),
      httpStatus: 200,
      responseMediaType: "application/json",
      responseBytes: 1_024,
      responseBodySha256: "2".repeat(64),
      verification,
      directory,
      contentSha256: "3".repeat(64),
    };
    const metadataEnvelope = {
      kind: "napier.trusted-receipt-envelope",
      receiptKind: "receipt_trust_anchor_directory_metadata",
      receipt: {
        kind: "napier.receipt-trust-anchor-directory-metadata-receipt",
        contentSha256: "4".repeat(64),
      },
      signature: { keyId: directory.anchors[0]!.keyId },
      contentSha256: "5".repeat(64),
    } as TrustedReceiptEnvelope;
    const metadataVerification: ReceiptTrustAnchorDirectoryMetadataVerification =
      {
        kind: "napier.receipt-trust-anchor-directory-metadata-verification",
        schemaVersion: 1,
        apiVersion: "0.1.0",
        generatedAt: "2026-07-27T00:00:03.000Z",
        status: "trusted",
        diagnostics: [],
        trustedReceiptVerification: {
          status: "trusted",
          verifiedAt: "2026-07-27T00:00:03.000Z",
          receiptKind: "receipt_trust_anchor_directory_metadata",
          keyId: directory.anchors[0]!.keyId,
          envelopeSha256: metadataEnvelope.contentSha256,
          signatureValid: true,
          integrityValid: true,
          reason: "Receipt signature and evidence are trusted",
        },
        directoryVerification: verification,
        publisher: "Napier Trust Registry",
        directorySha256: directory.contentSha256,
        anchorSetSha256: directory.anchorSetSha256,
        signerKeyId: directory.anchors[0]!.keyId,
        envelopeSha256: metadataEnvelope.contentSha256,
        signatureValid: true,
        integrityValid: true,
        directoryBindingValid: true,
        contentSha256: "6".repeat(64),
      };
    const sourceUrl = "https://trust.example.test/anchors.json";
    const signMetadataRequest = {
      threadId: "thread_12345678",
      trustAnchorId: directory.anchors[0]!.id,
      publisher: "Napier Trust Registry",
    };
    const calls = [
      {
        path: "/api/receipt-trust/anchors/directory",
        response: directory,
      },
      {
        path: "/api/receipt-trust/anchors/directory/verify",
        method: "POST",
        body: { directory, policy: directoryPolicy },
        response: verification,
      },
      {
        path: "/api/receipt-trust/anchors/directory/discover",
        method: "POST",
        body: { sourceUrl, policy: directoryPolicy },
        response: discovery,
      },
      {
        path: "/api/receipt-trust/anchors/directory/signed-metadata",
        method: "POST",
        body: signMetadataRequest,
        response: metadataEnvelope,
      },
      {
        path: "/api/receipt-trust/anchors/directory/metadata/verify",
        method: "POST",
        body: {
          envelope: metadataEnvelope,
          directory,
          directoryPolicy,
          trustDirectory: directory,
          trustDirectoryPolicy: directoryPolicy,
        },
        response: metadataVerification,
      },
    ];
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      const call = calls[fetchMock.mock.calls.length - 1]!;
      expect(path).toBe(call.path);
      expect(init?.method).toBe(call.method);
      expect(init?.headers).toEqual({ "Content-Type": "application/json" });
      if (call.body) expect(init?.body).toBe(JSON.stringify(call.body));
      return jsonResponse(call.response);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getReceiptTrustAnchorDirectory()).resolves.toEqual(directory);
    await expect(
      verifyReceiptTrustAnchorDirectory({
        directory,
        policy: directoryPolicy,
      }),
    ).resolves.toEqual(verification);
    await expect(
      discoverReceiptTrustAnchorDirectory({
        sourceUrl,
        policy: directoryPolicy,
      }),
    ).resolves.toEqual(discovery);
    await expect(
      getSignedReceiptTrustAnchorDirectoryMetadata(signMetadataRequest),
    ).resolves.toEqual(metadataEnvelope);
    await expect(
      verifyReceiptTrustAnchorDirectoryMetadata({
        envelope: metadataEnvelope,
        directory,
        directoryPolicy,
        trustDirectory: directory,
        trustDirectoryPolicy: directoryPolicy,
      }),
    ).resolves.toEqual(metadataVerification);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("creates, refreshes, and pauses durable directory subscriptions", async () => {
    const subscription = {
      kind: "napier.receipt-trust-anchor-directory-subscription",
      schemaVersion: 1,
      apiVersion: "0.1.0",
      id: "trustdir_1234567890abcdef1234",
      auditThreadId: "thread_12345678",
      label: "Release trust feed",
      status: "active",
      revision: 1,
      sourceUrlSha256: "a".repeat(64),
      sourceOriginSha256: "b".repeat(64),
      refreshIntervalMs: 86_400_000,
      nextRefreshAt: "2026-07-28T00:00:00.000Z",
      policy: { maxAgeMs: 86_400_000, minimumTrustedCount: 1 },
      policySha256: "c".repeat(64),
      transparencyEntryCount: 1,
      transparencyTailSha256: "0".repeat(64),
      transparencyHistory: [
        {
          kind: "napier.receipt-trust-anchor-directory-subscription-transparency-entry",
          schemaVersion: 1,
          apiVersion: "0.1.0",
          sequence: 1,
          status: "promoted",
          observedAt: "2026-07-27T00:00:00.000Z",
          discoverySha256: "1".repeat(64),
          directorySha256: "2".repeat(64),
          anchorSetSha256: "3".repeat(64),
          trustedCount: 1,
          contentSha256: "0".repeat(64),
        },
      ],
      createdAt: "2026-07-27T00:00:00.000Z",
      updatedAt: "2026-07-27T00:00:00.000Z",
      contentSha256: "d".repeat(64),
    } satisfies ReceiptTrustAnchorDirectorySubscription;
    const createRequest = {
      threadId: subscription.auditThreadId,
      label: subscription.label,
      sourceUrl: "https://trust.example.test/anchors.json",
      refreshIntervalMs: subscription.refreshIntervalMs,
      policy: subscription.policy,
    };
    const refreshResult = {
      kind: "napier.receipt-trust-anchor-directory-subscription-refresh",
      schemaVersion: 1,
      apiVersion: "0.1.0",
      status: "unchanged",
      subscription: { ...subscription, revision: 2 },
      contentSha256: "e".repeat(64),
    } satisfies ReceiptTrustAnchorDirectorySubscriptionRefreshResult;
    const paused = {
      ...refreshResult.subscription,
      status: "paused",
      revision: 3,
    } satisfies ReceiptTrustAnchorDirectorySubscription;
    const selectedAnchorSetSha256 = "5".repeat(64);
    const selectedDirectorySha256 = "6".repeat(64);
    const selectedDirectory = {
      kind: "napier.receipt-trust-anchor-directory",
      schemaVersion: 1,
      apiVersion: "0.1.0",
      generatedAt: "2026-07-27T00:00:00.000Z",
      receiptKinds: [
        "evaluation_gate",
        "casebook_qualification",
        "policy_retirement_proof_bundle",
        "receipt_trust_anchor_directory_metadata",
        "receipt_trust_anchor_directory_quorum_promotion",
        "receipt_trust_anchor_directory_quorum_activation_decision",
      ],
      anchorCount: 0,
      trustedCount: 0,
      revokedCount: 0,
      anchorSetSha256: selectedAnchorSetSha256,
      anchors: [],
      contentSha256: selectedDirectorySha256,
    } satisfies ReceiptTrustAnchorDirectory;
    const quorum = {
      kind: "napier.receipt-trust-anchor-directory-quorum",
      schemaVersion: 1,
      apiVersion: "0.1.0",
      generatedAt: "2026-07-27T00:00:00.000Z",
      status: "agreed",
      diagnostics: [],
      policy: {
        minimumSources: 2,
        minimumAgreementCount: 2,
        minimumDistinctSourceOrigins: 2,
        minimumAgreementWeight: 2,
        minimumMetadataPublisherCount: 0,
        expectedAnchorSetSha256: "",
        requiredSourceOriginSha256s: [],
        requiredMetadataPublisherSha256s: [],
        sourceWeights: [],
      },
      policySha256: "4".repeat(64),
      sourceCount: 2,
      candidateCount: 1,
      agreementCount: 2,
      agreementWeight: 2,
      agreementDistinctSourceOriginCount: 2,
      agreementMetadataPublisherCount: 0,
      agreementMetadataPublisherSetSha256: "8".repeat(64),
      selectedAnchorSetSha256,
      selectedDirectorySha256,
      selectedDirectory,
      sources: [],
      candidates: [],
      contentSha256: "7".repeat(64),
    } satisfies ReceiptTrustAnchorDirectoryQuorum;
    const promotion = {
      kind: "napier.receipt-trust-anchor-directory-quorum-promotion",
      schemaVersion: 1,
      apiVersion: "0.1.0",
      generatedAt: "2026-07-27T00:00:00.000Z",
      quorum,
      selectedAnchorSetSha256: quorum.selectedAnchorSetSha256,
      selectedDirectorySha256: quorum.selectedDirectorySha256,
      selectedSubscriptionCount: 2,
      selectedSubscriptionSetSha256: "9".repeat(64),
      selectedMetadataCount: 0,
      selectedMetadataEnvelopeSetSha256: "a".repeat(64),
      selectedMetadata: [],
      contentSha256: "b".repeat(64),
    } satisfies ReceiptTrustAnchorDirectoryQuorumPromotionReceipt;
    const promotionEnvelope = {
      kind: "napier.trusted-receipt-envelope",
      schemaVersion: 1,
      apiVersion: "0.1.0",
      receiptKind: "receipt_trust_anchor_directory_quorum_promotion",
      receipt: promotion,
      signature: {
        algorithm: "Ed25519",
        keyId: "c".repeat(64),
        signedAt: "2026-07-27T00:00:00.000Z",
        receiptArtifactSha256: "d".repeat(64),
        statementSha256: "e".repeat(64),
        value: "signature",
      },
      contentSha256: "f".repeat(64),
    } satisfies TrustedReceiptEnvelope;
    const promotionBaseline = {
      id: "trustqpb_1234567890abcdef1234",
      envelope: promotionEnvelope,
      promotedByThreadId: "thread_1234567890abcdef1234",
      selectedAnchorSetSha256: promotion.selectedAnchorSetSha256,
      selectedDirectorySha256: promotion.selectedDirectorySha256,
      selectedSubscriptionSetSha256: promotion.selectedSubscriptionSetSha256,
      selectedMetadataEnvelopeSetSha256:
        promotion.selectedMetadataEnvelopeSetSha256,
      createdAt: "2026-07-27T00:00:00.000Z",
      contentSha256: "1".repeat(64),
    } satisfies ReceiptTrustAnchorDirectoryQuorumPromotionBaseline;
    const promotionBaselineRequest = {
      threadId: promotionBaseline.promotedByThreadId,
      trustAnchorId: "trustkey_1234567890abcdef1234",
      policy: { minimumSources: 2, minimumAgreementCount: 2 },
    };
    const promotionBaselineResult = {
      baseline: promotionBaseline,
      created: true,
    } satisfies PromoteReceiptTrustAnchorDirectoryQuorumBaselineResult;
    const promotionBaselineVerification = {
      kind: "napier.receipt-trust-anchor-directory-quorum-promotion-baseline-verification",
      schemaVersion: 1,
      apiVersion: "0.1.0",
      verifiedAt: "2026-07-27T00:00:00.000Z",
      status: "trusted",
      diagnostics: [],
      baselineValid: true,
      signatureValid: true,
      integrityValid: true,
      baselineSha256: promotionBaseline.contentSha256,
      envelopeSha256: promotionBaseline.envelope.contentSha256,
      receiptSha256: promotionBaseline.envelope.receipt.contentSha256,
      receiptArtifactSha256:
        promotionBaseline.envelope.signature.receiptArtifactSha256,
      keyId: promotionBaseline.envelope.signature.keyId,
      selectedAnchorSetSha256: promotionBaseline.selectedAnchorSetSha256,
      selectedDirectorySha256: promotionBaseline.selectedDirectorySha256,
      selectedSubscriptionSetSha256:
        promotionBaseline.selectedSubscriptionSetSha256,
      selectedMetadataEnvelopeSetSha256:
        promotionBaseline.selectedMetadataEnvelopeSetSha256,
      contentSha256: "2".repeat(64),
    } satisfies ReceiptTrustAnchorDirectoryQuorumPromotionBaselineVerification;
    const promotionBaselineImportRequest = {
      baseline: promotionBaseline,
      threadId: promotionBaseline.promotedByThreadId,
      expectedCurrentBaselineSha256: "",
      importPolicy: {
        minimumAgreementCount: 2,
        expectedAnchorSetSha256: promotionBaseline.selectedAnchorSetSha256,
        requiredMetadataSignerKeyIds: ["c".repeat(64)],
      },
    };
    const promotionBaselineImportPolicyReview = {
      kind: "napier.receipt-trust-anchor-directory-quorum-promotion-baseline-import-policy-review",
      schemaVersion: 1,
      apiVersion: "0.1.0",
      reviewedAt: "2026-07-27T00:00:00.000Z",
      status: "accepted",
      diagnostics: [],
      policy: {
        maxBaselineAgeMs: 0,
        maxReceiptAgeMs: 0,
        maxSourceObservedAgeMs: 0,
        minimumAgreementCount: 2,
        minimumAgreementWeight: 0,
        minimumDistinctSourceOrigins: 0,
        minimumMetadataPublisherCount: 0,
        minimumSelectedMetadataCount: 0,
        expectedAnchorSetSha256: promotionBaseline.selectedAnchorSetSha256,
        expectedDirectorySha256: "",
        requiredSourceOriginSha256s: [],
        requiredMetadataPublisherSha256s: [],
        requiredMetadataSignerKeyIds: ["c".repeat(64)],
      },
      policySha256: "3".repeat(64),
      baselineSha256: promotionBaseline.contentSha256,
      envelopeSha256: promotionBaseline.envelope.contentSha256,
      receiptSha256: promotionBaseline.envelope.receipt.contentSha256,
      keyId: promotionBaseline.envelope.signature.keyId,
      selectedAnchorSetSha256: promotionBaseline.selectedAnchorSetSha256,
      selectedDirectorySha256: promotionBaseline.selectedDirectorySha256,
      selectedSourceOriginCount: 2,
      selectedSourceOriginSetSha256: "4".repeat(64),
      selectedMetadataPublisherCount: 1,
      selectedMetadataPublisherSetSha256: "5".repeat(64),
      selectedMetadataSignerCount: 1,
      selectedMetadataSignerSetSha256: "6".repeat(64),
      contentSha256: "7".repeat(64),
    } satisfies ImportReceiptTrustAnchorDirectoryQuorumPromotionBaselineResult["policyReview"];
    const promotionBaselineImportResult = {
      baseline: promotionBaseline,
      imported: true,
      verification: promotionBaselineVerification,
      policyReview: promotionBaselineImportPolicyReview,
      expectedCurrentBaselineSha256: "",
    } satisfies ImportReceiptTrustAnchorDirectoryQuorumPromotionBaselineResult;
    const activationDecisionRequest = {
      threadId: promotionBaseline.promotedByThreadId,
      trustAnchorId: "trustkey_1234567890abcdef1234",
      baselineId: promotionBaseline.id,
      importPolicy: promotionBaselineImportRequest.importPolicy,
    };
    const activationSourceAlignment = {
      kind: "napier.receipt-trust-anchor-directory-quorum-activation-source-alignment",
      schemaVersion: 1,
      apiVersion: "0.1.0",
      generatedAt: "2026-07-27T00:00:00.000Z",
      baselineSha256: promotionBaseline.contentSha256,
      selectedAnchorSetSha256: promotionBaseline.selectedAnchorSetSha256,
      selectedDirectorySha256: promotionBaseline.selectedDirectorySha256,
      selectedSourceOriginCount: 2,
      selectedSourceOriginSetSha256: "8".repeat(64),
      alignedSourceCount: 2,
      driftedSourceCount: 0,
      missingSourceCount: 0,
      sources: [],
      contentSha256: "9".repeat(64),
    } satisfies SignReceiptTrustAnchorDirectoryQuorumActivationDecisionResult["sourceAlignment"];
    const activationEnvelope = {
      kind: "napier.trusted-receipt-envelope",
      schemaVersion: 1,
      apiVersion: "0.1.0",
      receiptKind: "receipt_trust_anchor_directory_quorum_activation_decision",
      receipt: {
        kind: "napier.receipt-trust-anchor-directory-quorum-activation-decision",
        schemaVersion: 1,
        apiVersion: "0.1.0",
        generatedAt: "2026-07-27T00:00:00.000Z",
        decision: "approved",
        diagnostics: [],
        baselineId: promotionBaseline.id,
        baselineSha256: promotionBaseline.contentSha256,
        envelopeSha256: promotionBaseline.envelope.contentSha256,
        receiptSha256: promotionBaseline.envelope.receipt.contentSha256,
        receiptArtifactSha256:
          promotionBaseline.envelope.signature.receiptArtifactSha256,
        selectedAnchorSetSha256: promotionBaseline.selectedAnchorSetSha256,
        selectedDirectorySha256: promotionBaseline.selectedDirectorySha256,
        verificationStatus: "trusted",
        verificationSha256: promotionBaselineVerification.contentSha256,
        signatureValid: true,
        integrityValid: true,
        policyReviewStatus: "accepted",
        policySha256: promotionBaselineImportPolicyReview.policySha256,
        policyReviewSha256: promotionBaselineImportPolicyReview.contentSha256,
        sourceAlignmentSha256: activationSourceAlignment.contentSha256,
        alignedSourceCount: 2,
        driftedSourceCount: 0,
        missingSourceCount: 0,
        selectedSourceOriginSetSha256:
          activationSourceAlignment.selectedSourceOriginSetSha256,
        metadataPublisherSetSha256: "a".repeat(64),
        metadataSignerSetSha256: "b".repeat(64),
        contentSha256: "c".repeat(64),
      },
      signature: {
        algorithm: "Ed25519",
        keyId: "c".repeat(64),
        signedAt: "2026-07-27T00:00:00.000Z",
        receiptArtifactSha256: "d".repeat(64),
        statementSha256: "e".repeat(64),
        value: "signature",
      },
      contentSha256: "f".repeat(64),
    } satisfies TrustedReceiptEnvelope;
    const activationDecisionResult = {
      baseline: promotionBaseline,
      verification: promotionBaselineVerification,
      policyReview: promotionBaselineImportPolicyReview,
      sourceAlignment: activationSourceAlignment,
      envelope: activationEnvelope,
    } satisfies SignReceiptTrustAnchorDirectoryQuorumActivationDecisionResult;
    const activationDecisionHistory = {
      kind: "napier.receipt-trust-anchor-directory-quorum-activation-decision-history",
      schemaVersion: 1,
      apiVersion: "0.1.0",
      generatedAt: "2026-07-27T00:00:00.000Z",
      decisionCount: 1,
      approvedCount: 1,
      rejectedCount: 0,
      distinctBaselineCount: 1,
      decisionSetSha256: "1".repeat(64),
      baselineSetSha256: "2".repeat(64),
      policyReviewSetSha256: "3".repeat(64),
      sourceAlignmentSetSha256: "4".repeat(64),
      latestDecisionAt: "2026-07-27T00:00:00.000Z",
      records: [
        {
          id: "trustqad_1234567890abcdef1234",
          signedByThreadId: promotionBaseline.promotedByThreadId,
          createdAt: "2026-07-27T00:00:00.000Z",
          ...activationDecisionResult,
          contentSha256: "5".repeat(64),
        },
      ],
      contentSha256: "6".repeat(64),
    } satisfies ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory;
    const activationDecisionHistoryVerification = {
      kind: "napier.receipt-trust-anchor-directory-quorum-activation-decision-history-verification",
      schemaVersion: 1,
      apiVersion: "0.1.0",
      verifiedAt: "2026-07-27T00:00:01.000Z",
      status: "valid",
      diagnostics: [],
      declaredContentSha256: activationDecisionHistory.contentSha256,
      recomputedContentSha256: activationDecisionHistory.contentSha256,
      currentContentSha256: activationDecisionHistory.contentSha256,
      declaredDecisionSetSha256: activationDecisionHistory.decisionSetSha256,
      currentDecisionSetSha256: activationDecisionHistory.decisionSetSha256,
      declaredDecisionCount: activationDecisionHistory.decisionCount,
      currentDecisionCount: activationDecisionHistory.decisionCount,
      contentSha256: "7".repeat(64),
    } satisfies ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistoryVerification;
    const activationSelection = {
      kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection",
      schemaVersion: 1,
      apiVersion: "0.1.0",
      id: "trustqas_1234567890abcdef1234",
      activatedAt: "2026-07-27T00:00:02.000Z",
      activatedByThreadId: promotionBaseline.promotedByThreadId,
      activationDecisionRecordId: activationDecisionHistory.records[0]!.id,
      activationDecisionRecordSha256:
        activationDecisionHistory.records[0]!.contentSha256,
      activationDecisionReceiptSha256: activationEnvelope.receipt.contentSha256,
      activationDecisionEnvelopeSha256: activationEnvelope.contentSha256,
      baselineId: promotionBaseline.id,
      baselineSha256: promotionBaseline.contentSha256,
      selectedAnchorSetSha256: promotionBaseline.selectedAnchorSetSha256,
      selectedDirectorySha256: promotionBaseline.selectedDirectorySha256,
      selectedDirectory,
      policyReviewSha256: promotionBaselineImportPolicyReview.contentSha256,
      sourceAlignmentSha256: activationSourceAlignment.contentSha256,
      contentSha256: "8".repeat(64),
    } satisfies ReceiptTrustAnchorDirectoryQuorumActivationSelectionState["selection"];
    const activationSelectionState = {
      kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-state",
      schemaVersion: 1,
      apiVersion: "0.1.0",
      generatedAt: "2026-07-27T00:00:02.000Z",
      hasSelection: true,
      currentSelectionSha256: activationSelection.contentSha256,
      selection: activationSelection,
      contentSha256: "9".repeat(64),
    } satisfies ReceiptTrustAnchorDirectoryQuorumActivationSelectionState;
    const activationSelectionRequest = {
      threadId: promotionBaseline.promotedByThreadId,
      activationDecisionRecordId: activationDecisionHistory.records[0]!.id,
      expectedCurrentSelectionSha256: "",
    };
    const activationSelectionResult = {
      applied: true,
      expectedCurrentSelectionSha256: "",
      selection: activationSelection,
      selectionState: activationSelectionState,
      contentSha256: "a".repeat(64),
    } satisfies ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionResult;
    const activationSelectionDriftAudit = {
      kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-drift-audit",
      schemaVersion: 1,
      apiVersion: "0.1.0",
      auditedAt: "2026-07-27T00:00:03.000Z",
      status: "aligned",
      diagnostics: [],
      hasSelection: true,
      selectionStateSha256: activationSelectionState.contentSha256,
      selectionId: activationSelection.id,
      selectionSha256: activationSelection.contentSha256,
      selectedAnchorSetSha256: activationSelection.selectedAnchorSetSha256,
      selectedDirectorySha256: activationSelection.selectedDirectorySha256,
      currentQuorumStatus: quorum.status,
      currentQuorumSha256: quorum.contentSha256,
      currentSourceCount: quorum.sourceCount,
      currentAgreementCount: quorum.agreementCount,
      currentAgreementWeight: quorum.agreementWeight,
      currentAnchorSetSha256: quorum.selectedAnchorSetSha256,
      currentDirectorySha256: quorum.selectedDirectorySha256,
      contentSha256: "b".repeat(64),
    } satisfies ReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit;
    const activationSelectionRotationReviewRequest = {
      activationDecisionRecordId: activationDecisionHistory.records[0]!.id,
      expectedCurrentSelectionSha256: activationSelection.contentSha256,
    };
    const activationSelectionRotationReview = {
      kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-rotation-review",
      schemaVersion: 1,
      apiVersion: "0.1.0",
      reviewedAt: "2026-07-27T00:00:04.000Z",
      status: "already_active",
      diagnostics: ["selection_already_active"],
      expectedCurrentSelectionSha256: activationSelection.contentSha256,
      currentSelectionSha256: activationSelection.contentSha256,
      activationDecisionRecordId: activationDecisionHistory.records[0]!.id,
      activationDecisionRecordSha256:
        activationDecisionHistory.records[0]!.contentSha256,
      baselineSha256: promotionBaseline.contentSha256,
      sourceAlignmentSha256: activationSourceAlignment.contentSha256,
      currentSourceAlignmentSha256: activationSourceAlignment.contentSha256,
      driftAudit: activationSelectionDriftAudit,
      contentSha256: "c".repeat(64),
    } satisfies ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationReview;
    const activationSelectionCheckpoint = {
      kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-transparency-checkpoint",
      schemaVersion: 1,
      apiVersion: "0.1.0",
      generatedAt: "2026-07-27T00:00:05.000Z",
      hasSelection: true,
      selectionCount: 1,
      currentSelectionSha256: activationSelection.contentSha256,
      currentSelectionId: activationSelection.id,
      currentSelectionEntrySha256: "d".repeat(64),
      selectionSetSha256: "e".repeat(64),
      selectionChainTailSha256: "d".repeat(64),
      activationDecisionCount: 1,
      activationDecisionSetSha256: "f".repeat(64),
      baselineSetSha256: "1".repeat(64),
      policyReviewSetSha256: "2".repeat(64),
      sourceAlignmentSetSha256: "3".repeat(64),
      driftAuditSha256: activationSelectionDriftAudit.contentSha256,
      driftStatus: activationSelectionDriftAudit.status,
      entries: [
        {
          kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-transparency-entry",
          schemaVersion: 1,
          apiVersion: "0.1.0",
          sequence: 1,
          activatedAt: activationSelection.activatedAt,
          activatedByThreadId: activationSelection.activatedByThreadId,
          selectionId: activationSelection.id,
          selectionSha256: activationSelection.contentSha256,
          activationDecisionRecordId:
            activationSelection.activationDecisionRecordId,
          activationDecisionRecordSha256:
            activationSelection.activationDecisionRecordSha256,
          activationDecisionReceiptSha256:
            activationSelection.activationDecisionReceiptSha256,
          activationDecisionEnvelopeSha256:
            activationSelection.activationDecisionEnvelopeSha256,
          baselineId: activationSelection.baselineId,
          baselineSha256: activationSelection.baselineSha256,
          selectedAnchorSetSha256: activationSelection.selectedAnchorSetSha256,
          selectedDirectorySha256: activationSelection.selectedDirectorySha256,
          policyReviewSha256: activationSelection.policyReviewSha256,
          sourceAlignmentSha256: activationSelection.sourceAlignmentSha256,
          contentSha256: "d".repeat(64),
        },
      ],
      contentSha256: "4".repeat(64),
    } satisfies ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint;
    const activationSelectionCheckpointVerification = {
      kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-transparency-checkpoint-verification",
      schemaVersion: 1,
      apiVersion: "0.1.0",
      verifiedAt: "2026-07-27T00:00:06.000Z",
      status: "valid",
      diagnostics: [],
      declaredContentSha256: activationSelectionCheckpoint.contentSha256,
      recomputedContentSha256: activationSelectionCheckpoint.contentSha256,
      currentContentSha256: activationSelectionCheckpoint.contentSha256,
      declaredSelectionSetSha256:
        activationSelectionCheckpoint.selectionSetSha256,
      currentSelectionSetSha256:
        activationSelectionCheckpoint.selectionSetSha256,
      declaredSelectionChainTailSha256:
        activationSelectionCheckpoint.selectionChainTailSha256,
      currentSelectionChainTailSha256:
        activationSelectionCheckpoint.selectionChainTailSha256,
      declaredSelectionCount: activationSelectionCheckpoint.selectionCount,
      currentSelectionCount: activationSelectionCheckpoint.selectionCount,
      declaredCurrentSelectionSha256:
        activationSelectionCheckpoint.currentSelectionSha256,
      currentSelectionSha256:
        activationSelectionCheckpoint.currentSelectionSha256,
      contentSha256: "5".repeat(64),
    } satisfies ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointVerification;
    const calls = [
      {
        path: "/api/receipt-trust/anchors/directory/subscriptions",
        response: [subscription],
      },
      {
        path: "/api/receipt-trust/anchors/directory/subscriptions",
        method: "POST",
        body: createRequest,
        response: subscription,
      },
      {
        path: `/api/receipt-trust/anchors/directory/subscriptions/${subscription.id}/refresh`,
        method: "POST",
        body: {
          threadId: subscription.auditThreadId,
          expectedRevision: subscription.revision,
        },
        response: refreshResult,
      },
      {
        path: `/api/receipt-trust/anchors/directory/subscriptions/${subscription.id}`,
        method: "POST",
        body: {
          threadId: subscription.auditThreadId,
          expectedRevision: refreshResult.subscription.revision,
          status: "paused",
        },
        response: paused,
      },
      {
        path: "/api/receipt-trust/anchors/directory/subscriptions/quorum",
        method: "POST",
        body: { policy: { minimumSources: 2, minimumAgreementCount: 2 } },
        response: quorum,
      },
      {
        path: "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion",
        method: "POST",
        body: { policy: { minimumSources: 2, minimumAgreementCount: 2 } },
        response: promotion,
      },
      {
        path: "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines",
        response: [],
      },
      {
        path: "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines",
        method: "POST",
        body: promotionBaselineRequest,
        response: promotionBaselineResult,
      },
      {
        path: "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/verify",
        method: "POST",
        body: { baseline: promotionBaseline },
        response: promotionBaselineVerification,
      },
      {
        path: "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/import",
        method: "POST",
        body: promotionBaselineImportRequest,
        response: promotionBaselineImportResult,
      },
      {
        path: "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-decision",
        method: "POST",
        body: activationDecisionRequest,
        response: activationDecisionResult,
      },
      {
        path: "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-decisions",
        response: activationDecisionHistory,
      },
      {
        path: "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-decisions/verify",
        method: "POST",
        body: { history: activationDecisionHistory },
        response: activationDecisionHistoryVerification,
      },
      {
        path: "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection",
        response: activationSelectionState,
      },
      {
        path: "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/drift-audit",
        response: activationSelectionDriftAudit,
      },
      {
        path: "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint",
        response: activationSelectionCheckpoint,
      },
      {
        path: "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/verify",
        method: "POST",
        body: { checkpoint: activationSelectionCheckpoint },
        response: activationSelectionCheckpointVerification,
      },
      {
        path: "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-review",
        method: "POST",
        body: activationSelectionRotationReviewRequest,
        response: activationSelectionRotationReview,
      },
      {
        path: "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/apply",
        method: "POST",
        body: activationSelectionRequest,
        response: activationSelectionResult,
      },
    ];
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      const call = calls[fetchMock.mock.calls.length - 1]!;
      expect(path).toBe(call.path);
      expect(init?.method).toBe(call.method);
      if (call.body) expect(init?.body).toBe(JSON.stringify(call.body));
      return jsonResponse(call.response);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      listReceiptTrustAnchorDirectorySubscriptions(),
    ).resolves.toEqual([subscription]);
    await expect(
      createReceiptTrustAnchorDirectorySubscription(createRequest),
    ).resolves.toEqual(subscription);
    await expect(
      refreshReceiptTrustAnchorDirectorySubscription(
        subscription.id,
        subscription.auditThreadId,
        subscription.revision,
      ),
    ).resolves.toEqual(refreshResult);
    await expect(
      updateReceiptTrustAnchorDirectorySubscription(subscription.id, {
        threadId: subscription.auditThreadId,
        expectedRevision: refreshResult.subscription.revision,
        status: "paused",
      }),
    ).resolves.toEqual(paused);
    await expect(
      evaluateReceiptTrustAnchorDirectoryQuorum({
        policy: { minimumSources: 2, minimumAgreementCount: 2 },
      }),
    ).resolves.toEqual(quorum);
    await expect(
      promoteReceiptTrustAnchorDirectoryQuorum({
        policy: { minimumSources: 2, minimumAgreementCount: 2 },
      }),
    ).resolves.toEqual(promotion);
    await expect(
      listReceiptTrustAnchorDirectoryQuorumPromotionBaselines(),
    ).resolves.toEqual([]);
    await expect(
      promoteReceiptTrustAnchorDirectoryQuorumBaseline(
        promotionBaselineRequest,
      ),
    ).resolves.toEqual(promotionBaselineResult);
    await expect(
      verifyReceiptTrustAnchorDirectoryQuorumPromotionBaseline({
        baseline: promotionBaseline,
      }),
    ).resolves.toEqual(promotionBaselineVerification);
    await expect(
      importReceiptTrustAnchorDirectoryQuorumPromotionBaseline(
        promotionBaselineImportRequest,
      ),
    ).resolves.toEqual(promotionBaselineImportResult);
    await expect(
      signReceiptTrustAnchorDirectoryQuorumActivationDecision(
        activationDecisionRequest,
      ),
    ).resolves.toEqual(activationDecisionResult);
    await expect(
      getReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory(),
    ).resolves.toEqual(activationDecisionHistory);
    await expect(
      verifyReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory({
        history: activationDecisionHistory,
      }),
    ).resolves.toEqual(activationDecisionHistoryVerification);
    await expect(
      getReceiptTrustAnchorDirectoryQuorumActivationSelectionState(),
    ).resolves.toEqual(activationSelectionState);
    await expect(
      getReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit(),
    ).resolves.toEqual(activationSelectionDriftAudit);
    await expect(
      getReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint(),
    ).resolves.toEqual(activationSelectionCheckpoint);
    await expect(
      verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint(
        { checkpoint: activationSelectionCheckpoint },
      ),
    ).resolves.toEqual(activationSelectionCheckpointVerification);
    await expect(
      reviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotation(
        activationSelectionRotationReviewRequest,
      ),
    ).resolves.toEqual(activationSelectionRotationReview);
    await expect(
      applyReceiptTrustAnchorDirectoryQuorumActivationSelection(
        activationSelectionRequest,
      ),
    ).resolves.toEqual(activationSelectionResult);
    expect(fetchMock).toHaveBeenCalledTimes(19);
  });

  it("verifies signed receipts against an uploaded anchor directory", async () => {
    const directory = {
      kind: "napier.receipt-trust-anchor-directory",
      contentSha256: "a".repeat(64),
    };
    const envelope = {
      kind: "napier.trusted-receipt-envelope",
      contentSha256: "b".repeat(64),
    } as TrustedReceiptEnvelope;
    const directoryPolicy = {
      requiredTrustedKeyIds: ["e".repeat(64)],
    };
    const verification: TrustedReceiptVerification = {
      status: "trusted",
      verifiedAt: "2026-07-27T00:00:02.000Z",
      receiptKind: "policy_retirement_proof_bundle",
      receiptContentSha256: "c".repeat(64),
      receiptArtifactSha256: "d".repeat(64),
      keyId: "e".repeat(64),
      envelopeSha256: envelope.contentSha256,
      anchorDirectorySha256: "a".repeat(64),
      anchorDirectoryVerificationSha256: "f".repeat(64),
      anchorDirectoryPolicySha256: "0".repeat(64),
      anchorDirectoryAgeMs: 1_000,
      anchorDirectoryAnchorCount: 1,
      signatureValid: true,
      integrityValid: true,
      reason: "Receipt signature and evidence are trusted",
    };
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      expect(path).toBe("/api/receipt-trust/verify");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({ "Content-Type": "application/json" });
      expect(init?.body).toBe(
        JSON.stringify({ envelope, directory, directoryPolicy }),
      );
      return jsonResponse(verification);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      verifyTrustedReceipt(envelope, directory, directoryPolicy),
    ).resolves.toEqual(verification);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

function jsonResponse(value: unknown): Response {
  const text = JSON.stringify(value);
  return new Response(text, {
    headers: {
      "Content-Type": "application/json",
      "X-Napier-Content-SHA256": createHash("sha256")
        .update(text)
        .digest("hex"),
      "X-Napier-Content-SHA256-Mode": "body",
    },
  });
}
