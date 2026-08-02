import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  NAPIER_API_VERSION,
  type ReceiptTrustAnchorDirectoryDiscovery,
  type ReceiptTrustAnchorDirectoryVerificationPolicy,
} from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { canonicalJson } from "../src/ed25519.js";
import {
  createReceiptTrustAnchorDirectoryQuorumActivationDecisionReceipt,
  createReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory,
  createReceiptTrustAnchorDirectoryQuorumActivationSourceAlignment,
  createReceiptTrustAnchorDirectorySubscription,
  createReceiptTrustAnchorDirectoryQuorumPromotionReceipt,
  reviewReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicy,
  verifyReceiptTrustAnchorDirectoryQuorumPromotionBaseline,
  validatePersistedReceiptTrustAnchorDirectorySubscription,
} from "../src/receipt-trust-directory-subscriptions.js";
import {
  createReceiptTrustAnchor,
  createReceiptTrustAnchorDirectory,
  createReceiptTrustAnchorDirectoryMetadataReceipt,
  signTrustedReceipt,
  verifyReceiptTrustAnchorDirectory,
  verifyTrustedReceiptEnvelope,
} from "../src/receipt-trust-envelopes.js";
import { LocalStore } from "../src/store.js";

const SIGNING_ENV = "NAPIER_TEST_QUORUM_PROMOTION_KEY";
const temporaryRoots: string[] = [];
const openStores: LocalStore[] = [];

afterEach(async () => {
  delete process.env[SIGNING_ENV];
  for (const store of openStores.splice(0)) store.close();
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("receipt trust anchor directory subscriptions", () => {
  it("persists last-good discoveries and rejects stale or invalid promotion", async () => {
    const { store, options } = await createStore();
    const thread = store.listThreads()[0]!;
    const sourceUrl = "https://trust.example.test/napier/anchors.json";
    const directory = createDirectory(thread.id);
    const policy: ReceiptTrustAnchorDirectoryVerificationPolicy = {
      maxAgeMs: 24 * 60 * 60 * 1_000,
      minimumTrustedCount: 1,
    };
    const discovery = createDiscovery(sourceUrl, directory, policy);
    const request = {
      threadId: thread.id,
      label: "Hosted release trust",
      sourceUrl,
      refreshIntervalMs: 5 * 60 * 1_000,
      policy,
    };

    const created = await store.createReceiptTrustAnchorDirectorySubscription(
      request,
      discovery,
    );
    expect(created).toEqual(
      expect.objectContaining({
        status: "active",
        revision: 1,
        lastRefreshStatus: "promoted",
        lastGoodDiscovery: discovery,
        transparencyEntryCount: 1,
        transparencyTailSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        transparencyHistory: [
          expect.objectContaining({
            sequence: 1,
            status: "promoted",
            discoverySha256: discovery.contentSha256,
            directorySha256: directory.contentSha256,
            anchorSetSha256: directory.anchorSetSha256,
          }),
        ],
      }),
    );
    expect(JSON.stringify(created)).not.toContain(sourceUrl);
    expect(store.listReceiptTrustAnchorDirectorySubscriptions()).toEqual([
      created,
    ]);

    await expect(
      store.claimReceiptTrustAnchorDirectorySubscription(
        created.id,
        created.revision + 1,
        "test-worker",
      ),
    ).rejects.toThrow("revision changed");

    const expiredClaim =
      await store.claimReceiptTrustAnchorDirectorySubscription(
        created.id,
        created.revision,
        "test-worker",
        {
          now: new Date("2020-01-01T00:00:00.000Z"),
          leaseMs: 5_000,
        },
      );
    await expect(
      store.settleReceiptTrustAnchorDirectorySubscriptionClaim(
        created.id,
        expiredClaim.token,
        { discovery },
      ),
    ).rejects.toThrow("claim expired");

    const claim = await store.claimReceiptTrustAnchorDirectorySubscription(
      created.id,
      created.revision,
      "test-worker",
    );
    const unchanged =
      await store.settleReceiptTrustAnchorDirectorySubscriptionClaim(
        created.id,
        claim.token,
        { discovery },
      );
    expect(unchanged).toEqual(
      expect.objectContaining({
        status: "unchanged",
        subscription: expect.objectContaining({
          revision: 2,
          lastRefreshStatus: "unchanged",
          lastGoodDiscovery: discovery,
          transparencyEntryCount: 2,
        }),
      }),
    );

    const rotatedDirectory = createDirectory(thread.id);
    const rotatedPolicy: ReceiptTrustAnchorDirectoryVerificationPolicy = {
      ...policy,
      expectedAnchorSetSha256: rotatedDirectory.anchorSetSha256,
    };
    const rotatedDiscovery = createDiscovery(
      sourceUrl,
      rotatedDirectory,
      rotatedPolicy,
    );
    const rotatedClaim =
      await store.claimReceiptTrustAnchorDirectorySubscription(
        created.id,
        unchanged.subscription.revision,
        "test-worker",
      );
    await expect(
      store.settleReceiptTrustAnchorDirectorySubscriptionClaim(
        created.id,
        rotatedClaim.token,
        { discovery: rotatedDiscovery },
      ),
    ).rejects.toThrow("discovery binding changed");

    const acceptedRotation = createDiscovery(
      sourceUrl,
      rotatedDirectory,
      policy,
    );
    const promoted =
      await store.settleReceiptTrustAnchorDirectorySubscriptionClaim(
        created.id,
        rotatedClaim.token,
        { discovery: acceptedRotation },
      );
    expect(promoted).toEqual(
      expect.objectContaining({
        status: "promoted",
        subscription: expect.objectContaining({
          revision: 3,
          lastGoodDiscovery: acceptedRotation,
          transparencyEntryCount: 3,
          transparencyHistory: expect.arrayContaining([
            expect.objectContaining({
              sequence: 3,
              status: "promoted",
              directorySha256: rotatedDirectory.contentSha256,
              previousEntrySha256:
                unchanged.subscription.transparencyTailSha256,
            }),
          ]),
        }),
      }),
    );

    const rollbackClaim =
      await store.claimReceiptTrustAnchorDirectorySubscription(
        created.id,
        promoted.subscription.revision,
        "test-worker",
      );
    const rollbackRejected =
      await store.settleReceiptTrustAnchorDirectorySubscriptionClaim(
        created.id,
        rollbackClaim.token,
        { discovery },
      );
    expect(rollbackRejected).toEqual(
      expect.objectContaining({
        status: "rollback_rejected",
        subscription: expect.objectContaining({
          revision: 4,
          lastRefreshStatus: "rollback_rejected",
          lastDiscoverySha256: discovery.contentSha256,
          lastGoodDiscovery: acceptedRotation,
          transparencyEntryCount: 3,
          transparencyTailSha256: promoted.subscription.transparencyTailSha256,
        }),
      }),
    );

    const invalidDiscovery = createDiscovery(
      sourceUrl,
      {
        ...directory,
        anchors: [
          {
            ...directory.anchors[0]!,
            label: "Tampered release trust",
          },
        ],
      },
      policy,
    );
    expect(invalidDiscovery.status).toBe("invalid");
    const rejectedClaim =
      await store.claimReceiptTrustAnchorDirectorySubscription(
        created.id,
        rollbackRejected.subscription.revision,
        "test-worker",
      );
    const rejected =
      await store.settleReceiptTrustAnchorDirectorySubscriptionClaim(
        created.id,
        rejectedClaim.token,
        { discovery: invalidDiscovery },
      );
    expect(rejected).toEqual(
      expect.objectContaining({
        status: "rejected",
        subscription: expect.objectContaining({
          revision: 5,
          lastRefreshStatus: "rejected",
          lastDiscoverySha256: invalidDiscovery.contentSha256,
          lastGoodDiscovery: acceptedRotation,
        }),
      }),
    );

    const failedClaim =
      await store.claimReceiptTrustAnchorDirectorySubscription(
        created.id,
        rejected.subscription.revision,
        "test-worker",
      );
    const failureSha256 = sha256("bounded remote failure");
    const failed =
      await store.settleReceiptTrustAnchorDirectorySubscriptionClaim(
        created.id,
        failedClaim.token,
        { failureSha256 },
      );
    expect(failed).toEqual(
      expect.objectContaining({
        status: "failed",
        failureSha256,
        subscription: expect.objectContaining({
          revision: 6,
          lastRefreshStatus: "failed",
          lastFailureSha256: failureSha256,
          lastGoodDiscovery: acceptedRotation,
          transparencyEntryCount: 3,
          transparencyTailSha256: promoted.subscription.transparencyTailSha256,
        }),
      }),
    );

    const paused = await store.updateReceiptTrustAnchorDirectorySubscription(
      created.id,
      {
        threadId: thread.id,
        expectedRevision: failed.subscription.revision,
        status: "paused",
      },
    );
    expect(paused.status).toBe("paused");
    expect(
      await store.claimDueReceiptTrustAnchorDirectorySubscriptions(
        "test-worker",
        { now: new Date("2030-01-01T00:00:00.000Z") },
      ),
    ).toEqual({ claims: [] });

    store.close();
    openStores.splice(openStores.indexOf(store), 1);
    const reopened = new LocalStore(options);
    openStores.push(reopened);
    await reopened.initialize();
    expect(reopened.listReceiptTrustAnchorDirectorySubscriptions()).toEqual([
      paused,
    ]);
  });

  it("validates the private source locator against the public hash projection", () => {
    const sourceUrl = "https://trust.example.test/anchors.json";
    const directory = createDirectory("thread_contract");
    const policy = {
      maxAgeMs: 86_400_000,
      minimumTrustedCount: 1,
    };
    const persisted = createReceiptTrustAnchorDirectorySubscription(
      {
        threadId: "thread_contract",
        label: "Contract trust",
        sourceUrl,
        refreshIntervalMs: 300_000,
        policy,
      },
      createDiscovery(sourceUrl, directory, policy),
      "2026-07-27T00:00:00.000Z",
    );

    expect(
      validatePersistedReceiptTrustAnchorDirectorySubscription(persisted),
    ).toEqual(persisted);
    expect(() =>
      validatePersistedReceiptTrustAnchorDirectorySubscription({
        ...persisted,
        sourceUrl: "https://trust.example.test/other.json",
      }),
    ).toThrow("source hash mismatch");

    const mismatchedDirectory = createDirectory("thread_contract");
    const discovery = createDiscovery(sourceUrl, directory, policy);
    const { contentSha256: _contentSha256, ...forgedContent } = {
      ...discovery,
      directory: mismatchedDirectory,
    };
    expect(() =>
      createReceiptTrustAnchorDirectorySubscription(
        {
          threadId: "thread_contract",
          label: "Forged trust",
          sourceUrl,
          refreshIntervalMs: 300_000,
          policy,
        },
        {
          ...forgedContent,
          contentSha256: sha256(canonicalJson(forgedContent)),
        },
      ),
    ).toThrow("discovery is invalid");
  });

  it("evaluates hash-only quorum across independent last-good sources", async () => {
    const { store } = await createStore();
    const thread = store.listThreads()[0]!;
    const directory = createDirectory(thread.id);
    const policy = {
      maxAgeMs: 86_400_000,
      minimumTrustedCount: 1,
    };
    const left = await store.createReceiptTrustAnchorDirectorySubscription(
      {
        threadId: thread.id,
        label: "Left trust feed",
        sourceUrl: "https://left.example.test/anchors.json",
        refreshIntervalMs: 300_000,
        policy,
      },
      createDiscovery(
        "https://left.example.test/anchors.json",
        directory,
        policy,
      ),
    );
    const right = await store.createReceiptTrustAnchorDirectorySubscription(
      {
        threadId: thread.id,
        label: "Right trust feed",
        sourceUrl: "https://right.example.test/anchors.json",
        refreshIntervalMs: 300_000,
        policy,
      },
      createDiscovery(
        "https://right.example.test/anchors.json",
        directory,
        policy,
      ),
    );

    const agreed = store.getReceiptTrustAnchorDirectorySubscriptionQuorum();
    expect(agreed).toEqual(
      expect.objectContaining({
        kind: "napier.receipt-trust-anchor-directory-quorum",
        status: "agreed",
        diagnostics: [],
        sourceCount: 2,
        candidateCount: 1,
        agreementCount: 2,
        agreementWeight: 2,
        agreementDistinctSourceOriginCount: 2,
        selectedAnchorSetSha256: directory.anchorSetSha256,
        selectedDirectorySha256: directory.contentSha256,
        selectedDirectory: directory,
      }),
    );
    expect(JSON.stringify(agreed)).not.toContain("left.example.test");
    expect(
      agreed.sources.map((source) => source.subscriptionId).sort(),
    ).toEqual([left.id, right.id].sort());

    const unexpected = store.getReceiptTrustAnchorDirectorySubscriptionQuorum({
      expectedAnchorSetSha256: "f".repeat(64),
    });
    expect(unexpected).toEqual(
      expect.objectContaining({
        status: "policy_failed",
        diagnostics: ["anchor_set_unexpected"],
      }),
    );

    const dissentingDirectory = createDirectory(thread.id);
    const dissenting =
      await store.createReceiptTrustAnchorDirectorySubscription(
        {
          threadId: thread.id,
          label: "Dissenting trust feed",
          sourceUrl: "https://dissent.example.test/anchors.json",
          refreshIntervalMs: 300_000,
          policy,
        },
        createDiscovery(
          "https://dissent.example.test/anchors.json",
          dissentingDirectory,
          policy,
        ),
      );
    const split = store.getReceiptTrustAnchorDirectorySubscriptionQuorum({
      minimumSources: 3,
      minimumAgreementCount: 3,
    });
    expect(split).toEqual(
      expect.objectContaining({
        status: "split",
        diagnostics: [
          "insufficient_agreement",
          "insufficient_agreement_weight",
        ],
        sourceCount: 3,
        candidateCount: 2,
        agreementCount: 2,
        agreementWeight: 2,
        agreementDistinctSourceOriginCount: 2,
      }),
    );

    const weighted = store.getReceiptTrustAnchorDirectorySubscriptionQuorum({
      minimumSources: 3,
      minimumAgreementCount: 1,
      minimumDistinctSourceOrigins: 1,
      minimumAgreementWeight: 5,
      sourceWeights: [
        {
          sourceOriginSha256: dissenting.sourceOriginSha256,
          weight: 5,
        },
      ],
    });
    expect(weighted).toEqual(
      expect.objectContaining({
        status: "agreed",
        diagnostics: [],
        agreementCount: 1,
        agreementWeight: 5,
        agreementDistinctSourceOriginCount: 1,
        selectedAnchorSetSha256: dissentingDirectory.anchorSetSha256,
      }),
    );

    const pinned = store.getReceiptTrustAnchorDirectorySubscriptionQuorum({
      requiredSourceOriginSha256s: [dissenting.sourceOriginSha256],
    });
    expect(pinned).toEqual(
      expect.objectContaining({
        status: "policy_failed",
        diagnostics: ["required_source_origin_missing"],
      }),
    );

    const { privateKey } = generateKeyPairSync("ed25519");
    process.env[SIGNING_ENV] = privateKey
      .export({ format: "pem", type: "pkcs8" })
      .toString();
    const signingAnchor = await store.createReceiptTrustAnchor({
      threadId: thread.id,
      label: "Quorum metadata signer",
      source: { type: "environment", variable: SIGNING_ENV },
    });
    const metadataEnvelope = signTrustedReceipt(
      createReceiptTrustAnchorDirectoryMetadataReceipt(directory, {
        publisher: "Napier Trust Registry",
      }),
      signingAnchor,
    );
    const publisherSha256 = sha256("Napier Trust Registry");
    const metadataPinned =
      store.getReceiptTrustAnchorDirectorySubscriptionQuorum(
        {
          minimumMetadataPublisherCount: 1,
          requiredMetadataPublisherSha256s: [publisherSha256],
        },
        [
          {
            subscriptionId: left.id,
            status: "trusted",
            signatureValid: true,
            integrityValid: true,
            directoryBindingValid: true,
            diagnosticCount: 0,
            diagnosticsSha256: sha256("[]"),
            publisherSha256,
            signerKeyId: signingAnchor.keyId,
            envelopeSha256: metadataEnvelope.contentSha256,
            verificationSha256: "f".repeat(64),
          },
        ],
      );
    expect(metadataPinned).toEqual(
      expect.objectContaining({
        status: "agreed",
        diagnostics: [],
        agreementMetadataPublisherCount: 1,
        agreementMetadataPublisherSetSha256:
          expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(
      metadataPinned.sources.find(
        (source) => source.subscriptionId === left.id,
      ),
    ).toEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({
          status: "trusted",
          publisherSha256,
          directoryBindingValid: true,
        }),
      }),
    );
    const promotion = createReceiptTrustAnchorDirectoryQuorumPromotionReceipt(
      metadataPinned,
      [{ subscriptionId: left.id, envelope: metadataEnvelope }],
    );
    expect(promotion).toEqual(
      expect.objectContaining({
        kind: "napier.receipt-trust-anchor-directory-quorum-promotion",
        selectedAnchorSetSha256: directory.anchorSetSha256,
        selectedDirectorySha256: directory.contentSha256,
        selectedSubscriptionCount: 2,
        selectedMetadataCount: 1,
        selectedMetadata: [
          expect.objectContaining({
            subscriptionId: left.id,
            envelopeSha256: metadataEnvelope.contentSha256,
            publisherSha256,
            signerKeyId: signingAnchor.keyId,
          }),
        ],
      }),
    );
    const promotionEnvelope = signTrustedReceipt(promotion, signingAnchor);
    expect(promotionEnvelope.receiptKind).toBe(
      "receipt_trust_anchor_directory_quorum_promotion",
    );
    const baselineResult =
      await store.promoteReceiptTrustAnchorDirectoryQuorumPromotionBaseline(
        thread.id,
        promotionEnvelope,
      );
    expect(baselineResult).toEqual(
      expect.objectContaining({
        created: true,
        baseline: expect.objectContaining({
          promotedByThreadId: thread.id,
          selectedAnchorSetSha256: directory.anchorSetSha256,
          selectedDirectorySha256: directory.contentSha256,
          selectedSubscriptionSetSha256:
            promotion.selectedSubscriptionSetSha256,
          selectedMetadataEnvelopeSetSha256:
            promotion.selectedMetadataEnvelopeSetSha256,
          envelope: expect.objectContaining({
            contentSha256: promotionEnvelope.contentSha256,
          }),
        }),
      }),
    );
    expect(
      store.listReceiptTrustAnchorDirectoryQuorumPromotionBaselines(),
    ).toEqual([baselineResult.baseline]);
    const duplicateBaseline =
      await store.promoteReceiptTrustAnchorDirectoryQuorumPromotionBaseline(
        thread.id,
        promotionEnvelope,
      );
    expect(duplicateBaseline).toEqual({
      baseline: baselineResult.baseline,
      created: false,
    });
    const { store: importStore } = await createStore();
    const importThread = importStore.listThreads()[0]!;
    const importSigningAnchor = await importStore.createReceiptTrustAnchor({
      threadId: importThread.id,
      label: "Imported quorum signer",
      source: { type: "environment", variable: SIGNING_ENV },
    });
    const importPolicy = {
      maxBaselineAgeMs: 60_000,
      maxReceiptAgeMs: 60_000,
      maxSourceObservedAgeMs: 60_000,
      minimumAgreementCount: 2,
      minimumAgreementWeight: 2,
      minimumDistinctSourceOrigins: 2,
      minimumMetadataPublisherCount: 1,
      minimumSelectedMetadataCount: 1,
      expectedAnchorSetSha256: directory.anchorSetSha256,
      expectedDirectorySha256: directory.contentSha256,
      requiredSourceOriginSha256s: [left.sourceOriginSha256],
      requiredMetadataPublisherSha256s: [publisherSha256],
      requiredMetadataSignerKeyIds: [signingAnchor.keyId],
    };
    const importPolicyReview =
      reviewReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicy(
        baselineResult.baseline,
        importPolicy,
      );
    expect(importPolicyReview).toEqual(
      expect.objectContaining({
        kind: "napier.receipt-trust-anchor-directory-quorum-promotion-baseline-import-policy-review",
        status: "accepted",
        diagnostics: [],
        baselineSha256: baselineResult.baseline.contentSha256,
        selectedAnchorSetSha256: directory.anchorSetSha256,
        selectedDirectorySha256: directory.contentSha256,
        selectedSourceOriginCount: 2,
        selectedMetadataPublisherCount: 1,
        selectedMetadataSignerCount: 1,
        policySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    const sourceAlignment =
      createReceiptTrustAnchorDirectoryQuorumActivationSourceAlignment(
        baselineResult.baseline,
        store.listReceiptTrustAnchorDirectorySubscriptions(),
      );
    expect(sourceAlignment).toEqual(
      expect.objectContaining({
        kind: "napier.receipt-trust-anchor-directory-quorum-activation-source-alignment",
        baselineSha256: baselineResult.baseline.contentSha256,
        selectedAnchorSetSha256: directory.anchorSetSha256,
        selectedDirectorySha256: directory.contentSha256,
        selectedSourceOriginCount: 2,
        alignedSourceCount: 2,
        driftedSourceCount: 0,
        missingSourceCount: 0,
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    const baselineVerification =
      verifyReceiptTrustAnchorDirectoryQuorumPromotionBaseline(
        baselineResult.baseline,
        [signingAnchor],
      );
    const activationDecision =
      createReceiptTrustAnchorDirectoryQuorumActivationDecisionReceipt({
        baseline: baselineResult.baseline,
        verification: baselineVerification,
        policyReview: importPolicyReview,
        sourceAlignment,
      });
    expect(activationDecision).toEqual(
      expect.objectContaining({
        kind: "napier.receipt-trust-anchor-directory-quorum-activation-decision",
        decision: "approved",
        diagnostics: [],
        baselineSha256: baselineResult.baseline.contentSha256,
        verificationSha256: baselineVerification.contentSha256,
        policyReviewSha256: importPolicyReview.contentSha256,
        sourceAlignmentSha256: sourceAlignment.contentSha256,
      }),
    );
    const activationEnvelope = signTrustedReceipt(
      activationDecision,
      signingAnchor,
    );
    expect(activationEnvelope.receiptKind).toBe(
      "receipt_trust_anchor_directory_quorum_activation_decision",
    );
    expect(
      verifyTrustedReceiptEnvelope(activationEnvelope, [signingAnchor]),
    ).toEqual(expect.objectContaining({ status: "trusted" }));
    const activationResult = {
      baseline: baselineResult.baseline,
      verification: baselineVerification,
      policyReview: importPolicyReview,
      sourceAlignment,
      envelope: activationEnvelope,
    };
    const activationRecord =
      await store.recordReceiptTrustAnchorDirectoryQuorumActivationDecision(
        thread.id,
        activationResult,
      );
    expect(activationRecord).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^trustqad_[a-z0-9]{8,80}$/),
        signedByThreadId: thread.id,
        baseline: baselineResult.baseline,
        envelope: activationEnvelope,
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    await expect(
      store.recordReceiptTrustAnchorDirectoryQuorumActivationDecision(
        thread.id,
        activationResult,
      ),
    ).resolves.toEqual(activationRecord);
    expect(
      store.listReceiptTrustAnchorDirectoryQuorumActivationDecisionRecords(),
    ).toEqual([activationRecord]);
    const activationHistory =
      store.getReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory();
    expect(activationHistory).toEqual(
      expect.objectContaining({
        kind: "napier.receipt-trust-anchor-directory-quorum-activation-decision-history",
        decisionCount: 1,
        approvedCount: 1,
        rejectedCount: 0,
        distinctBaselineCount: 1,
        latestDecisionAt: activationRecord.createdAt,
        records: [activationRecord],
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(
      store.verifyReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory(
        activationHistory,
      ),
    ).toEqual(
      expect.objectContaining({
        status: "valid",
        diagnostics: [],
        declaredContentSha256: activationHistory.contentSha256,
        currentContentSha256: activationHistory.contentSha256,
        declaredDecisionCount: 1,
        currentDecisionCount: 1,
      }),
    );
    const reexportedActivationHistory =
      createReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory(
        [activationRecord],
        "2026-07-27T00:00:00.000Z",
      );
    expect(reexportedActivationHistory.contentSha256).toBe(
      activationHistory.contentSha256,
    );
    const divergentActivationHistory =
      createReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory(
        [],
        "2026-07-27T00:00:00.000Z",
      );
    expect(
      store.verifyReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory(
        divergentActivationHistory,
      ),
    ).toEqual(
      expect.objectContaining({
        status: "divergent",
        diagnostics: expect.arrayContaining([
          "current_history_mismatch",
          "decision_set_mismatch",
          "decision_count_mismatch",
        ]),
      }),
    );
    const tamperedActivationHistory = structuredClone(activationHistory);
    tamperedActivationHistory.records[0] = {
      ...tamperedActivationHistory.records[0]!,
      id: "trustqad_tampered",
    };
    expect(
      store.verifyReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory(
        tamperedActivationHistory,
      ),
    ).toEqual(
      expect.objectContaining({
        status: "invalid",
        diagnostics: ["history_invalid"],
        currentContentSha256: activationHistory.contentSha256,
        currentDecisionCount: 1,
      }),
    );
    const emptyActivationSelectionState =
      store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionState();
    expect(emptyActivationSelectionState).toEqual(
      expect.objectContaining({
        hasSelection: false,
        currentSelectionSha256: "",
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(
      store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit(),
    ).toEqual(
      expect.objectContaining({
        status: "missing_selection",
        diagnostics: ["selection_missing"],
        hasSelection: false,
        selectionStateSha256: emptyActivationSelectionState.contentSha256,
        currentQuorumStatus: "agreed",
        currentDirectorySha256: directory.contentSha256,
      }),
    );
    expect(
      store.reviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotation(
        activationRecord.id,
        "",
      ),
    ).toEqual(
      expect.objectContaining({
        status: "eligible",
        diagnostics: [],
        expectedCurrentSelectionSha256: "",
        currentSelectionSha256: "",
        activationDecisionRecordId: activationRecord.id,
        activationDecisionRecordSha256: activationRecord.contentSha256,
        driftAudit: expect.objectContaining({
          status: "missing_selection",
        }),
      }),
    );
    const emptySelectionCheckpoint =
      store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint();
    expect(emptySelectionCheckpoint).toEqual(
      expect.objectContaining({
        kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-transparency-checkpoint",
        hasSelection: false,
        selectionCount: 0,
        currentSelectionSha256: "",
        driftStatus: "missing_selection",
        entries: [],
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    const appliedSelection =
      await store.applyReceiptTrustAnchorDirectoryQuorumActivationSelection(
        thread.id,
        activationRecord.id,
        "",
      );
    expect(appliedSelection).toEqual(
      expect.objectContaining({
        applied: true,
        expectedCurrentSelectionSha256: "",
        selection: expect.objectContaining({
          activationDecisionRecordId: activationRecord.id,
          activationDecisionRecordSha256: activationRecord.contentSha256,
          baselineId: baselineResult.baseline.id,
          baselineSha256: baselineResult.baseline.contentSha256,
          selectedAnchorSetSha256: directory.anchorSetSha256,
          selectedDirectorySha256: directory.contentSha256,
          selectedDirectory: directory,
        }),
        selectionState: expect.objectContaining({
          hasSelection: true,
          selection: expect.objectContaining({
            activationDecisionRecordId: activationRecord.id,
          }),
        }),
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(
      store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionState(),
    ).toEqual(
      expect.objectContaining({
        hasSelection: true,
        currentSelectionSha256: appliedSelection.selection.contentSha256,
        selection: appliedSelection.selection,
        contentSha256: appliedSelection.selectionState.contentSha256,
      }),
    );
    expect(
      store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit(),
    ).toEqual(
      expect.objectContaining({
        status: "aligned",
        diagnostics: [],
        hasSelection: true,
        selectionId: appliedSelection.selection.id,
        selectionSha256: appliedSelection.selection.contentSha256,
        selectedDirectorySha256: directory.contentSha256,
        currentDirectorySha256: directory.contentSha256,
      }),
    );
    const selectionCheckpoint =
      store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint();
    expect(selectionCheckpoint).toEqual(
      expect.objectContaining({
        kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-transparency-checkpoint",
        hasSelection: true,
        selectionCount: 1,
        currentSelectionId: appliedSelection.selection.id,
        currentSelectionSha256: appliedSelection.selection.contentSha256,
        selectionChainTailSha256:
          selectionCheckpoint.currentSelectionEntrySha256,
        activationDecisionCount: 1,
        driftStatus: "aligned",
        entries: [
          expect.objectContaining({
            sequence: 1,
            selectionId: appliedSelection.selection.id,
            selectionSha256: appliedSelection.selection.contentSha256,
            activationDecisionRecordId: activationRecord.id,
            selectedDirectorySha256: directory.contentSha256,
          }),
        ],
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(
      store.verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint(
        selectionCheckpoint,
      ),
    ).toEqual(
      expect.objectContaining({
        status: "valid",
        diagnostics: [],
        declaredContentSha256: selectionCheckpoint.contentSha256,
        currentContentSha256: selectionCheckpoint.contentSha256,
        declaredSelectionCount: 1,
        currentSelectionCount: 1,
      }),
    );
    expect(
      store.verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint(
        emptySelectionCheckpoint,
      ),
    ).toEqual(
      expect.objectContaining({
        status: "divergent",
        diagnostics: expect.arrayContaining([
          "current_checkpoint_mismatch",
          "selection_set_mismatch",
          "selection_chain_tail_mismatch",
          "selection_count_mismatch",
          "current_selection_mismatch",
        ]),
        currentSelectionCount: 1,
      }),
    );
    const tamperedSelectionCheckpoint = structuredClone(selectionCheckpoint);
    tamperedSelectionCheckpoint.entries[0] = {
      ...tamperedSelectionCheckpoint.entries[0]!,
      selectionSha256: "f".repeat(64),
    };
    expect(
      store.verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint(
        tamperedSelectionCheckpoint,
      ),
    ).toEqual(
      expect.objectContaining({
        status: "invalid",
        diagnostics: ["checkpoint_invalid"],
        currentSelectionCount: 1,
      }),
    );
    expect(
      store.reviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotation(
        activationRecord.id,
        appliedSelection.selection.contentSha256,
      ),
    ).toEqual(
      expect.objectContaining({
        status: "already_active",
        diagnostics: ["selection_already_active"],
        currentSelectionSha256: appliedSelection.selection.contentSha256,
        driftAudit: expect.objectContaining({ status: "aligned" }),
      }),
    );
    expect(
      store.reviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotation(
        activationRecord.id,
        "",
      ),
    ).toEqual(
      expect.objectContaining({
        status: "stale_selection",
        diagnostics: expect.arrayContaining([
          "selection_precondition_failed",
          "selection_already_active",
        ]),
      }),
    );
    expect(
      store.reviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotation(
        "trustqad_missing1234567890",
        appliedSelection.selection.contentSha256,
      ),
    ).toEqual(
      expect.objectContaining({
        status: "missing_decision",
        diagnostics: ["activation_decision_missing"],
      }),
    );
    await expect(
      store.applyReceiptTrustAnchorDirectoryQuorumActivationSelection(
        thread.id,
        activationRecord.id,
        appliedSelection.selection.contentSha256,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        applied: false,
        selection: appliedSelection.selection,
      }),
    );
    await expect(
      store.applyReceiptTrustAnchorDirectoryQuorumActivationSelection(
        thread.id,
        activationRecord.id,
        "",
      ),
    ).rejects.toThrow("precondition failed");
    const rotationCandidateReceipt =
      createReceiptTrustAnchorDirectoryQuorumActivationDecisionReceipt(
        {
          baseline: baselineResult.baseline,
          verification: baselineVerification,
          policyReview: importPolicyReview,
          sourceAlignment,
        },
        "2026-07-27T00:00:01.000Z",
      );
    const rotationCandidateEnvelope = signTrustedReceipt(
      rotationCandidateReceipt,
      signingAnchor,
    );
    const rotationCandidateRecord =
      await store.recordReceiptTrustAnchorDirectoryQuorumActivationDecision(
        thread.id,
        {
          baseline: baselineResult.baseline,
          verification: baselineVerification,
          policyReview: importPolicyReview,
          sourceAlignment,
          envelope: rotationCandidateEnvelope,
        },
      );
    expect(rotationCandidateRecord.id).not.toBe(activationRecord.id);
    const imported =
      await importStore.importReceiptTrustAnchorDirectoryQuorumPromotionBaseline(
        importThread.id,
        baselineResult.baseline,
        "",
        [importSigningAnchor],
        importPolicy,
      );
    expect(imported).toEqual(
      expect.objectContaining({
        imported: true,
        policyReview: expect.objectContaining({
          status: "accepted",
          policySha256: importPolicyReview.policySha256,
        }),
        baseline: expect.objectContaining({
          promotedByThreadId: importThread.id,
          selectedAnchorSetSha256: directory.anchorSetSha256,
          selectedDirectorySha256: directory.contentSha256,
          selectedSubscriptionSetSha256:
            promotion.selectedSubscriptionSetSha256,
          envelope: expect.objectContaining({
            contentSha256: promotionEnvelope.contentSha256,
          }),
        }),
      }),
    );
    expect(
      importStore.listReceiptTrustAnchorDirectoryQuorumPromotionBaselines(),
    ).toEqual([imported.baseline]);
    await expect(
      importStore.importReceiptTrustAnchorDirectoryQuorumPromotionBaseline(
        importThread.id,
        baselineResult.baseline,
        "0".repeat(64),
        [importSigningAnchor],
      ),
    ).rejects.toThrow("precondition failed");
    await expect(
      importStore.importReceiptTrustAnchorDirectoryQuorumPromotionBaseline(
        importThread.id,
        baselineResult.baseline,
        imported.baseline.contentSha256,
        [],
      ),
    ).rejects.toThrow("signature is invalid");
    await expect(
      importStore.importReceiptTrustAnchorDirectoryQuorumPromotionBaseline(
        importThread.id,
        baselineResult.baseline,
        imported.baseline.contentSha256,
        [importSigningAnchor],
        {
          ...importPolicy,
          requiredSourceOriginSha256s: ["e".repeat(64)],
        },
      ),
    ).rejects.toThrow("policy rejected");
    await expect(
      importStore.importReceiptTrustAnchorDirectoryQuorumPromotionBaseline(
        importThread.id,
        baselineResult.baseline,
        imported.baseline.contentSha256,
        [importSigningAnchor],
      ),
    ).resolves.toEqual({
      baseline: imported.baseline,
      imported: false,
      previousBaselineSha256: imported.baseline.contentSha256,
    });
    const tamperedMetadataQuorum = structuredClone(metadataPinned);
    const sourceMetadata = tamperedMetadataQuorum.sources.find(
      (source) => source.subscriptionId === left.id,
    )?.metadata;
    if (!sourceMetadata) throw new Error("Expected quorum source metadata");
    const sourceMetadataRecord = sourceMetadata as unknown as Record<
      string,
      unknown
    >;
    sourceMetadataRecord["subscriptionId"] = left.id;
    expect(() =>
      createReceiptTrustAnchorDirectoryQuorumPromotionReceipt(
        tamperedMetadataQuorum,
        [{ subscriptionId: left.id, envelope: metadataEnvelope }],
      ),
    ).toThrow("unsupported fields");
    expect(() =>
      createReceiptTrustAnchorDirectoryQuorumPromotionReceipt(split, []),
    ).toThrow("requires an agreed quorum");

    const missingPublisher =
      store.getReceiptTrustAnchorDirectorySubscriptionQuorum(
        {
          requiredMetadataPublisherSha256s: ["c".repeat(64)],
        },
        [
          {
            subscriptionId: left.id,
            status: "trusted",
            signatureValid: true,
            integrityValid: true,
            directoryBindingValid: true,
            diagnosticCount: 0,
            diagnosticsSha256: sha256("[]"),
            publisherSha256,
          },
        ],
      );
    expect(missingPublisher).toEqual(
      expect.objectContaining({
        status: "policy_failed",
        diagnostics: ["required_metadata_publisher_missing"],
      }),
    );
    const driftedDirectory = createDirectory(thread.id);
    for (const target of [
      {
        id: left.id,
        sourceUrl: "https://left.example.test/anchors.json",
      },
      {
        id: right.id,
        sourceUrl: "https://right.example.test/anchors.json",
      },
    ]) {
      const currentSubscription =
        store
          .listReceiptTrustAnchorDirectorySubscriptions()
          .find((subscription) => subscription.id === target.id) ??
        (() => {
          throw new Error("Expected subscription for drift audit");
        })();
      const claim = await store.claimReceiptTrustAnchorDirectorySubscription(
        currentSubscription.id,
        currentSubscription.revision,
        "drift-test-worker",
      );
      await store.settleReceiptTrustAnchorDirectorySubscriptionClaim(
        currentSubscription.id,
        claim.token,
        {
          discovery: createDiscovery(
            target.sourceUrl,
            driftedDirectory,
            policy,
          ),
        },
      );
    }
    expect(
      store.getReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit(),
    ).toEqual(
      expect.objectContaining({
        status: "anchor_set_drift",
        diagnostics: ["anchor_set_drift"],
        selectedAnchorSetSha256: directory.anchorSetSha256,
        currentAnchorSetSha256: driftedDirectory.anchorSetSha256,
        currentDirectorySha256: driftedDirectory.contentSha256,
      }),
    );
    expect(
      store.reviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotation(
        rotationCandidateRecord.id,
        appliedSelection.selection.contentSha256,
      ),
    ).toEqual(
      expect.objectContaining({
        status: "blocked",
        diagnostics: ["source_alignment_drifted"],
        activationDecisionRecordId: rotationCandidateRecord.id,
        sourceAlignmentSha256: sourceAlignment.contentSha256,
        currentSourceAlignmentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        driftAudit: expect.objectContaining({
          status: "anchor_set_drift",
        }),
      }),
    );
  });
});

async function createStore(): Promise<{
  store: LocalStore;
  options: { dataRoot: string; workspaceRoot: string };
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-trust-subscription-"));
  temporaryRoots.push(root);
  const options = {
    dataRoot: path.join(root, "data"),
    workspaceRoot: path.join(root, "workspace"),
  };
  const store = new LocalStore(options);
  openStores.push(store);
  await store.initialize();
  return { store, options };
}

function createDirectory(threadId: string) {
  const { publicKey } = generateKeyPairSync("ed25519");
  const publicKeySpki = publicKey
    .export({ format: "der", type: "spki" })
    .toString("base64");
  const anchor = createReceiptTrustAnchor({
    threadId,
    label: "Hosted verifier",
    source: { type: "public_key", publicKeySpki },
  });
  return createReceiptTrustAnchorDirectory([anchor]);
}

function createDiscovery(
  sourceUrl: string,
  input: unknown,
  policy: ReceiptTrustAnchorDirectoryVerificationPolicy,
): ReceiptTrustAnchorDirectoryDiscovery {
  const url = new URL(sourceUrl);
  const verification = verifyReceiptTrustAnchorDirectory(input, policy);
  const responseBody = JSON.stringify(input);
  const content = {
    kind: "napier.receipt-trust-anchor-directory-discovery" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    generatedAt: new Date().toISOString(),
    status: verification.status,
    sourceUrlSha256: sha256(url.href),
    sourceOriginSha256: sha256(url.origin),
    httpStatus: 200,
    responseMediaType: "application/json",
    responseBytes: Buffer.byteLength(responseBody),
    responseBodySha256: sha256(responseBody),
    verification,
    ...(verification.status === "valid" ? { directory: input as never } : {}),
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
