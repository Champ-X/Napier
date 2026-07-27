import { describe, expect, it } from "vitest";

import type {
  ReceiptTrustAnchorDirectory,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint,
  ReceiptTrustAnchorDirectoryQuorumPromotionBaseline,
  ReceiptTrustAnchorDirectorySubscription,
} from "@napier/contracts";
import {
  DIRECTORY_SUBSCRIPTION_REFRESH_INTERVAL_MS,
  DISCOVERED_DIRECTORY_MAX_AGE_MS,
  DISCOVERED_SELECTION_CHECKPOINT_MAX_AGE_MS,
  QUORUM_BASELINE_ACTIVATION_MAX_AGE_MS,
  buildReceiptTrustDirectoryBaselineImportPolicy,
  projectReceiptTrustDirectoryBaselineActivation,
  qualifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryRequest,
  qualifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest,
  qualifyReceiptTrustAnchorDirectoryDiscoveryRequest,
  qualifyReceiptTrustAnchorDirectorySubscriptionRequest,
} from "../src/receipt-trust-view-model";

describe("receipt trust directory discovery ViewModel", () => {
  it("normalizes a qualified source and optional anchor-set pin", () => {
    expect(
      qualifyReceiptTrustAnchorDirectoryDiscoveryRequest(
        "  https://trust.example.test/anchors.json  ",
        "A".repeat(64),
      ),
    ).toEqual({
      sourceUrl: "https://trust.example.test/anchors.json",
      policy: {
        maxAgeMs: DISCOVERED_DIRECTORY_MAX_AGE_MS,
        minimumTrustedCount: 1,
        expectedAnchorSetSha256: "a".repeat(64),
      },
    });
  });

  it("qualifies an unpinned source with the bounded default policy", () => {
    expect(
      qualifyReceiptTrustAnchorDirectoryDiscoveryRequest(
        "https://trust.example.test/anchors.json",
        "",
      ),
    ).toEqual({
      sourceUrl: "https://trust.example.test/anchors.json",
      policy: {
        maxAgeMs: 86_400_000,
        minimumTrustedCount: 1,
      },
    });
  });

  it.each([
    ["http://trust.example.test/anchors.json", ""],
    ["https://user@trust.example.test/anchors.json", ""],
    ["https://trust.example.test/anchors.json?token=secret", ""],
    ["https://trust.example.test/anchors.json#latest", ""],
    ["not-a-url", ""],
    ["https://trust.example.test/anchors.json", "abc"],
  ])("rejects an unsafe or incomplete discovery form", (sourceUrl, pin) => {
    expect(
      qualifyReceiptTrustAnchorDirectoryDiscoveryRequest(sourceUrl, pin),
    ).toBeUndefined();
  });

  it("qualifies a durable subscription with a bounded refresh schedule", () => {
    expect(
      qualifyReceiptTrustAnchorDirectorySubscriptionRequest(
        "thread_12345678",
        "  Release trust feed  ",
        "https://trust.example.test/anchors.json",
        "",
      ),
    ).toEqual({
      threadId: "thread_12345678",
      label: "Release trust feed",
      sourceUrl: "https://trust.example.test/anchors.json",
      refreshIntervalMs: DIRECTORY_SUBSCRIPTION_REFRESH_INTERVAL_MS,
      policy: {
        maxAgeMs: DISCOVERED_DIRECTORY_MAX_AGE_MS,
        minimumTrustedCount: 1,
      },
    });
    expect(
      qualifyReceiptTrustAnchorDirectorySubscriptionRequest(
        "thread_12345678",
        " ",
        "https://trust.example.test/anchors.json",
        "",
      ),
    ).toBeUndefined();
  });

  it("qualifies hosted signed checkpoint discovery with local pins", () => {
    const checkpoint = createCheckpoint();
    const directory = createDirectory("a".repeat(64), "b".repeat(64));
    expect(
      qualifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryRequest(
        "  https://trust.example.test/activation-selection-checkpoint.json  ",
        "C".repeat(64),
        checkpoint,
        "D".repeat(64),
        directory,
        {
          expectedAnchorSetSha256: directory.anchorSetSha256,
          minimumTrustedCount: 1,
        },
      ),
    ).toEqual({
      sourceUrl:
        "https://trust.example.test/activation-selection-checkpoint.json",
      policy: {
        maxEnvelopeAgeMs: DISCOVERED_SELECTION_CHECKPOINT_MAX_AGE_MS,
        rejectRollback: true,
        minimumSelectionCount: checkpoint.selectionCount,
        expectedCheckpointSha256: "c".repeat(64),
        expectedSelectionSetSha256: checkpoint.selectionSetSha256,
        expectedSelectionChainTailSha256:
          checkpoint.selectionChainTailSha256,
        requiredSignerKeyIds: ["d".repeat(64)],
      },
      trustDirectory: directory,
      trustDirectoryPolicy: {
        expectedAnchorSetSha256: directory.anchorSetSha256,
        minimumTrustedCount: 1,
      },
    });
  });

  it.each([
    "http://trust.example.test/activation-selection-checkpoint.json",
    "https://trust.example.test/activation-selection-checkpoint.json?token=secret",
    "not-a-url",
  ])("rejects unsafe checkpoint discovery URLs", (sourceUrl) => {
    expect(
      qualifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryRequest(
        sourceUrl,
        "",
        createCheckpoint(),
      ),
    ).toBeUndefined();
  });

  it("rejects invalid checkpoint and signer pins", () => {
    expect(
      qualifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryRequest(
        "https://trust.example.test/activation-selection-checkpoint.json",
        "abc",
        createCheckpoint(),
      ),
    ).toBeUndefined();
    expect(
      qualifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryRequest(
        "https://trust.example.test/activation-selection-checkpoint.json",
        "",
        createCheckpoint(),
        "not-a-key",
      ),
    ).toBeUndefined();
  });

  it("qualifies durable hosted checkpoint subscriptions with pinned policy", () => {
    const checkpoint = createCheckpoint();
    expect(
      qualifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest(
        "thread_12345678",
        "  Activation checkpoint registry  ",
        "https://trust.example.test/activation-selection-checkpoint.json",
        checkpoint.contentSha256,
        checkpoint,
        "D".repeat(64),
      ),
    ).toEqual({
      threadId: "thread_12345678",
      label: "Activation checkpoint registry",
      sourceUrl:
        "https://trust.example.test/activation-selection-checkpoint.json",
      refreshIntervalMs: DIRECTORY_SUBSCRIPTION_REFRESH_INTERVAL_MS,
      policy: {
        maxEnvelopeAgeMs: DISCOVERED_SELECTION_CHECKPOINT_MAX_AGE_MS,
        rejectRollback: true,
        minimumSelectionCount: checkpoint.selectionCount,
        expectedCheckpointSha256: checkpoint.contentSha256,
        expectedSelectionSetSha256: checkpoint.selectionSetSha256,
        expectedSelectionChainTailSha256:
          checkpoint.selectionChainTailSha256,
        requiredSignerKeyIds: ["d".repeat(64)],
      },
    });
    expect(
      qualifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest(
        "thread_12345678",
        " ",
        "https://trust.example.test/activation-selection-checkpoint.json",
        "",
        checkpoint,
      ),
    ).toBeUndefined();
  });

  it("projects quorum baseline activation against current last-good sources", () => {
    const baseline = createBaseline();
    const subscriptions = [
      createSubscription(
        "left",
        baseline.envelope.receipt.quorum.sources[0]!.sourceOriginSha256,
        baseline.selectedAnchorSetSha256,
        baseline.selectedDirectorySha256,
      ),
      createSubscription(
        "right",
        baseline.envelope.receipt.quorum.sources[1]!.sourceOriginSha256,
        "d".repeat(64),
        "e".repeat(64),
      ),
    ];

    expect(
      projectReceiptTrustDirectoryBaselineActivation(
        [baseline],
        subscriptions,
      ),
    ).toEqual(
      expect.objectContaining({
        baselineCount: 1,
        latestBaseline: baseline,
        selectedSourceOriginSha256s: [
          baseline.envelope.receipt.quorum.sources[0]!.sourceOriginSha256,
          baseline.envelope.receipt.quorum.sources[1]!.sourceOriginSha256,
        ],
        metadataPublisherSha256s: ["7".repeat(64)],
        metadataSignerKeyIds: ["8".repeat(64)],
        alignedSourceCount: 1,
        driftedSourceCount: 1,
        missingSourceCount: 0,
        sourceProjections: [
          expect.objectContaining({
            subscriptionLabel: "left",
            status: "aligned",
          }),
          expect.objectContaining({
            subscriptionLabel: "right",
            status: "anchor_set_drift",
          }),
        ],
      }),
    );
  });

  it("builds a policy-bound import request from local activation context", () => {
    const baseline = createBaseline();
    const currentDirectory = createDirectory(
      baseline.selectedAnchorSetSha256,
      baseline.selectedDirectorySha256,
    );
    const subscriptions = [
      createSubscription(
        "left",
        baseline.envelope.receipt.quorum.sources[0]!.sourceOriginSha256,
        baseline.selectedAnchorSetSha256,
        baseline.selectedDirectorySha256,
      ),
      createSubscription(
        "right",
        baseline.envelope.receipt.quorum.sources[1]!.sourceOriginSha256,
        "d".repeat(64),
        "e".repeat(64),
      ),
    ];

    expect(
      buildReceiptTrustDirectoryBaselineImportPolicy(
        baseline,
        subscriptions,
        currentDirectory,
      ),
    ).toEqual({
      maxBaselineAgeMs: QUORUM_BASELINE_ACTIVATION_MAX_AGE_MS,
      maxReceiptAgeMs: QUORUM_BASELINE_ACTIVATION_MAX_AGE_MS,
      maxSourceObservedAgeMs: QUORUM_BASELINE_ACTIVATION_MAX_AGE_MS,
      minimumAgreementCount: 2,
      minimumAgreementWeight: 2,
      minimumDistinctSourceOrigins: 2,
      minimumMetadataPublisherCount: 1,
      minimumSelectedMetadataCount: 1,
      expectedAnchorSetSha256: baseline.selectedAnchorSetSha256,
      expectedDirectorySha256: baseline.selectedDirectorySha256,
      requiredSourceOriginSha256s: [
        baseline.envelope.receipt.quorum.sources[0]!.sourceOriginSha256,
      ],
      requiredMetadataPublisherSha256s: ["7".repeat(64)],
      requiredMetadataSignerKeyIds: ["8".repeat(64)],
    });
  });
});

function createBaseline(): ReceiptTrustAnchorDirectoryQuorumPromotionBaseline {
  const sourceOrigins = ["1".repeat(64), "2".repeat(64)];
  return {
    id: "trustqpb_1234567890abcdef1234",
    promotedByThreadId: "thread_12345678",
    selectedAnchorSetSha256: "a".repeat(64),
    selectedDirectorySha256: "b".repeat(64),
    selectedSubscriptionSetSha256: "3".repeat(64),
    selectedMetadataEnvelopeSetSha256: "4".repeat(64),
    createdAt: "2026-07-27T00:00:00.000Z",
    contentSha256: "5".repeat(64),
    envelope: {
      kind: "napier.trusted-receipt-envelope",
      schemaVersion: 1,
      apiVersion: "0.1.0",
      receiptKind: "receipt_trust_anchor_directory_quorum_promotion",
      receipt: {
        kind: "napier.receipt-trust-anchor-directory-quorum-promotion",
        schemaVersion: 1,
        apiVersion: "0.1.0",
        generatedAt: "2026-07-27T00:00:00.000Z",
        selectedAnchorSetSha256: "a".repeat(64),
        selectedDirectorySha256: "b".repeat(64),
        selectedSubscriptionCount: 2,
        selectedSubscriptionSetSha256: "3".repeat(64),
        selectedMetadataCount: 1,
        selectedMetadataEnvelopeSetSha256: "4".repeat(64),
        selectedMetadata: [
          {
            subscriptionId: "trustdir_1234567890abcdef1234",
            envelope: {
              kind: "napier.trusted-receipt-envelope",
              schemaVersion: 1,
              apiVersion: "0.1.0",
              receiptKind: "receipt_trust_anchor_directory_metadata",
              receipt: {
                kind: "napier.receipt-trust-anchor-directory-metadata-receipt",
                schemaVersion: 1,
                apiVersion: "0.1.0",
                generatedAt: "2026-07-27T00:00:00.000Z",
                publisher: "Napier Trust Registry",
                directorySha256: "b".repeat(64),
                anchorSetSha256: "a".repeat(64),
                anchorCount: 1,
                trustedCount: 1,
                revokedCount: 0,
                contentSha256: "6".repeat(64),
              },
              signature: {
                algorithm: "Ed25519",
                keyId: "8".repeat(64),
                signedAt: "2026-07-27T00:00:00.000Z",
                receiptArtifactSha256: "9".repeat(64),
                statementSha256: "0".repeat(64),
                value: "signature",
              },
              contentSha256: "c".repeat(64),
            },
            envelopeSha256: "c".repeat(64),
            verificationSha256: "6".repeat(64),
            publisherSha256: "7".repeat(64),
            signerKeyId: "8".repeat(64),
            contentSha256: "9".repeat(64),
          },
        ],
        quorum: {
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
            minimumMetadataPublisherCount: 1,
            expectedAnchorSetSha256: "",
            requiredSourceOriginSha256s: [],
            requiredMetadataPublisherSha256s: [],
            sourceWeights: [],
          },
          policySha256: "a".repeat(64),
          sourceCount: 2,
          candidateCount: 1,
          agreementCount: 2,
          agreementWeight: 2,
          agreementDistinctSourceOriginCount: 2,
          agreementMetadataPublisherCount: 1,
          agreementMetadataPublisherSetSha256: "7".repeat(64),
          selectedAnchorSetSha256: "a".repeat(64),
          selectedDirectorySha256: "b".repeat(64),
          sources: sourceOrigins.map((origin, index) => ({
            subscriptionId:
              index === 0
                ? "trustdir_1234567890abcdef1234"
                : "trustdir_abcdef12345678901234",
            subscriptionSha256: `${index}`.repeat(64).slice(0, 64),
            sourceUrlSha256: `${index + 2}`.repeat(64).slice(0, 64),
            sourceOriginSha256: origin,
            weight: 1,
            revision: 1,
            directorySha256: "b".repeat(64),
            anchorSetSha256: "a".repeat(64),
            discoverySha256: `${index + 4}`.repeat(64).slice(0, 64),
            transparencyTailSha256: `${index + 6}`.repeat(64).slice(0, 64),
            trustedCount: 1,
            observedAt: "2026-07-27T00:00:00.000Z",
          })),
          candidates: [],
          contentSha256: "f".repeat(64),
        },
        contentSha256: "e".repeat(64),
      },
      signature: {
        algorithm: "Ed25519",
        keyId: "8".repeat(64),
        signedAt: "2026-07-27T00:00:00.000Z",
        receiptArtifactSha256: "9".repeat(64),
        statementSha256: "0".repeat(64),
        value: "signature",
      },
      contentSha256: "c".repeat(64),
    },
  };
}

function createSubscription(
  label: string,
  sourceOriginSha256: string,
  anchorSetSha256: string,
  directorySha256: string,
): ReceiptTrustAnchorDirectorySubscription {
  return {
    kind: "napier.receipt-trust-anchor-directory-subscription",
    schemaVersion: 1,
    apiVersion: "0.1.0",
    id: `trustdir_${label.padEnd(20, "0")}`,
    label,
    auditThreadId: "thread_12345678",
    status: "active",
    revision: 1,
    sourceUrlSha256: `${label.length}`.repeat(64).slice(0, 64),
    sourceOriginSha256,
    refreshIntervalMs: DIRECTORY_SUBSCRIPTION_REFRESH_INTERVAL_MS,
    nextRefreshAt: "2026-07-28T00:00:00.000Z",
    policy: {
      maxAgeMs: DISCOVERED_DIRECTORY_MAX_AGE_MS,
      minimumTrustedCount: 1,
    },
    policySha256: `${label.length + 6}`.repeat(64).slice(0, 64),
    createdAt: "2026-07-27T00:00:00.000Z",
    updatedAt: "2026-07-27T00:00:00.000Z",
    lastGoodDiscovery: {
      kind: "napier.receipt-trust-anchor-directory-discovery",
      schemaVersion: 1,
      apiVersion: "0.1.0",
      generatedAt: "2026-07-27T00:00:00.000Z",
      sourceUrlSha256: `${label.length + 1}`.repeat(64).slice(0, 64),
      sourceOriginSha256,
      responseBodySha256: `${label.length + 2}`.repeat(64).slice(0, 64),
      responseBytes: 128,
      responseMediaType: "application/json",
      httpStatus: 200,
      status: "valid",
      verification: {
        kind: "napier.receipt-trust-anchor-directory-verification",
        schemaVersion: 1,
        apiVersion: "0.1.0",
        generatedAt: "2026-07-27T00:00:00.000Z",
        status: "valid",
        diagnostics: [],
        declaredContentSha256: directorySha256,
        recomputedContentSha256: directorySha256,
        declaredAnchorSetSha256: anchorSetSha256,
        recomputedAnchorSetSha256: anchorSetSha256,
        trustedCount: 1,
        revokedCount: 0,
        contentSha256: `${label.length + 3}`.repeat(64).slice(0, 64),
      },
      directory: createDirectory(anchorSetSha256, directorySha256),
      contentSha256: `${label.length + 4}`.repeat(64).slice(0, 64),
    },
    transparencyEntryCount: 1,
    transparencyHistory: [],
    contentSha256: `${label.length + 5}`.repeat(64).slice(0, 64),
  };
}

function createCheckpoint(): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint {
  return {
    kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-transparency-checkpoint",
    schemaVersion: 1,
    apiVersion: "0.1.0",
    generatedAt: "2026-07-27T00:00:00.000Z",
    hasSelection: true,
    selectionCount: 1,
    currentSelectionSha256: "1".repeat(64),
    currentSelectionId: "trustqas_1234567890abcdef1234",
    currentSelectionEntrySha256: "2".repeat(64),
    selectionSetSha256: "3".repeat(64),
    selectionChainTailSha256: "4".repeat(64),
    activationDecisionCount: 1,
    activationDecisionSetSha256: "5".repeat(64),
    baselineSetSha256: "6".repeat(64),
    policyReviewSetSha256: "7".repeat(64),
    sourceAlignmentSetSha256: "8".repeat(64),
    driftAuditSha256: "9".repeat(64),
    driftStatus: "aligned",
    entries: [],
    contentSha256: "0".repeat(64),
  };
}

function createDirectory(
  anchorSetSha256: string,
  contentSha256: string,
): ReceiptTrustAnchorDirectory {
  return {
    kind: "napier.receipt-trust-anchor-directory",
    schemaVersion: 1,
    apiVersion: "0.1.0",
    generatedAt: "2026-07-27T00:00:00.000Z",
    receiptKinds: ["receipt_trust_anchor_directory_quorum_promotion"],
    anchorCount: 1,
    trustedCount: 1,
    revokedCount: 0,
    anchorSetSha256,
    anchors: [
      {
        id: "trustkey_1234567890abcdef1234",
        keyId: "8".repeat(64),
        label: "Hosted verifier",
        algorithm: "Ed25519",
        publicKeySpki: "public-key",
        status: "trusted",
        createdAt: "2026-07-27T00:00:00.000Z",
        updatedAt: "2026-07-27T00:00:00.000Z",
        anchorSha256: "9".repeat(64),
      },
    ],
    contentSha256,
  };
}
