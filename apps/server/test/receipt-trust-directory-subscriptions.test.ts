import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  ImportReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineResult,
  ImportReceiptTrustAnchorDirectoryQuorumPromotionBaselineResult,
  ReceiptTrustAnchor,
  ReceiptTrustAnchorDirectory,
  ReceiptTrustAnchorDirectoryQuorum,
  ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory,
  ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistoryVerification,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalPreflight,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationReview,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionState,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscovery,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineVerification,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRefreshResult,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointVerification,
  ReceiptTrustAnchorDirectoryQuorumPromotionBaseline,
  ReceiptTrustAnchorDirectoryQuorumPromotionBaselineVerification,
  ReceiptTrustAnchorDirectoryQuorumPromotionReceipt,
  ReceiptTrustAnchorDirectorySubscription,
  ReceiptTrustAnchorDirectorySubscriptionRefreshResult,
  ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionResult,
  PromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineResult,
  PromoteReceiptTrustAnchorDirectoryQuorumBaselineResult,
  SignReceiptTrustAnchorDirectoryQuorumActivationDecisionResult,
  TrustedReceiptEnvelope,
  TrustedReceiptVerification,
} from "@napier/contracts";
import {
  createReceiptTrustAnchor,
  createReceiptTrustAnchorDirectory,
  signTrustedReceipt,
} from "@napier/runtime";
import { afterEach, describe, expect, it } from "vitest";

import {
  createApp,
  createServices as createNapierServices,
} from "../src/app.js";

const temporaryRoots: string[] = [];
const openServices: Awaited<ReturnType<typeof createNapierServices>>[] = [];
const SIGNING_ENV = "NAPIER_TEST_QUORUM_METADATA_SIGNING_KEY";
const FOREIGN_SIGNING_ENV =
  "NAPIER_TEST_QUORUM_METADATA_FOREIGN_SIGNING_KEY";

afterEach(async () => {
  delete process.env[SIGNING_ENV];
  delete process.env[FOREIGN_SIGNING_ENV];
  for (const services of openServices.splice(0)) {
    await services.receiptTrustDirectorySubscriptions.stop();
    await services.recovery.stop();
    await services.automation.stop();
    await services.channels.stop();
    await services.extensions.shutdown();
    services.store.close();
  }
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("receipt trust anchor directory subscription HTTP surface", () => {
  it("promotes only valid CAS-bound refreshes and retains last-good trust", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-trust-sub-http-"));
    temporaryRoots.push(root);
    const sourceUrl = "https://trust.example.test/napier/anchors.json";
    const checkpointSourceUrl =
      "https://trust.example.test/napier/activation-selection-checkpoint.json";
    const checkpointMirrorSourceUrl =
      "https://mirror.example.test/napier/activation-selection-checkpoint.json";
    let hostedDirectory: ReceiptTrustAnchorDirectory | undefined;
    let hostedCheckpointEnvelope:
      | TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint>
      | undefined;
    let responseMode: "valid" | "invalid" | "failure" = "valid";
    let fetchCount = 0;
    const services = await createNapierServices({
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
      receiptTrustDirectoryDiscovery: {
        allowedOrigins: [
          "https://mirror.example.test",
          "https://trust.example.test",
        ],
        validateEndpoint: async () => undefined,
        fetcher: async (input) => {
          if (
            input === checkpointSourceUrl ||
            input === checkpointMirrorSourceUrl
          ) {
            if (!hostedCheckpointEnvelope) {
              throw new Error("Checkpoint envelope is unavailable");
            }
            return Response.json(hostedCheckpointEnvelope);
          }
          fetchCount += 1;
          if (responseMode === "failure") {
            throw new Error("private upstream detail");
          }
          if (!hostedDirectory) throw new Error("Directory is unavailable");
          const value =
            responseMode === "invalid"
              ? {
                  ...hostedDirectory,
                  anchors: [
                    {
                      ...hostedDirectory.anchors[0]!,
                      label: "Tampered hosted verifier",
                    },
                  ],
                }
              : hostedDirectory;
          return Response.json(value);
        },
      },
      receiptTrustDirectorySubscriptions: {
        workerId: "subscription-test-worker",
      },
    });
    openServices.push(services);
    const app = createApp(services);
    const thread = services.store.listThreads()[0]!;
    const { privateKey } = generateKeyPairSync("ed25519");
    process.env[SIGNING_ENV] = privateKey
      .export({ format: "pem", type: "pkcs8" })
      .toString();
    const anchorResponse = await app.request("/api/receipt-trust/anchors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        threadId: thread.id,
        label: "Hosted verifier A",
        source: { type: "environment", variable: SIGNING_ENV },
      }),
    });
    expect(anchorResponse.status).toBe(201);
    const signingAnchor = (await anchorResponse.json()) as ReceiptTrustAnchor;
    hostedDirectory = services.store.getReceiptTrustAnchorDirectory();
    const policy = {
      maxAgeMs: 24 * 60 * 60 * 1_000,
      minimumTrustedCount: 1,
    };

    const createResponse = await app.request(
      "/api/receipt-trust/anchors/directory/subscriptions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: thread.id,
          label: "Release trust feed",
          sourceUrl,
          refreshIntervalMs: 5 * 60 * 1_000,
          policy,
        }),
      },
    );
    expect(createResponse.status).toBe(201);
    const created =
      (await createResponse.json()) as ReceiptTrustAnchorDirectorySubscription;
    expect(created).toEqual(
      expect.objectContaining({
        auditThreadId: thread.id,
        label: "Release trust feed",
        status: "active",
        revision: 1,
        lastRefreshStatus: "promoted",
      }),
    );
    expect(JSON.stringify(created)).not.toContain(sourceUrl);
    expect(
      createResponse.headers.get(
        "x-napier-receipt-trust-directory-subscription-sha256",
      ),
    ).toBe(created.contentSha256);
    expect(createResponse.headers.get("x-napier-content-sha256-mode")).toBe(
      "stable",
    );

    const listResponse = await app.request(
      "/api/receipt-trust/anchors/directory/subscriptions",
    );
    expect(listResponse.status).toBe(200);
    expect(
      (await listResponse.json()) as ReceiptTrustAnchorDirectorySubscription[],
    ).toEqual([created]);
    expect(listResponse.headers.get("x-napier-content-sha256-mode")).toBe(
      "body",
    );

    const mirrorSourceUrl =
      "https://mirror.example.test/napier/anchors-mirror.json";
    const mirrorCreateResponse = await app.request(
      "/api/receipt-trust/anchors/directory/subscriptions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: thread.id,
          label: "Release trust mirror",
          sourceUrl: mirrorSourceUrl,
          refreshIntervalMs: 5 * 60 * 1_000,
          policy,
        }),
      },
    );
    expect(mirrorCreateResponse.status).toBe(201);
    const mirror =
      (await mirrorCreateResponse.json()) as ReceiptTrustAnchorDirectorySubscription;
    const quorumResponse = await app.request(
      "/api/receipt-trust/anchors/directory/subscriptions/quorum",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          policy: { minimumSources: 2, minimumAgreementCount: 2 },
        }),
      },
    );
    expect(quorumResponse.status).toBe(200);
    const quorum =
      (await quorumResponse.json()) as ReceiptTrustAnchorDirectoryQuorum;
    expect(quorum).toEqual(
      expect.objectContaining({
        status: "agreed",
        sourceCount: 2,
        candidateCount: 1,
        agreementCount: 2,
        agreementWeight: 2,
        agreementDistinctSourceOriginCount: 2,
        selectedAnchorSetSha256: hostedDirectory.anchorSetSha256,
      }),
    );
    expect(
      quorum.sources.map((source) => source.subscriptionId).sort(),
    ).toEqual([created.id, mirror.id].sort());
    expect(
      quorumResponse.headers.get(
        "x-napier-receipt-trust-directory-quorum-status",
      ),
    ).toBe("agreed");
    expect(
      quorumResponse.headers.get(
        "x-napier-receipt-trust-directory-quorum-agreement-weight",
      ),
    ).toBe("2");
    expect(
      quorumResponse.headers.get(
        "x-napier-receipt-trust-directory-quorum-distinct-origin-count",
      ),
    ).toBe("2");
    const metadataSignResponse = await app.request(
      "/api/receipt-trust/anchors/directory/signed-metadata",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: thread.id,
          trustAnchorId: signingAnchor.id,
          publisher: "Napier Trust Registry",
        }),
      },
    );
    expect(metadataSignResponse.status).toBe(201);
    const metadataEnvelope =
      (await metadataSignResponse.json()) as TrustedReceiptEnvelope;
    const publisherSha256 = createHash("sha256")
      .update("Napier Trust Registry")
      .digest("hex");
    const metadataQuorumResponse = await app.request(
      "/api/receipt-trust/anchors/directory/subscriptions/quorum",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          policy: {
            minimumSources: 2,
            minimumAgreementCount: 2,
            minimumMetadataPublisherCount: 1,
            requiredMetadataPublisherSha256s: [publisherSha256],
          },
          metadata: [
            { subscriptionId: created.id, envelope: metadataEnvelope },
            { subscriptionId: mirror.id, envelope: metadataEnvelope },
          ],
        }),
      },
    );
    expect(metadataQuorumResponse.status).toBe(200);
    const metadataQuorum =
      (await metadataQuorumResponse.json()) as ReceiptTrustAnchorDirectoryQuorum;
    expect(metadataQuorum).toEqual(
      expect.objectContaining({
        status: "agreed",
        diagnostics: [],
        agreementMetadataPublisherCount: 1,
        selectedAnchorSetSha256: hostedDirectory.anchorSetSha256,
      }),
    );
    expect(
      metadataQuorum.sources.map((source) => source.metadata?.status),
    ).toEqual(["trusted", "trusted"]);
    expect(
      metadataQuorumResponse.headers.get(
        "x-napier-receipt-trust-directory-quorum-metadata-publisher-count",
      ),
    ).toBe("1");
    const promotionResponse = await app.request(
      "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          policy: {
            minimumSources: 2,
            minimumAgreementCount: 2,
            minimumMetadataPublisherCount: 1,
            requiredMetadataPublisherSha256s: [publisherSha256],
          },
          metadata: [
            { subscriptionId: created.id, envelope: metadataEnvelope },
            { subscriptionId: mirror.id, envelope: metadataEnvelope },
          ],
        }),
      },
    );
    expect(promotionResponse.status).toBe(201);
    const promotion =
      (await promotionResponse.json()) as ReceiptTrustAnchorDirectoryQuorumPromotionReceipt;
    expect(promotion).toEqual(
      expect.objectContaining({
        kind: "napier.receipt-trust-anchor-directory-quorum-promotion",
        selectedAnchorSetSha256: hostedDirectory.anchorSetSha256,
        selectedDirectorySha256: hostedDirectory.contentSha256,
        selectedSubscriptionCount: 2,
        selectedMetadataCount: 2,
        selectedMetadata: expect.arrayContaining([
          expect.objectContaining({
            subscriptionId: created.id,
            envelopeSha256: metadataEnvelope.contentSha256,
          }),
          expect.objectContaining({
            subscriptionId: mirror.id,
            envelopeSha256: metadataEnvelope.contentSha256,
          }),
        ]),
      }),
    );
    expect(
      promotionResponse.headers.get(
        "x-napier-receipt-trust-directory-quorum-promotion-sha256",
      ),
    ).toBe(promotion.contentSha256);
    const emptyBaselineListResponse = await app.request(
      "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines",
    );
    expect(emptyBaselineListResponse.status).toBe(200);
    expect(
      (await emptyBaselineListResponse.json()) as ReceiptTrustAnchorDirectoryQuorumPromotionBaseline[],
    ).toEqual([]);
    const baselineRequest = {
      threadId: thread.id,
      trustAnchorId: signingAnchor.id,
      policy: {
        minimumSources: 2,
        minimumAgreementCount: 2,
        minimumMetadataPublisherCount: 1,
        requiredMetadataPublisherSha256s: [publisherSha256],
      },
      metadata: [
        { subscriptionId: created.id, envelope: metadataEnvelope },
        { subscriptionId: mirror.id, envelope: metadataEnvelope },
      ],
    };
    const baselineResponse = await app.request(
      "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(baselineRequest),
      },
    );
    expect(baselineResponse.status).toBe(201);
    const baselineResult =
      (await baselineResponse.json()) as PromoteReceiptTrustAnchorDirectoryQuorumBaselineResult;
    expect(baselineResult).toEqual(
      expect.objectContaining({
        created: true,
        baseline: expect.objectContaining({
          promotedByThreadId: thread.id,
          selectedAnchorSetSha256: hostedDirectory.anchorSetSha256,
          selectedDirectorySha256: hostedDirectory.contentSha256,
          selectedSubscriptionSetSha256:
            promotion.selectedSubscriptionSetSha256,
          selectedMetadataEnvelopeSetSha256:
            promotion.selectedMetadataEnvelopeSetSha256,
          envelope: expect.objectContaining({
            receiptKind: "receipt_trust_anchor_directory_quorum_promotion",
            receipt: expect.objectContaining({
              selectedSubscriptionSetSha256:
                promotion.selectedSubscriptionSetSha256,
              selectedMetadataEnvelopeSetSha256:
                promotion.selectedMetadataEnvelopeSetSha256,
            }),
          }),
        }),
      }),
    );
    expect(
      baselineResponse.headers.get(
        "x-napier-receipt-trust-directory-quorum-promotion-baseline-sha256",
      ),
    ).toBe(baselineResult.baseline.contentSha256);
    expect(
      baselineResponse.headers.get(
        "x-napier-receipt-trust-directory-quorum-promotion-sha256",
      ),
    ).toBe(baselineResult.baseline.envelope.receipt.contentSha256);
    const baselineListResponse = await app.request(
      "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines",
    );
    expect(baselineListResponse.status).toBe(200);
    expect(
      (await baselineListResponse.json()) as ReceiptTrustAnchorDirectoryQuorumPromotionBaseline[],
    ).toEqual([baselineResult.baseline]);
    const duplicateBaselineResponse = await app.request(
      "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(baselineRequest),
      },
    );
    expect(duplicateBaselineResponse.status).toBe(200);
    const duplicateBaselineResult =
      (await duplicateBaselineResponse.json()) as PromoteReceiptTrustAnchorDirectoryQuorumBaselineResult;
    expect(duplicateBaselineResult).toEqual({
      baseline: baselineResult.baseline,
      created: false,
    });
    const baselineVerificationResponse = await app.request(
      "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baseline: baselineResult.baseline,
          trustDirectory: hostedDirectory,
          trustDirectoryPolicy: {
            expectedAnchorSetSha256: hostedDirectory.anchorSetSha256,
            minimumTrustedCount: 1,
          },
        }),
      },
    );
    expect(baselineVerificationResponse.status).toBe(200);
    const baselineVerification =
      (await baselineVerificationResponse.json()) as ReceiptTrustAnchorDirectoryQuorumPromotionBaselineVerification;
    expect(baselineVerification).toEqual(
      expect.objectContaining({
        kind: "napier.receipt-trust-anchor-directory-quorum-promotion-baseline-verification",
        status: "trusted",
        diagnostics: [],
        baselineValid: true,
        signatureValid: true,
        integrityValid: true,
        baselineSha256: baselineResult.baseline.contentSha256,
        envelopeSha256: baselineResult.baseline.envelope.contentSha256,
        receiptSha256: baselineResult.baseline.envelope.receipt.contentSha256,
        selectedAnchorSetSha256: hostedDirectory.anchorSetSha256,
        selectedDirectorySha256: hostedDirectory.contentSha256,
        anchorDirectorySha256: hostedDirectory.contentSha256,
      }),
    );
    expect(
      baselineVerificationResponse.headers.get(
        "x-napier-receipt-trust-directory-quorum-promotion-baseline-verification-status",
      ),
    ).toBe("trusted");
    expect(
      baselineVerificationResponse.headers.get(
        "x-napier-receipt-trust-directory-quorum-promotion-baseline-sha256",
      ),
    ).toBe(baselineResult.baseline.contentSha256);
    const emptyActivationHistoryResponse = await app.request(
      "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-decisions",
    );
    expect(emptyActivationHistoryResponse.status).toBe(200);
    const emptyActivationHistory =
      (await emptyActivationHistoryResponse.json()) as ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory;
    expect(emptyActivationHistory).toEqual(
      expect.objectContaining({
        decisionCount: 0,
        approvedCount: 0,
        rejectedCount: 0,
        records: [],
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(
      emptyActivationHistoryResponse.headers.get(
        "x-napier-receipt-trust-directory-quorum-activation-decision-count",
      ),
    ).toBe("0");
    const activationPolicy = {
      maxBaselineAgeMs: 86_400_000,
      maxReceiptAgeMs: 86_400_000,
      maxSourceObservedAgeMs: 86_400_000,
      minimumAgreementCount: 2,
      minimumAgreementWeight: 2,
      minimumDistinctSourceOrigins: 2,
      minimumMetadataPublisherCount: 1,
      minimumSelectedMetadataCount: 2,
      expectedAnchorSetSha256: hostedDirectory.anchorSetSha256,
      expectedDirectorySha256: hostedDirectory.contentSha256,
      requiredSourceOriginSha256s: [
        created.sourceOriginSha256,
        mirror.sourceOriginSha256,
      ],
      requiredMetadataPublisherSha256s: [publisherSha256],
      requiredMetadataSignerKeyIds: [signingAnchor.keyId],
    };
    const activationResponse = await app.request(
      "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-decision",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: thread.id,
          trustAnchorId: signingAnchor.id,
          baselineId: baselineResult.baseline.id,
          importPolicy: activationPolicy,
        }),
      },
    );
    expect(activationResponse.status).toBe(201);
    const activation =
      (await activationResponse.json()) as SignReceiptTrustAnchorDirectoryQuorumActivationDecisionResult;
    expect(activation).toEqual(
      expect.objectContaining({
        baseline: baselineResult.baseline,
        verification: expect.objectContaining({
          status: "trusted",
          baselineSha256: baselineResult.baseline.contentSha256,
        }),
        policyReview: expect.objectContaining({
          status: "accepted",
          policySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
        sourceAlignment: expect.objectContaining({
          alignedSourceCount: 2,
          driftedSourceCount: 0,
          missingSourceCount: 0,
        }),
        envelope: expect.objectContaining({
          receiptKind:
            "receipt_trust_anchor_directory_quorum_activation_decision",
          receipt: expect.objectContaining({
            decision: "approved",
            diagnostics: [],
            baselineSha256: baselineResult.baseline.contentSha256,
          }),
        }),
      }),
    );
    expect(
      activationResponse.headers.get(
        "x-napier-receipt-trust-directory-quorum-activation-decision",
      ),
    ).toBe("approved");
    expect(
      activationResponse.headers.get(
        "x-napier-receipt-trust-directory-quorum-activation-source-alignment-sha256",
      ),
    ).toBe(activation.sourceAlignment.contentSha256);
    const activationHistoryResponse = await app.request(
      "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-decisions",
    );
    expect(activationHistoryResponse.status).toBe(200);
    const activationHistory =
      (await activationHistoryResponse.json()) as ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory;
    expect(activationHistory).toEqual(
      expect.objectContaining({
        decisionCount: 1,
        approvedCount: 1,
        rejectedCount: 0,
        distinctBaselineCount: 1,
        records: [
          expect.objectContaining({
            signedByThreadId: thread.id,
            baseline: baselineResult.baseline,
            envelope: activation.envelope,
          }),
        ],
      }),
    );
    expect(
      activationHistoryResponse.headers.get(
        "x-napier-receipt-trust-directory-quorum-activation-decision-count",
      ),
    ).toBe("1");
    expect(
      activationHistoryResponse.headers.get(
        "x-napier-receipt-trust-directory-quorum-activation-decision-set-sha256",
      ),
    ).toBe(activationHistory.decisionSetSha256);
    const activationHistoryVerifyResponse = await app.request(
      "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-decisions/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ history: activationHistory }),
      },
    );
    expect(activationHistoryVerifyResponse.status).toBe(200);
    const activationHistoryVerification =
      (await activationHistoryVerifyResponse.json()) as ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistoryVerification;
    expect(activationHistoryVerification).toEqual(
      expect.objectContaining({
        status: "valid",
        diagnostics: [],
        declaredContentSha256: activationHistory.contentSha256,
        currentContentSha256: activationHistory.contentSha256,
        declaredDecisionSetSha256: activationHistory.decisionSetSha256,
        currentDecisionSetSha256: activationHistory.decisionSetSha256,
        declaredDecisionCount: 1,
        currentDecisionCount: 1,
      }),
    );
    expect(
      activationHistoryVerifyResponse.headers.get(
        "x-napier-verification-status",
      ),
    ).toBe("valid");
    const divergentActivationHistoryResponse = await app.request(
      "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-decisions/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ history: emptyActivationHistory }),
      },
    );
    expect(divergentActivationHistoryResponse.status).toBe(200);
    expect(
      (await divergentActivationHistoryResponse.json()) as ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistoryVerification,
    ).toEqual(
      expect.objectContaining({
        status: "divergent",
        diagnostics: expect.arrayContaining([
          "current_history_mismatch",
          "decision_set_mismatch",
          "decision_count_mismatch",
        ]),
        currentDecisionCount: 1,
      }),
    );
    const tamperedActivationHistory = structuredClone(activationHistory);
    tamperedActivationHistory.records[0] = {
      ...tamperedActivationHistory.records[0]!,
      id: "trustqad_tampered",
    };
    const invalidActivationHistoryResponse = await app.request(
      "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-decisions/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ history: tamperedActivationHistory }),
      },
    );
    expect(invalidActivationHistoryResponse.status).toBe(200);
    expect(
      (await invalidActivationHistoryResponse.json()) as ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistoryVerification,
    ).toEqual(
      expect.objectContaining({
        status: "invalid",
        diagnostics: ["history_invalid"],
        currentDecisionCount: 1,
      }),
    );
    const activationRecord = activationHistory.records[0]!;
    const emptyActivationSelectionResponse = await app.request(
      "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection",
    );
    expect(emptyActivationSelectionResponse.status).toBe(200);
    const emptyActivationSelectionState =
      (await emptyActivationSelectionResponse.json()) as ReceiptTrustAnchorDirectoryQuorumActivationSelectionState;
    expect(emptyActivationSelectionState).toEqual(
      expect.objectContaining({
        hasSelection: false,
        currentSelectionSha256: "",
      }),
    );
    expect(
      emptyActivationSelectionResponse.headers.get(
        "x-napier-receipt-trust-directory-quorum-activation-selection-active",
      ),
    ).toBe("false");
    const missingSelectionDriftAuditResponse = await app.request(
      "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/drift-audit",
    );
    expect(missingSelectionDriftAuditResponse.status).toBe(200);
    const missingSelectionDriftAudit =
      (await missingSelectionDriftAuditResponse.json()) as ReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit;
    expect(missingSelectionDriftAudit).toEqual(
      expect.objectContaining({
        status: "missing_selection",
        diagnostics: ["selection_missing"],
        hasSelection: false,
        currentQuorumStatus: "agreed",
        currentDirectorySha256: hostedDirectory.contentSha256,
      }),
    );
    expect(
      missingSelectionDriftAuditResponse.headers.get(
        "x-napier-receipt-trust-directory-quorum-activation-selection-drift-status",
      ),
    ).toBe("missing_selection");
    const emptySelectionCheckpointResponse = await app.request(
      "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint",
    );
    expect(emptySelectionCheckpointResponse.status).toBe(200);
    const emptySelectionCheckpoint =
      (await emptySelectionCheckpointResponse.json()) as ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint;
    expect(emptySelectionCheckpoint).toEqual(
      expect.objectContaining({
        hasSelection: false,
        selectionCount: 0,
        currentSelectionSha256: "",
        driftStatus: "missing_selection",
        entries: [],
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(
      emptySelectionCheckpointResponse.headers.get(
        "x-napier-receipt-trust-directory-quorum-activation-selection-count",
      ),
    ).toBe("0");
    const eligibleRotationReviewResponse = await app.request(
      "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-review",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          activationDecisionRecordId: activationRecord.id,
          expectedCurrentSelectionSha256: "",
        }),
      },
    );
    expect(eligibleRotationReviewResponse.status).toBe(200);
    const eligibleRotationReview =
      (await eligibleRotationReviewResponse.json()) as ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationReview;
    expect(eligibleRotationReview).toEqual(
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
    expect(
      eligibleRotationReviewResponse.headers.get(
        "x-napier-receipt-trust-directory-quorum-activation-selection-rotation-review-status",
      ),
    ).toBe("eligible");
    const rotationProposalPath =
      "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal";
    const missingCheckpointBaselineProposalResponse = await app.request(
      rotationProposalPath,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          activationDecisionRecordId: activationRecord.id,
          expectedCurrentSelectionSha256: "",
        }),
      },
    );
    expect(missingCheckpointBaselineProposalResponse.status).toBe(200);
    const missingCheckpointBaselineProposal =
      (await missingCheckpointBaselineProposalResponse.json()) as ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal;
    expect(missingCheckpointBaselineProposal).toEqual(
      expect.objectContaining({
        status: "missing_checkpoint_registry_baseline",
        diagnostics: ["checkpoint_registry_quorum_baseline_missing"],
        activationDecisionRecordId: activationRecord.id,
        expectedCurrentSelectionSha256: "",
        currentSelectionSha256: "",
        rotationReview: expect.objectContaining({
          status: "eligible",
          activationDecisionRecordId: activationRecord.id,
          expectedCurrentSelectionSha256: "",
        }),
        currentCheckpointSha256: emptySelectionCheckpoint.contentSha256,
        currentSelectionSetSha256: emptySelectionCheckpoint.selectionSetSha256,
      }),
    );
    expect(
      missingCheckpointBaselineProposalResponse.headers.get(
        "x-napier-receipt-trust-directory-quorum-activation-selection-rotation-proposal-status",
      ),
    ).toBe("missing_checkpoint_registry_baseline");
    const gatedRotationReviewResponse = await app.request(
      "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-review",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          activationDecisionRecordId: activationRecord.id,
          expectedCurrentSelectionSha256: "",
          checkpointRegistryQuorumPolicy: {
            minimumSources: 1,
            minimumAgreementCount: 1,
            minimumDistinctSourceOrigins: 1,
            expectedCheckpointSha256: emptySelectionCheckpoint.contentSha256,
          },
        }),
      },
    );
    expect(gatedRotationReviewResponse.status).toBe(200);
    const gatedRotationReview =
      (await gatedRotationReviewResponse.json()) as ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationReview;
    expect(gatedRotationReview).toEqual(
      expect.objectContaining({
        status: "blocked",
        diagnostics: ["checkpoint_registry_quorum_not_agreed"],
        checkpointRegistryQuorum: expect.objectContaining({
          status: "insufficient_sources",
          sourceCount: 0,
          eligibleSourceCount: 0,
        }),
      }),
    );
    expect(
      gatedRotationReviewResponse.headers.get(
        "x-napier-receipt-trust-directory-quorum-activation-selection-checkpoint-registry-quorum-status",
      ),
    ).toBe("insufficient_sources");
    const applyActivationSelectionResponse = await app.request(
      "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/apply",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: thread.id,
          activationDecisionRecordId: activationRecord.id,
          expectedCurrentSelectionSha256: "",
        }),
      },
    );
    expect(applyActivationSelectionResponse.status).toBe(201);
    const appliedActivationSelection =
      (await applyActivationSelectionResponse.json()) as ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionResult;
    expect(appliedActivationSelection).toEqual(
      expect.objectContaining({
        applied: true,
        expectedCurrentSelectionSha256: "",
        selection: expect.objectContaining({
          activationDecisionRecordId: activationRecord.id,
          activationDecisionRecordSha256: activationRecord.contentSha256,
          baselineId: baselineResult.baseline.id,
          baselineSha256: baselineResult.baseline.contentSha256,
          selectedAnchorSetSha256: hostedDirectory.anchorSetSha256,
          selectedDirectorySha256: hostedDirectory.contentSha256,
          selectedDirectory: hostedDirectory,
        }),
        selectionState: expect.objectContaining({
          hasSelection: true,
          currentSelectionSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(
      applyActivationSelectionResponse.headers.get(
        "x-napier-receipt-trust-directory-quorum-activation-selection-applied",
      ),
    ).toBe("true");
    const activationSelectionResponse = await app.request(
      "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection",
    );
    expect(activationSelectionResponse.status).toBe(200);
    expect(
      (await activationSelectionResponse.json()) as ReceiptTrustAnchorDirectoryQuorumActivationSelectionState,
    ).toEqual(
      expect.objectContaining({
        hasSelection: true,
        currentSelectionSha256:
          appliedActivationSelection.selection.contentSha256,
        selection: appliedActivationSelection.selection,
        contentSha256: appliedActivationSelection.selectionState.contentSha256,
      }),
    );
    const alignedDriftAuditResponse = await app.request(
      "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/drift-audit",
    );
    expect(alignedDriftAuditResponse.status).toBe(200);
    const alignedDriftAudit =
      (await alignedDriftAuditResponse.json()) as ReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit;
    expect(alignedDriftAudit).toEqual(
      expect.objectContaining({
        status: "aligned",
        diagnostics: [],
        hasSelection: true,
        selectionId: appliedActivationSelection.selection.id,
        selectionSha256: appliedActivationSelection.selection.contentSha256,
        selectedDirectorySha256: hostedDirectory.contentSha256,
        currentDirectorySha256: hostedDirectory.contentSha256,
      }),
    );
    expect(
      alignedDriftAuditResponse.headers.get(
        "x-napier-receipt-trust-directory-quorum-activation-selection-drift-status",
      ),
    ).toBe("aligned");
    const selectionCheckpointResponse = await app.request(
      "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint",
    );
    expect(selectionCheckpointResponse.status).toBe(200);
    const selectionCheckpoint =
      (await selectionCheckpointResponse.json()) as ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint;
    expect(selectionCheckpoint).toEqual(
      expect.objectContaining({
        hasSelection: true,
        selectionCount: 1,
        currentSelectionId: appliedActivationSelection.selection.id,
        currentSelectionSha256:
          appliedActivationSelection.selection.contentSha256,
        activationDecisionCount: 1,
        driftStatus: "aligned",
        entries: [
          expect.objectContaining({
            sequence: 1,
            selectionId: appliedActivationSelection.selection.id,
            selectionSha256:
              appliedActivationSelection.selection.contentSha256,
            activationDecisionRecordId: activationRecord.id,
            selectedDirectorySha256: hostedDirectory.contentSha256,
          }),
        ],
      }),
    );
    expect(
      selectionCheckpointResponse.headers.get(
        "x-napier-receipt-trust-directory-quorum-activation-selection-count",
      ),
    ).toBe("1");
    expect(
      selectionCheckpointResponse.headers.get(
        "x-napier-receipt-trust-directory-quorum-activation-selection-chain-tail-sha256",
      ),
    ).toBe(selectionCheckpoint.selectionChainTailSha256);
    const selectionCheckpointVerifyResponse = await app.request(
      "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ checkpoint: selectionCheckpoint }),
      },
    );
    expect(selectionCheckpointVerifyResponse.status).toBe(200);
    expect(
      (await selectionCheckpointVerifyResponse.json()) as ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointVerification,
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
      selectionCheckpointVerifyResponse.headers.get(
        "x-napier-verification-status",
      ),
    ).toBe("valid");
    const signedSelectionCheckpointResponse = await app.request(
      "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/sign",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: thread.id,
          trustAnchorId: signingAnchor.id,
        }),
      },
    );
    expect(signedSelectionCheckpointResponse.status).toBe(201);
    const signedSelectionCheckpoint =
      (await signedSelectionCheckpointResponse.json()) as TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint>;
    expect(signedSelectionCheckpoint).toEqual(
      expect.objectContaining({
        receiptKind:
          "receipt_trust_anchor_directory_quorum_activation_selection_checkpoint",
        receipt: expect.objectContaining({
          contentSha256: selectionCheckpoint.contentSha256,
          selectionCount: 1,
          selectionSetSha256: selectionCheckpoint.selectionSetSha256,
        }),
        signature: expect.objectContaining({
          keyId: signingAnchor.keyId,
          receiptArtifactSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(
      signedSelectionCheckpointResponse.headers.get(
        "x-napier-signature-key-id",
      ),
    ).toBe(signingAnchor.keyId);
    const signedSelectionCheckpointVerifyResponse = await app.request(
      "/api/receipt-trust/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ envelope: signedSelectionCheckpoint }),
      },
    );
    expect(signedSelectionCheckpointVerifyResponse.status).toBe(200);
    expect(
      (await signedSelectionCheckpointVerifyResponse.json()) as TrustedReceiptVerification,
    ).toEqual(
      expect.objectContaining({
        status: "trusted",
        receiptKind:
          "receipt_trust_anchor_directory_quorum_activation_selection_checkpoint",
        envelopeSha256: signedSelectionCheckpoint.contentSha256,
        anchorDirectorySource: "active_selection",
        keyId: signingAnchor.keyId,
        signatureValid: true,
        integrityValid: true,
      }),
    );
    const selectionCheckpointDiscoveryPath =
      "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/discover";
    hostedCheckpointEnvelope = signedSelectionCheckpoint;
    const validCheckpointDiscoveryResponse = await app.request(
      selectionCheckpointDiscoveryPath,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceUrl: checkpointSourceUrl,
          policy: {
            expectedCheckpointSha256: selectionCheckpoint.contentSha256,
            expectedSelectionSetSha256: selectionCheckpoint.selectionSetSha256,
            expectedSelectionChainTailSha256:
              selectionCheckpoint.selectionChainTailSha256,
            minimumSelectionCount: 1,
            requiredSignerKeyIds: [signingAnchor.keyId],
            rejectRollback: true,
          },
        }),
      },
    );
    expect(validCheckpointDiscoveryResponse.status).toBe(200);
    const validCheckpointDiscovery =
      (await validCheckpointDiscoveryResponse.json()) as ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscovery;
    expect(validCheckpointDiscovery).toEqual(
      expect.objectContaining({
        status: "valid",
        diagnostics: [],
        sourceUrlSha256: sha256Text(checkpointSourceUrl),
        sourceOriginSha256: sha256Text("https://trust.example.test"),
        trustedReceiptVerification: expect.objectContaining({
          status: "trusted",
          keyId: signingAnchor.keyId,
          envelopeSha256: signedSelectionCheckpoint.contentSha256,
        }),
        checkpointVerification: expect.objectContaining({
          status: "valid",
          declaredContentSha256: selectionCheckpoint.contentSha256,
          currentContentSha256: selectionCheckpoint.contentSha256,
        }),
        envelopeSha256: signedSelectionCheckpoint.contentSha256,
        checkpointSha256: selectionCheckpoint.contentSha256,
        signerKeyId: signingAnchor.keyId,
        selectionCount: 1,
        selectionSetSha256: selectionCheckpoint.selectionSetSha256,
        selectionChainTailSha256: selectionCheckpoint.selectionChainTailSha256,
        currentSelectionCount: 1,
        currentSelectionChainTailSha256:
          selectionCheckpoint.selectionChainTailSha256,
      }),
    );
    expect(JSON.stringify(validCheckpointDiscovery)).not.toContain(
      checkpointSourceUrl,
    );
    expect(
      validCheckpointDiscoveryResponse.headers.get(
        "x-napier-discovery-status",
      ),
    ).toBe("valid");
    expect(
      validCheckpointDiscoveryResponse.headers.get(
        "x-napier-content-sha256",
      ),
    ).toBe(validCheckpointDiscovery.contentSha256);
    expect(
      validCheckpointDiscoveryResponse.headers.get(
        "x-napier-content-sha256-mode",
      ),
    ).toBe("stable");
    expect(
      validCheckpointDiscoveryResponse.headers.get(
        "x-napier-receipt-trust-directory-quorum-activation-selection-checkpoint-sha256",
      ),
    ).toBe(selectionCheckpoint.contentSha256);
    const { privateKey: foreignPrivateKey } = generateKeyPairSync("ed25519");
    process.env[FOREIGN_SIGNING_ENV] = foreignPrivateKey
      .export({ format: "pem", type: "pkcs8" })
      .toString();
    const foreignAnchorResponse = await app.request(
      "/api/receipt-trust/anchors",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: thread.id,
          label: "Foreign checkpoint signer",
          source: { type: "environment", variable: FOREIGN_SIGNING_ENV },
        }),
      },
    );
    expect(foreignAnchorResponse.status).toBe(201);
    const foreignAnchor =
      (await foreignAnchorResponse.json()) as ReceiptTrustAnchor;
    hostedCheckpointEnvelope = signTrustedReceipt(
      selectionCheckpoint,
      foreignAnchor,
    );
    const untrustedCheckpointDiscoveryResponse = await app.request(
      selectionCheckpointDiscoveryPath,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceUrl: checkpointSourceUrl }),
      },
    );
    expect(untrustedCheckpointDiscoveryResponse.status).toBe(422);
    expect(
      (await untrustedCheckpointDiscoveryResponse.json()) as ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscovery,
    ).toEqual(
      expect.objectContaining({
        status: "invalid",
        diagnostics: ["checkpoint_receipt_untrusted"],
        trustedReceiptVerification: expect.objectContaining({
          status: "unknown_key",
          keyId: foreignAnchor.keyId,
        }),
        checkpointVerification: expect.objectContaining({
          status: "valid",
        }),
        signerKeyId: foreignAnchor.keyId,
      }),
    );
    hostedCheckpointEnvelope = signTrustedReceipt(
      emptySelectionCheckpoint,
      signingAnchor,
    );
    const rollbackCheckpointDiscoveryResponse = await app.request(
      selectionCheckpointDiscoveryPath,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceUrl: checkpointSourceUrl,
          policy: {
            requiredSignerKeyIds: [signingAnchor.keyId],
            minimumSelectionCount: 1,
            rejectRollback: true,
          },
        }),
      },
    );
    expect(rollbackCheckpointDiscoveryResponse.status).toBe(422);
    expect(
      (await rollbackCheckpointDiscoveryResponse.json()) as ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscovery,
    ).toEqual(
      expect.objectContaining({
        status: "invalid",
        diagnostics: expect.arrayContaining([
          "checkpoint_divergent",
          "selection_count_below_minimum",
          "selection_count_rollback",
        ]),
        trustedReceiptVerification: expect.objectContaining({
          status: "trusted",
          keyId: signingAnchor.keyId,
        }),
        checkpointVerification: expect.objectContaining({
          status: "divergent",
        }),
        selectionCount: 0,
        currentSelectionCount: 1,
      }),
    );
    hostedCheckpointEnvelope = signedSelectionCheckpoint;
    const pinnedCheckpointDiscoveryResponse = await app.request(
      selectionCheckpointDiscoveryPath,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceUrl: checkpointSourceUrl,
          policy: {
            expectedCheckpointSha256: "0".repeat(64),
            expectedSelectionSetSha256: "1".repeat(64),
            expectedSelectionChainTailSha256: "2".repeat(64),
            minimumSelectionCount: 2,
            requiredSignerKeyIds: ["3".repeat(64)],
            rejectRollback: false,
          },
        }),
      },
    );
    expect(pinnedCheckpointDiscoveryResponse.status).toBe(422);
    expect(
      (await pinnedCheckpointDiscoveryResponse.json()) as ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscovery,
    ).toEqual(
      expect.objectContaining({
        status: "invalid",
        diagnostics: expect.arrayContaining([
          "required_signer_missing",
          "checkpoint_hash_mismatch",
          "selection_set_mismatch",
          "selection_chain_tail_mismatch",
          "selection_count_below_minimum",
        ]),
        trustedReceiptVerification: expect.objectContaining({
          status: "trusted",
          keyId: signingAnchor.keyId,
        }),
        checkpointVerification: expect.objectContaining({
          status: "valid",
        }),
      }),
    );
    const disallowedCheckpointDiscoveryResponse = await app.request(
      selectionCheckpointDiscoveryPath,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceUrl: "https://untrusted.example.test/napier/checkpoint.json",
        }),
      },
    );
    expect(disallowedCheckpointDiscoveryResponse.status).toBe(403);
    const selectionCheckpointSubscriptionPath =
      "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/subscriptions";
    hostedCheckpointEnvelope = signedSelectionCheckpoint;
    const checkpointSubscriptionPolicy = {
      expectedCheckpointSha256: selectionCheckpoint.contentSha256,
      expectedSelectionSetSha256: selectionCheckpoint.selectionSetSha256,
      expectedSelectionChainTailSha256:
        selectionCheckpoint.selectionChainTailSha256,
      minimumSelectionCount: 1,
      requiredSignerKeyIds: [signingAnchor.keyId],
      rejectRollback: true,
    };
    const createCheckpointSubscriptionResponse = await app.request(
      selectionCheckpointSubscriptionPath,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: thread.id,
          label: "Activation checkpoint registry",
          sourceUrl: checkpointSourceUrl,
          refreshIntervalMs: 5 * 60 * 1_000,
          policy: checkpointSubscriptionPolicy,
        }),
      },
    );
    expect(createCheckpointSubscriptionResponse.status).toBe(201);
    const checkpointSubscription =
      (await createCheckpointSubscriptionResponse.json()) as ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription;
    expect(checkpointSubscription).toEqual(
      expect.objectContaining({
        auditThreadId: thread.id,
        label: "Activation checkpoint registry",
        status: "active",
        revision: 1,
        sourceUrlSha256: sha256Text(checkpointSourceUrl),
        sourceOriginSha256: sha256Text("https://trust.example.test"),
        lastRefreshStatus: "accepted",
        lastGoodDiscovery: expect.objectContaining({
          status: "valid",
          envelopeSha256: signedSelectionCheckpoint.contentSha256,
          checkpointSha256: selectionCheckpoint.contentSha256,
          selectionCount: 1,
        }),
        transparencyEntryCount: 1,
        transparencyHistory: [
          expect.objectContaining({
            sequence: 1,
            status: "accepted",
            envelopeSha256: signedSelectionCheckpoint.contentSha256,
            checkpointSha256: selectionCheckpoint.contentSha256,
          }),
        ],
      }),
    );
    expect(JSON.stringify(checkpointSubscription)).not.toContain(
      checkpointSourceUrl,
    );
    expect(
      createCheckpointSubscriptionResponse.headers.get(
        "x-napier-receipt-trust-directory-quorum-activation-selection-checkpoint-subscription-refresh-status",
      ),
    ).toBeNull();
    expect(
      createCheckpointSubscriptionResponse.headers.get(
        "x-napier-receipt-trust-directory-quorum-activation-selection-checkpoint-sha256",
      ),
    ).toBe(selectionCheckpoint.contentSha256);
    const listCheckpointSubscriptionsResponse = await app.request(
      selectionCheckpointSubscriptionPath,
    );
    expect(listCheckpointSubscriptionsResponse.status).toBe(200);
    expect(
      (await listCheckpointSubscriptionsResponse.json()) as ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription[],
    ).toEqual([checkpointSubscription]);
    const mirrorCheckpointSubscriptionResponse = await app.request(
      selectionCheckpointSubscriptionPath,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: thread.id,
          label: "Activation checkpoint mirror",
          sourceUrl: checkpointMirrorSourceUrl,
          refreshIntervalMs: 5 * 60 * 1_000,
          policy: checkpointSubscriptionPolicy,
        }),
      },
    );
    expect(mirrorCheckpointSubscriptionResponse.status).toBe(201);
    const mirrorCheckpointSubscription =
      (await mirrorCheckpointSubscriptionResponse.json()) as ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription;
    expect(mirrorCheckpointSubscription).toEqual(
      expect.objectContaining({
        label: "Activation checkpoint mirror",
        sourceOriginSha256: sha256Text("https://mirror.example.test"),
        lastRefreshStatus: "accepted",
        lastGoodDiscovery: expect.objectContaining({
          envelopeSha256: signedSelectionCheckpoint.contentSha256,
          checkpointSha256: selectionCheckpoint.contentSha256,
        }),
      }),
    );
    const checkpointRegistryQuorumResponse = await app.request(
      `${selectionCheckpointSubscriptionPath}/quorum`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          policy: {
            expectedCheckpointSha256: selectionCheckpoint.contentSha256,
            minimumSources: 2,
            minimumAgreementCount: 2,
            minimumDistinctSourceOrigins: 2,
            requiredSourceOriginSha256s: [
              sha256Text("https://mirror.example.test"),
              sha256Text("https://trust.example.test"),
            ],
            requiredSignerKeyIds: [signingAnchor.keyId],
          },
        }),
      },
    );
    expect(checkpointRegistryQuorumResponse.status).toBe(200);
    const checkpointRegistryQuorum =
      (await checkpointRegistryQuorumResponse.json()) as ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum;
    expect(checkpointRegistryQuorum).toEqual(
      expect.objectContaining({
        status: "agreed",
        diagnostics: [],
        sourceCount: 2,
        eligibleSourceCount: 2,
        candidateCount: 1,
        agreementCount: 2,
        agreementDistinctSourceOriginCount: 2,
        selectedCheckpointSha256: selectionCheckpoint.contentSha256,
        selectedSelectionSetSha256: selectionCheckpoint.selectionSetSha256,
        selectedSelectionChainTailSha256:
          selectionCheckpoint.selectionChainTailSha256,
        sources: expect.arrayContaining([
          expect.objectContaining({
            subscriptionId: checkpointSubscription.id,
            status: "eligible",
          }),
          expect.objectContaining({
            subscriptionId: mirrorCheckpointSubscription.id,
            status: "eligible",
          }),
        ]),
        candidates: [
          expect.objectContaining({
            checkpointSha256: selectionCheckpoint.contentSha256,
            sourceCount: 2,
            distinctSourceOriginCount: 2,
            signerCount: 1,
          }),
        ],
      }),
    );
    expect(
      checkpointRegistryQuorumResponse.headers.get(
        "x-napier-receipt-trust-directory-quorum-activation-selection-checkpoint-registry-quorum-status",
      ),
    ).toBe("agreed");
    const checkpointRegistryQuorumBaselinePath = `${selectionCheckpointSubscriptionPath}/quorum/baselines`;
    const emptyCheckpointRegistryQuorumBaselineListResponse =
      await app.request(checkpointRegistryQuorumBaselinePath);
    expect(emptyCheckpointRegistryQuorumBaselineListResponse.status).toBe(200);
    expect(
      (await emptyCheckpointRegistryQuorumBaselineListResponse.json()) as ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline[],
    ).toEqual([]);
    const checkpointRegistryQuorumBaselineRequest = {
      threadId: thread.id,
      trustAnchorId: signingAnchor.id,
      policy: {
        expectedCheckpointSha256: selectionCheckpoint.contentSha256,
        minimumSources: 2,
        minimumAgreementCount: 2,
        minimumDistinctSourceOrigins: 2,
        requiredSourceOriginSha256s: [
          sha256Text("https://mirror.example.test"),
          sha256Text("https://trust.example.test"),
        ],
        requiredSignerKeyIds: [signingAnchor.keyId],
      },
    };
    const checkpointRegistryQuorumBaselineResponse = await app.request(
      checkpointRegistryQuorumBaselinePath,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(checkpointRegistryQuorumBaselineRequest),
      },
    );
    expect(checkpointRegistryQuorumBaselineResponse.status).toBe(201);
    const checkpointRegistryQuorumBaselineResult =
      (await checkpointRegistryQuorumBaselineResponse.json()) as PromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineResult;
    expect(checkpointRegistryQuorumBaselineResult).toEqual(
      expect.objectContaining({
        created: true,
        baseline: expect.objectContaining({
          promotedByThreadId: thread.id,
          selectedCheckpointSha256: selectionCheckpoint.contentSha256,
          selectedSelectionSetSha256: selectionCheckpoint.selectionSetSha256,
          selectedSelectionChainTailSha256:
            selectionCheckpoint.selectionChainTailSha256,
          selectedSubscriptionSetSha256:
            checkpointRegistryQuorum.candidates[0]!.subscriptionSetSha256,
          selectedSourceOriginSetSha256:
            checkpointRegistryQuorum.candidates[0]!.sourceOriginSetSha256,
          selectedSignerSetSha256:
            checkpointRegistryQuorum.candidates[0]!.signerSetSha256,
          envelope: expect.objectContaining({
            receiptKind:
              "receipt_trust_anchor_directory_quorum_activation_selection_checkpoint_registry_quorum",
            receipt: expect.objectContaining({
              status: "agreed",
              selectedCheckpointSha256: selectionCheckpoint.contentSha256,
              selectedSelectionSetSha256:
                selectionCheckpoint.selectionSetSha256,
              selectedSelectionChainTailSha256:
                selectionCheckpoint.selectionChainTailSha256,
              candidateCount: 1,
              agreementCount: 2,
            }),
            signature: expect.objectContaining({
              keyId: signingAnchor.keyId,
            }),
          }),
        }),
      }),
    );
    expect(
      checkpointRegistryQuorumBaselineResponse.headers.get(
        "x-napier-receipt-trust-directory-quorum-activation-selection-checkpoint-registry-quorum-baseline-created",
      ),
    ).toBe("true");
    const checkpointRegistryQuorumBaselineVerifyResponse = await app.request(
      "/api/receipt-trust/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          envelope: checkpointRegistryQuorumBaselineResult.baseline.envelope,
        }),
      },
    );
    expect(checkpointRegistryQuorumBaselineVerifyResponse.status).toBe(200);
    expect(
      (await checkpointRegistryQuorumBaselineVerifyResponse.json()) as TrustedReceiptVerification,
    ).toEqual(
      expect.objectContaining({
        status: "trusted",
        receiptKind:
          "receipt_trust_anchor_directory_quorum_activation_selection_checkpoint_registry_quorum",
        envelopeSha256:
          checkpointRegistryQuorumBaselineResult.baseline.envelope
            .contentSha256,
        keyId: signingAnchor.keyId,
        signatureValid: true,
        integrityValid: true,
      }),
    );
    const checkpointRegistryQuorumBaselineNoStoreVerifyResponse =
      await app.request(`${checkpointRegistryQuorumBaselinePath}/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baseline: checkpointRegistryQuorumBaselineResult.baseline,
          trustDirectory: hostedDirectory,
          trustDirectoryPolicy: {
            expectedAnchorSetSha256: hostedDirectory.anchorSetSha256,
            minimumTrustedCount: 1,
          },
        }),
      });
    expect(checkpointRegistryQuorumBaselineNoStoreVerifyResponse.status).toBe(
      200,
    );
    const checkpointRegistryQuorumBaselineVerification =
      (await checkpointRegistryQuorumBaselineNoStoreVerifyResponse.json()) as ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineVerification;
    expect(checkpointRegistryQuorumBaselineVerification).toEqual(
      expect.objectContaining({
        kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-transparency-checkpoint-registry-quorum-baseline-verification",
        status: "trusted",
        diagnostics: [],
        baselineValid: true,
        signatureValid: true,
        integrityValid: true,
        baselineSha256:
          checkpointRegistryQuorumBaselineResult.baseline.contentSha256,
        envelopeSha256:
          checkpointRegistryQuorumBaselineResult.baseline.envelope
            .contentSha256,
        quorumSha256:
          checkpointRegistryQuorumBaselineResult.baseline.envelope.receipt
            .contentSha256,
        receiptArtifactSha256:
          checkpointRegistryQuorumBaselineResult.baseline.envelope.signature
            .receiptArtifactSha256,
        keyId: signingAnchor.keyId,
        selectedCheckpointSha256: selectionCheckpoint.contentSha256,
        selectedSelectionSetSha256: selectionCheckpoint.selectionSetSha256,
        selectedSelectionChainTailSha256:
          selectionCheckpoint.selectionChainTailSha256,
        selectedSubscriptionSetSha256:
          checkpointRegistryQuorumBaselineResult.baseline
            .selectedSubscriptionSetSha256,
        selectedSourceOriginSetSha256:
          checkpointRegistryQuorumBaselineResult.baseline
            .selectedSourceOriginSetSha256,
        selectedSignerSetSha256:
          checkpointRegistryQuorumBaselineResult.baseline.selectedSignerSetSha256,
        anchorDirectorySha256: hostedDirectory.contentSha256,
        anchorDirectoryVerificationSha256:
          expect.stringMatching(/^[a-f0-9]{64}$/),
        anchorDirectoryPolicySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(
      checkpointRegistryQuorumBaselineNoStoreVerifyResponse.headers.get(
        "x-napier-verification-status",
      ),
    ).toBe("trusted");
    expect(
      checkpointRegistryQuorumBaselineNoStoreVerifyResponse.headers.get(
        "x-napier-receipt-trust-directory-quorum-activation-selection-checkpoint-registry-quorum-baseline-sha256",
      ),
    ).toBe(checkpointRegistryQuorumBaselineResult.baseline.contentSha256);
    const alreadyActiveRotationProposalResponse = await app.request(
      rotationProposalPath,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          activationDecisionRecordId: activationRecord.id,
          expectedCurrentSelectionSha256:
            appliedActivationSelection.selection.contentSha256,
          checkpointRegistryQuorumBaselineId:
            checkpointRegistryQuorumBaselineResult.baseline.id,
          expectedCheckpointRegistryQuorumBaselineSha256:
            checkpointRegistryQuorumBaselineResult.baseline.contentSha256,
          checkpointRegistryQuorumPolicy: {
            expectedCheckpointSha256: selectionCheckpoint.contentSha256,
            minimumSources: 2,
            minimumAgreementCount: 2,
            minimumDistinctSourceOrigins: 2,
          },
        }),
      },
    );
    expect(alreadyActiveRotationProposalResponse.status).toBe(200);
    expect(
      (await alreadyActiveRotationProposalResponse.json()) as ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal,
    ).toEqual(
      expect.objectContaining({
        status: "already_active",
        diagnostics: expect.arrayContaining([
          "selection_already_active",
          "rotation_review_already_active",
        ]),
        checkpointRegistryQuorumBaselineSha256:
          checkpointRegistryQuorumBaselineResult.baseline.contentSha256,
        currentCheckpointSha256: selectionCheckpoint.contentSha256,
        currentSelectionSetSha256: selectionCheckpoint.selectionSetSha256,
        currentSelectionChainTailSha256:
          selectionCheckpoint.selectionChainTailSha256,
      }),
    );
    const secondActivationResponse = await app.request(
      "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-decision",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: thread.id,
          trustAnchorId: signingAnchor.id,
          baselineId: baselineResult.baseline.id,
          importPolicy: activationPolicy,
        }),
      },
    );
    expect(secondActivationResponse.status).toBe(201);
    const secondActivationRecordId = secondActivationResponse.headers.get(
      "x-napier-receipt-trust-directory-quorum-activation-decision-record-id",
    );
    const secondActivationRecordSha256 = secondActivationResponse.headers.get(
      "x-napier-receipt-trust-directory-quorum-activation-decision-record-sha256",
    );
    expect(secondActivationRecordId).toMatch(/^trustqad_[a-z0-9]{8,80}$/);
    expect(secondActivationRecordSha256).toMatch(/^[a-f0-9]{64}$/);
    const proposedRotationResponse = await app.request(rotationProposalPath, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        activationDecisionRecordId: secondActivationRecordId,
        expectedCurrentSelectionSha256:
          appliedActivationSelection.selection.contentSha256,
        checkpointRegistryQuorumBaselineId:
          checkpointRegistryQuorumBaselineResult.baseline.id,
        expectedCheckpointRegistryQuorumBaselineSha256:
          checkpointRegistryQuorumBaselineResult.baseline.contentSha256,
        checkpointRegistryQuorumPolicy: {
          expectedCheckpointSha256: selectionCheckpoint.contentSha256,
          minimumSources: 2,
          minimumAgreementCount: 2,
          minimumDistinctSourceOrigins: 2,
        },
      }),
    });
    expect(proposedRotationResponse.status).toBe(200);
    const proposedRotation =
      (await proposedRotationResponse.json()) as ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal;
    expect(proposedRotation).toEqual(
      expect.objectContaining({
        status: "proposed",
        diagnostics: [],
        activationDecisionRecordId: secondActivationRecordId,
        activationDecisionRecordSha256: secondActivationRecordSha256,
        expectedCurrentSelectionSha256:
          appliedActivationSelection.selection.contentSha256,
        currentSelectionSha256:
          appliedActivationSelection.selection.contentSha256,
        rotationReview: expect.objectContaining({
          status: "eligible",
          activationDecisionRecordId: secondActivationRecordId,
          checkpointRegistryQuorum: expect.objectContaining({
            status: "agreed",
            selectedCheckpointSha256: selectionCheckpoint.contentSha256,
          }),
        }),
        checkpointRegistryQuorumBaseline:
          checkpointRegistryQuorumBaselineResult.baseline,
        checkpointRegistryQuorumBaselineSha256:
          checkpointRegistryQuorumBaselineResult.baseline.contentSha256,
        checkpointRegistryQuorumSha256:
          checkpointRegistryQuorumBaselineResult.baseline.envelope.receipt
            .contentSha256,
        selectedCheckpointSha256: selectionCheckpoint.contentSha256,
        selectedSelectionSetSha256: selectionCheckpoint.selectionSetSha256,
        selectedSelectionChainTailSha256:
          selectionCheckpoint.selectionChainTailSha256,
        currentCheckpointSha256: selectionCheckpoint.contentSha256,
        currentSelectionSetSha256: selectionCheckpoint.selectionSetSha256,
        currentSelectionChainTailSha256:
          selectionCheckpoint.selectionChainTailSha256,
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(
      proposedRotationResponse.headers.get(
        "x-napier-receipt-trust-directory-quorum-activation-selection-rotation-proposal-status",
      ),
    ).toBe("proposed");
    expect(
      proposedRotationResponse.headers.get(
        "x-napier-receipt-trust-directory-quorum-activation-selection-checkpoint-registry-quorum-baseline-sha256",
      ),
    ).toBe(checkpointRegistryQuorumBaselineResult.baseline.contentSha256);
    const signedRotationProposalResponse = await app.request(
      `${rotationProposalPath}/sign`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: thread.id,
          trustAnchorId: signingAnchor.id,
          activationDecisionRecordId: secondActivationRecordId,
          expectedCurrentSelectionSha256:
            appliedActivationSelection.selection.contentSha256,
          checkpointRegistryQuorumBaselineId:
            checkpointRegistryQuorumBaselineResult.baseline.id,
          expectedCheckpointRegistryQuorumBaselineSha256:
            checkpointRegistryQuorumBaselineResult.baseline.contentSha256,
          checkpointRegistryQuorumPolicy: {
            expectedCheckpointSha256: selectionCheckpoint.contentSha256,
            minimumSources: 2,
            minimumAgreementCount: 2,
            minimumDistinctSourceOrigins: 2,
          },
        }),
      },
    );
    expect(signedRotationProposalResponse.status).toBe(201);
    const signedRotationProposal =
      (await signedRotationProposalResponse.json()) as TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal>;
    expect(signedRotationProposal).toEqual(
      expect.objectContaining({
        receiptKind:
          "receipt_trust_anchor_directory_quorum_activation_selection_rotation_proposal",
        receipt: expect.objectContaining({
          status: "proposed",
          activationDecisionRecordId: secondActivationRecordId,
          checkpointRegistryQuorumBaselineSha256:
            checkpointRegistryQuorumBaselineResult.baseline.contentSha256,
          currentCheckpointSha256: selectionCheckpoint.contentSha256,
        }),
        signature: expect.objectContaining({
          keyId: signingAnchor.keyId,
        }),
      }),
    );
    const signedRotationProposalVerifyResponse = await app.request(
      "/api/receipt-trust/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ envelope: signedRotationProposal }),
      },
    );
    expect(signedRotationProposalVerifyResponse.status).toBe(200);
    expect(
      (await signedRotationProposalVerifyResponse.json()) as TrustedReceiptVerification,
    ).toEqual(
      expect.objectContaining({
        status: "trusted",
        receiptKind:
          "receipt_trust_anchor_directory_quorum_activation_selection_rotation_proposal",
        envelopeSha256: signedRotationProposal.contentSha256,
        anchorDirectorySource: "active_selection",
        keyId: signingAnchor.keyId,
        signatureValid: true,
        integrityValid: true,
      }),
    );
    const signedRotationProposalPreflightResponse = await app.request(
      `${rotationProposalPath}/preflight`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: thread.id,
          activationDecisionRecordId: secondActivationRecordId,
          expectedCurrentSelectionSha256:
            appliedActivationSelection.selection.contentSha256,
          rotationProposalEnvelope: signedRotationProposal,
        }),
      },
    );
    expect(signedRotationProposalPreflightResponse.status).toBe(200);
    expect(
      (await signedRotationProposalPreflightResponse.json()) as ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalPreflight,
    ).toEqual(
      expect.objectContaining({
        status: "accepted",
        diagnostics: [],
        activationDecisionRecordId: secondActivationRecordId,
        currentSelectionSha256:
          appliedActivationSelection.selection.contentSha256,
        activeSelectionSha256:
          appliedActivationSelection.selection.contentSha256,
        rotationProposalEnvelopeSha256: signedRotationProposal.contentSha256,
        rotationProposalSha256: signedRotationProposal.receipt.contentSha256,
        rotationProposalReviewSha256:
          signedRotationProposal.receipt.rotationReviewSha256,
        trustedReceiptVerificationStatus: "trusted",
        trustedReceiptVerificationEnvelopeSha256:
          signedRotationProposal.contentSha256,
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    const staleCheckpointBaselineProposalResponse = await app.request(
      rotationProposalPath,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          activationDecisionRecordId: secondActivationRecordId,
          expectedCurrentSelectionSha256:
            appliedActivationSelection.selection.contentSha256,
          checkpointRegistryQuorumBaselineId:
            checkpointRegistryQuorumBaselineResult.baseline.id,
          expectedCheckpointRegistryQuorumBaselineSha256: "0".repeat(64),
        }),
      },
    );
    expect(staleCheckpointBaselineProposalResponse.status).toBe(200);
    expect(
      (await staleCheckpointBaselineProposalResponse.json()) as ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal,
    ).toEqual(
      expect.objectContaining({
        status: "blocked",
        diagnostics: [
          "checkpoint_registry_quorum_baseline_precondition_failed",
        ],
        expectedCheckpointRegistryQuorumBaselineSha256: "0".repeat(64),
        checkpointRegistryQuorumBaselineSha256:
          checkpointRegistryQuorumBaselineResult.baseline.contentSha256,
      }),
    );
    const checkpointRegistryQuorumImportRoot = await mkdtemp(
      path.join(
        tmpdir(),
        "napier-checkpoint-registry-quorum-baseline-import-http-",
      ),
    );
    temporaryRoots.push(checkpointRegistryQuorumImportRoot);
    const checkpointRegistryQuorumImportServices =
      await createNapierServices({
        dataRoot: path.join(checkpointRegistryQuorumImportRoot, "data"),
        workspaceRoot: path.join(
          checkpointRegistryQuorumImportRoot,
          "workspace",
        ),
      });
    openServices.push(checkpointRegistryQuorumImportServices);
    const checkpointRegistryQuorumImportApp = createApp(
      checkpointRegistryQuorumImportServices,
    );
    const checkpointRegistryQuorumImportThread =
      checkpointRegistryQuorumImportServices.store.listThreads()[0]!;
    const checkpointRegistryQuorumBaselineImportRequest = {
      baseline: checkpointRegistryQuorumBaselineResult.baseline,
      threadId: checkpointRegistryQuorumImportThread.id,
      expectedCurrentBaselineSha256: "",
      trustDirectory: hostedDirectory,
      trustDirectoryPolicy: {
        expectedAnchorSetSha256: hostedDirectory.anchorSetSha256,
        minimumTrustedCount: 1,
      },
    };
    const checkpointRegistryQuorumBaselineImportResponse =
      await checkpointRegistryQuorumImportApp.request(
        `${checkpointRegistryQuorumBaselinePath}/import`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(checkpointRegistryQuorumBaselineImportRequest),
        },
      );
    expect(checkpointRegistryQuorumBaselineImportResponse.status).toBe(201);
    const checkpointRegistryQuorumBaselineImport =
      (await checkpointRegistryQuorumBaselineImportResponse.json()) as ImportReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineResult;
    expect(checkpointRegistryQuorumBaselineImport).toEqual(
      expect.objectContaining({
        imported: true,
        expectedCurrentBaselineSha256: "",
        verification: expect.objectContaining({
          status: "trusted",
          baselineSha256:
            checkpointRegistryQuorumBaselineResult.baseline.contentSha256,
        }),
        baseline: expect.objectContaining({
          promotedByThreadId: checkpointRegistryQuorumImportThread.id,
          envelope: checkpointRegistryQuorumBaselineResult.baseline.envelope,
          selectedCheckpointSha256: selectionCheckpoint.contentSha256,
          selectedSelectionSetSha256: selectionCheckpoint.selectionSetSha256,
          selectedSelectionChainTailSha256:
            selectionCheckpoint.selectionChainTailSha256,
          selectedSubscriptionSetSha256:
            checkpointRegistryQuorumBaselineResult.baseline
              .selectedSubscriptionSetSha256,
          selectedSourceOriginSetSha256:
            checkpointRegistryQuorumBaselineResult.baseline
              .selectedSourceOriginSetSha256,
          selectedSignerSetSha256:
            checkpointRegistryQuorumBaselineResult.baseline
              .selectedSignerSetSha256,
        }),
      }),
    );
    expect(checkpointRegistryQuorumBaselineImport.baseline.id).not.toBe(
      checkpointRegistryQuorumBaselineResult.baseline.id,
    );
    expect(
      checkpointRegistryQuorumBaselineImportResponse.headers.get(
        "x-napier-receipt-trust-directory-quorum-activation-selection-checkpoint-registry-quorum-baseline-imported",
      ),
    ).toBe("true");
    expect(
      checkpointRegistryQuorumBaselineImportResponse.headers.get(
        "x-napier-receipt-trust-directory-quorum-activation-selection-checkpoint-registry-quorum-baseline-verification-sha256",
      ),
    ).toBe(checkpointRegistryQuorumBaselineImport.verification.contentSha256);
    const staleCheckpointRegistryQuorumBaselineImportResponse =
      await checkpointRegistryQuorumImportApp.request(
        `${checkpointRegistryQuorumBaselinePath}/import`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(checkpointRegistryQuorumBaselineImportRequest),
        },
      );
    expect(staleCheckpointRegistryQuorumBaselineImportResponse.status).toBe(
      409,
    );
    expect(
      await staleCheckpointRegistryQuorumBaselineImportResponse.json(),
    ).toEqual(
      expect.objectContaining({
        error: expect.stringContaining("precondition failed"),
      }),
    );
    const duplicateCheckpointRegistryQuorumBaselineImportResponse =
      await checkpointRegistryQuorumImportApp.request(
        `${checkpointRegistryQuorumBaselinePath}/import`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...checkpointRegistryQuorumBaselineImportRequest,
            expectedCurrentBaselineSha256:
              checkpointRegistryQuorumBaselineImport.baseline.contentSha256,
          }),
        },
      );
    expect(duplicateCheckpointRegistryQuorumBaselineImportResponse.status).toBe(
      200,
    );
    expect(
      (await duplicateCheckpointRegistryQuorumBaselineImportResponse.json()) as ImportReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineResult,
    ).toEqual(
      expect.objectContaining({
        imported: false,
        expectedCurrentBaselineSha256:
          checkpointRegistryQuorumBaselineImport.baseline.contentSha256,
        previousBaselineSha256:
          checkpointRegistryQuorumBaselineImport.baseline.contentSha256,
        baseline: checkpointRegistryQuorumBaselineImport.baseline,
      }),
    );
    const checkpointRegistryQuorumImportEvents =
      await checkpointRegistryQuorumImportServices.store.listEvents(
        checkpointRegistryQuorumImportThread.id,
      );
    expect(
      checkpointRegistryQuorumImportEvents.find(
        (event) =>
          event.type ===
          "receipt_trust.checkpoint_registry_quorum_baseline.imported",
      ),
    ).toEqual(
      expect.objectContaining({
        payload: expect.objectContaining({
          baselineId: checkpointRegistryQuorumBaselineImport.baseline.id,
          baselineSha256:
            checkpointRegistryQuorumBaselineImport.baseline.contentSha256,
          expectedCurrentBaselineSha256: "",
          verificationSha256:
            checkpointRegistryQuorumBaselineImport.verification.contentSha256,
          envelopeSha256:
            checkpointRegistryQuorumBaselineImport.baseline.envelope
              .contentSha256,
          selectedCheckpointSha256: selectionCheckpoint.contentSha256,
          selectedSelectionSetSha256: selectionCheckpoint.selectionSetSha256,
          selectedSelectionChainTailSha256:
            selectionCheckpoint.selectionChainTailSha256,
          selectedSubscriptionSetSha256:
            checkpointRegistryQuorumBaselineImport.baseline
              .selectedSubscriptionSetSha256,
          selectedSourceOriginSetSha256:
            checkpointRegistryQuorumBaselineImport.baseline
              .selectedSourceOriginSetSha256,
          selectedSignerSetSha256:
            checkpointRegistryQuorumBaselineImport.baseline
              .selectedSignerSetSha256,
        }),
      }),
    );
    expect(JSON.stringify(checkpointRegistryQuorumImportEvents)).not.toContain(
      checkpointSourceUrl,
    );
    expect(JSON.stringify(checkpointRegistryQuorumImportEvents)).not.toContain(
      checkpointMirrorSourceUrl,
    );
    const duplicateCheckpointRegistryQuorumBaselineResponse = await app.request(
      checkpointRegistryQuorumBaselinePath,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(checkpointRegistryQuorumBaselineRequest),
      },
    );
    expect(duplicateCheckpointRegistryQuorumBaselineResponse.status).toBe(200);
    expect(
      (await duplicateCheckpointRegistryQuorumBaselineResponse.json()) as PromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineResult,
    ).toEqual(
      expect.objectContaining({
        created: false,
        baseline: checkpointRegistryQuorumBaselineResult.baseline,
      }),
    );
    const highSelectionCountCheckpointRegistryQuorumResponse =
      await app.request(`${selectionCheckpointSubscriptionPath}/quorum`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          policy: {
            minimumSources: 1,
            minimumAgreementCount: 1,
            minimumDistinctSourceOrigins: 1,
            minimumSelectionCount: 1_000,
          },
        }),
      });
    expect(highSelectionCountCheckpointRegistryQuorumResponse.status).toBe(200);
    expect(
      (await highSelectionCountCheckpointRegistryQuorumResponse.json()) as ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum,
    ).toEqual(
      expect.objectContaining({
        status: "policy_failed",
        diagnostics: ["selection_count_below_minimum"],
      }),
    );
    const unchangedCheckpointSubscriptionRefreshResponse = await app.request(
      `${selectionCheckpointSubscriptionPath}/${checkpointSubscription.id}/refresh`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: thread.id,
          expectedRevision: checkpointSubscription.revision,
        }),
      },
    );
    expect(unchangedCheckpointSubscriptionRefreshResponse.status).toBe(200);
    const unchangedCheckpointSubscriptionRefresh =
      (await unchangedCheckpointSubscriptionRefreshResponse.json()) as ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRefreshResult;
    expect(unchangedCheckpointSubscriptionRefresh).toEqual(
      expect.objectContaining({
        status: "unchanged",
        subscription: expect.objectContaining({
          revision: 2,
          lastRefreshStatus: "unchanged",
          lastGoodDiscovery: expect.objectContaining({
            envelopeSha256: signedSelectionCheckpoint.contentSha256,
            checkpointSha256: selectionCheckpoint.contentSha256,
            selectionCount: 1,
          }),
          transparencyEntryCount: 2,
        }),
        discovery: expect.objectContaining({
          contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          checkpointSha256: selectionCheckpoint.contentSha256,
        }),
      }),
    );
    hostedCheckpointEnvelope = signTrustedReceipt(
      emptySelectionCheckpoint,
      signingAnchor,
    );
    const rejectedCheckpointSubscriptionRefreshResponse = await app.request(
      `${selectionCheckpointSubscriptionPath}/${checkpointSubscription.id}/refresh`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: thread.id,
          expectedRevision:
            unchangedCheckpointSubscriptionRefresh.subscription.revision,
        }),
      },
    );
    expect(rejectedCheckpointSubscriptionRefreshResponse.status).toBe(200);
    const rejectedCheckpointSubscriptionRefresh =
      (await rejectedCheckpointSubscriptionRefreshResponse.json()) as ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRefreshResult;
    expect(rejectedCheckpointSubscriptionRefresh).toEqual(
      expect.objectContaining({
        status: "rejected",
        subscription: expect.objectContaining({
          revision: 3,
          lastRefreshStatus: "rejected",
          lastGoodDiscovery: expect.objectContaining({
            envelopeSha256: signedSelectionCheckpoint.contentSha256,
            checkpointSha256: selectionCheckpoint.contentSha256,
            selectionCount: 1,
          }),
        }),
        discovery: expect.objectContaining({
          status: "invalid",
          diagnostics: expect.arrayContaining([
            "checkpoint_divergent",
            "checkpoint_hash_mismatch",
            "selection_count_below_minimum",
            "selection_count_rollback",
          ]),
        }),
      }),
    );
    hostedCheckpointEnvelope = undefined;
    const failedCheckpointSubscriptionRefreshResponse = await app.request(
      `${selectionCheckpointSubscriptionPath}/${checkpointSubscription.id}/refresh`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: thread.id,
          expectedRevision:
            rejectedCheckpointSubscriptionRefresh.subscription.revision,
        }),
      },
    );
    expect(failedCheckpointSubscriptionRefreshResponse.status).toBe(200);
    const failedCheckpointSubscriptionRefresh =
      (await failedCheckpointSubscriptionRefreshResponse.json()) as ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRefreshResult;
    expect(failedCheckpointSubscriptionRefresh).toEqual(
      expect.objectContaining({
        status: "failed",
        failureSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        subscription: expect.objectContaining({
          revision: 4,
          lastRefreshStatus: "failed",
          lastGoodDiscovery:
            rejectedCheckpointSubscriptionRefresh.subscription.lastGoodDiscovery,
        }),
      }),
    );
    const pauseCheckpointSubscriptionResponse = await app.request(
      `${selectionCheckpointSubscriptionPath}/${checkpointSubscription.id}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: thread.id,
          expectedRevision:
            failedCheckpointSubscriptionRefresh.subscription.revision,
          status: "paused",
        }),
      },
    );
    expect(pauseCheckpointSubscriptionResponse.status).toBe(200);
    const pausedCheckpointSubscription =
      (await pauseCheckpointSubscriptionResponse.json()) as ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription;
    expect(pausedCheckpointSubscription).toEqual(
      expect.objectContaining({
        status: "paused",
        revision: 5,
      }),
    );
    const pauseMirrorCheckpointSubscriptionResponse = await app.request(
      `${selectionCheckpointSubscriptionPath}/${mirrorCheckpointSubscription.id}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: thread.id,
          expectedRevision: mirrorCheckpointSubscription.revision,
          status: "paused",
        }),
      },
    );
    expect(pauseMirrorCheckpointSubscriptionResponse.status).toBe(200);
    const pausedMirrorCheckpointSubscription =
      (await pauseMirrorCheckpointSubscriptionResponse.json()) as ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription;
    expect(pausedMirrorCheckpointSubscription).toEqual(
      expect.objectContaining({
        status: "paused",
        revision: 2,
      }),
    );
    hostedCheckpointEnvelope = signedSelectionCheckpoint;
    const divergentSelectionCheckpointResponse = await app.request(
      "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ checkpoint: emptySelectionCheckpoint }),
      },
    );
    expect(divergentSelectionCheckpointResponse.status).toBe(200);
    expect(
      (await divergentSelectionCheckpointResponse.json()) as ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointVerification,
    ).toEqual(
      expect.objectContaining({
        status: "divergent",
        diagnostics: expect.arrayContaining([
          "current_checkpoint_mismatch",
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
    const invalidSelectionCheckpointResponse = await app.request(
      "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ checkpoint: tamperedSelectionCheckpoint }),
      },
    );
    expect(invalidSelectionCheckpointResponse.status).toBe(200);
    expect(
      (await invalidSelectionCheckpointResponse.json()) as ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointVerification,
    ).toEqual(
      expect.objectContaining({
        status: "invalid",
        diagnostics: ["checkpoint_invalid"],
        currentSelectionCount: 1,
      }),
    );
    const alreadyActiveRotationReviewResponse = await app.request(
      "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-review",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          activationDecisionRecordId: activationRecord.id,
          expectedCurrentSelectionSha256:
            appliedActivationSelection.selection.contentSha256,
        }),
      },
    );
    expect(alreadyActiveRotationReviewResponse.status).toBe(200);
    const alreadyActiveRotationReview =
      (await alreadyActiveRotationReviewResponse.json()) as ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationReview;
    expect(alreadyActiveRotationReview).toEqual(
      expect.objectContaining({
        status: "already_active",
        diagnostics: ["selection_already_active"],
        currentSelectionSha256:
          appliedActivationSelection.selection.contentSha256,
        driftAudit: expect.objectContaining({
          status: "aligned",
        }),
      }),
    );
    const staleRotationReviewResponse = await app.request(
      "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-review",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          activationDecisionRecordId: activationRecord.id,
          expectedCurrentSelectionSha256: "",
        }),
      },
    );
    expect(staleRotationReviewResponse.status).toBe(200);
    expect(
      (await staleRotationReviewResponse.json()) as ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationReview,
    ).toEqual(
      expect.objectContaining({
        status: "stale_selection",
        diagnostics: expect.arrayContaining([
          "selection_precondition_failed",
          "selection_already_active",
        ]),
      }),
    );
    const missingDecisionRotationReviewResponse = await app.request(
      "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-review",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          activationDecisionRecordId: "trustqad_missing1234567890",
          expectedCurrentSelectionSha256:
            appliedActivationSelection.selection.contentSha256,
        }),
      },
    );
    expect(missingDecisionRotationReviewResponse.status).toBe(200);
    expect(
      (await missingDecisionRotationReviewResponse.json()) as ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationReview,
    ).toEqual(
      expect.objectContaining({
        status: "missing_decision",
        diagnostics: ["activation_decision_missing"],
      }),
    );
    const duplicateActivationSelectionResponse = await app.request(
      "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/apply",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: thread.id,
          activationDecisionRecordId: activationRecord.id,
          expectedCurrentSelectionSha256:
            appliedActivationSelection.selection.contentSha256,
        }),
      },
    );
    expect(duplicateActivationSelectionResponse.status).toBe(200);
    expect(
      (await duplicateActivationSelectionResponse.json()) as ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionResult,
    ).toEqual(
      expect.objectContaining({
        applied: false,
        selection: appliedActivationSelection.selection,
      }),
    );
    const staleActivationSelectionResponse = await app.request(
      "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/apply",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: thread.id,
          activationDecisionRecordId: activationRecord.id,
          expectedCurrentSelectionSha256: "",
        }),
      },
    );
    expect(staleActivationSelectionResponse.status).toBe(409);
    const activeSelectionVerifyResponse = await app.request(
      "/api/receipt-trust/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ envelope: activation.envelope }),
      },
    );
    expect(activeSelectionVerifyResponse.status).toBe(200);
    const activeSelectionVerification =
      (await activeSelectionVerifyResponse.json()) as TrustedReceiptVerification;
    expect(activeSelectionVerification).toEqual(
      expect.objectContaining({
        status: "trusted",
        anchorDirectorySource: "active_selection",
        anchorDirectorySha256: hostedDirectory.contentSha256,
        anchorDirectoryVerificationSha256:
          expect.stringMatching(/^[a-f0-9]{64}$/),
        anchorDirectoryPolicySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        anchorDirectorySelectionId: appliedActivationSelection.selection.id,
        anchorDirectorySelectionSha256:
          appliedActivationSelection.selection.contentSha256,
        anchorDirectorySelectionStateSha256:
          appliedActivationSelection.selectionState.contentSha256,
        keyId: signingAnchor.keyId,
        envelopeSha256: activation.envelope.contentSha256,
        signatureValid: true,
        integrityValid: true,
      }),
    );
    expect(
      activeSelectionVerifyResponse.headers.get(
        "x-napier-receipt-trust-anchor-directory-source",
      ),
    ).toBe("active_selection");
    expect(
      activeSelectionVerifyResponse.headers.get(
        "x-napier-receipt-trust-directory-quorum-activation-selection-sha256",
      ),
    ).toBe(appliedActivationSelection.selection.contentSha256);
    const unsignedRotationApplyResponse = await app.request(
      "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/apply",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: thread.id,
          activationDecisionRecordId: secondActivationRecordId,
          expectedCurrentSelectionSha256:
            appliedActivationSelection.selection.contentSha256,
        }),
      },
    );
    expect(unsignedRotationApplyResponse.status).toBe(409);
    expect(await unsignedRotationApplyResponse.json()).toEqual(
      expect.objectContaining({
        error: expect.stringContaining("signed fresh rotation proposal"),
      }),
    );
    const staleSignedRotationPreflightResponse = await app.request(
      `${rotationProposalPath}/preflight`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: thread.id,
          activationDecisionRecordId: secondActivationRecordId,
          expectedCurrentSelectionSha256:
            appliedActivationSelection.selection.contentSha256,
          rotationProposalEnvelope: signedRotationProposal,
        }),
      },
    );
    expect(staleSignedRotationPreflightResponse.status).toBe(200);
    expect(
      (await staleSignedRotationPreflightResponse.json()) as ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalPreflight,
    ).toEqual(
      expect.objectContaining({
        status: "rejected",
        diagnostics: expect.arrayContaining([
          "checkpoint_registry_quorum_not_agreed",
          "rotation_review_blocked",
        ]),
        reason: expect.stringContaining("rotation proposal is stale"),
        rotationProposalEnvelopeSha256: signedRotationProposal.contentSha256,
        trustedReceiptVerificationStatus: "trusted",
      }),
    );
    const staleSignedRotationApplyResponse = await app.request(
      "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/apply",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: thread.id,
          activationDecisionRecordId: secondActivationRecordId,
          expectedCurrentSelectionSha256:
            appliedActivationSelection.selection.contentSha256,
          rotationProposalEnvelope: signedRotationProposal,
        }),
      },
    );
    expect(staleSignedRotationApplyResponse.status).toBe(409);
    expect(await staleSignedRotationApplyResponse.json()).toEqual(
      expect.objectContaining({
        error: expect.stringContaining("checkpoint_registry_quorum_not_agreed"),
      }),
    );
    const resumeCheckpointSubscriptionResponse = await app.request(
      `${selectionCheckpointSubscriptionPath}/${checkpointSubscription.id}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: thread.id,
          expectedRevision: pausedCheckpointSubscription.revision,
          status: "active",
        }),
      },
    );
    expect(resumeCheckpointSubscriptionResponse.status).toBe(200);
    const resumedCheckpointSubscription =
      (await resumeCheckpointSubscriptionResponse.json()) as ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription;
    expect(resumedCheckpointSubscription).toEqual(
      expect.objectContaining({
        status: "active",
        revision: 6,
      }),
    );
    const resumeMirrorCheckpointSubscriptionResponse = await app.request(
      `${selectionCheckpointSubscriptionPath}/${mirrorCheckpointSubscription.id}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: thread.id,
          expectedRevision: pausedMirrorCheckpointSubscription.revision,
          status: "active",
        }),
      },
    );
    expect(resumeMirrorCheckpointSubscriptionResponse.status).toBe(200);
    const resumedMirrorCheckpointSubscription =
      (await resumeMirrorCheckpointSubscriptionResponse.json()) as ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription;
    expect(resumedMirrorCheckpointSubscription).toEqual(
      expect.objectContaining({
        status: "active",
        revision: 3,
      }),
    );
    const freshSignedRotationProposalResponse = await app.request(
      `${rotationProposalPath}/sign`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: thread.id,
          trustAnchorId: signingAnchor.id,
          activationDecisionRecordId: secondActivationRecordId,
          expectedCurrentSelectionSha256:
            appliedActivationSelection.selection.contentSha256,
          checkpointRegistryQuorumBaselineId:
            checkpointRegistryQuorumBaselineResult.baseline.id,
          expectedCheckpointRegistryQuorumBaselineSha256:
            checkpointRegistryQuorumBaselineResult.baseline.contentSha256,
          checkpointRegistryQuorumPolicy: {
            expectedCheckpointSha256: selectionCheckpoint.contentSha256,
            minimumSources: 2,
            minimumAgreementCount: 2,
            minimumDistinctSourceOrigins: 2,
          },
        }),
      },
    );
    expect(freshSignedRotationProposalResponse.status).toBe(201);
    const freshSignedRotationProposal =
      (await freshSignedRotationProposalResponse.json()) as TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal>;
    expect(freshSignedRotationProposal).toEqual(
      expect.objectContaining({
        receiptKind:
          "receipt_trust_anchor_directory_quorum_activation_selection_rotation_proposal",
        receipt: expect.objectContaining({
          status: "proposed",
          activationDecisionRecordId: secondActivationRecordId,
        }),
      }),
    );
    const freshSignedRotationPreflightResponse = await app.request(
      `${rotationProposalPath}/preflight`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: thread.id,
          activationDecisionRecordId: secondActivationRecordId,
          expectedCurrentSelectionSha256:
            appliedActivationSelection.selection.contentSha256,
          rotationProposalEnvelope: freshSignedRotationProposal,
        }),
      },
    );
    expect(freshSignedRotationPreflightResponse.status).toBe(200);
    expect(
      (await freshSignedRotationPreflightResponse.json()) as ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalPreflight,
    ).toEqual(
      expect.objectContaining({
        status: "accepted",
        diagnostics: [],
        rotationProposalEnvelopeSha256:
          freshSignedRotationProposal.contentSha256,
        rotationProposalSha256:
          freshSignedRotationProposal.receipt.contentSha256,
        trustedReceiptVerificationStatus: "trusted",
      }),
    );
    const signedRotationApplyResponse = await app.request(
      "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/apply",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: thread.id,
          activationDecisionRecordId: secondActivationRecordId,
          expectedCurrentSelectionSha256:
            appliedActivationSelection.selection.contentSha256,
          rotationProposalEnvelope: freshSignedRotationProposal,
        }),
      },
    );
    expect(signedRotationApplyResponse.status).toBe(201);
    const signedRotationApply =
      (await signedRotationApplyResponse.json()) as ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionResult;
    expect(signedRotationApply).toEqual(
      expect.objectContaining({
        applied: true,
        expectedCurrentSelectionSha256:
          appliedActivationSelection.selection.contentSha256,
        previousSelectionSha256:
          appliedActivationSelection.selection.contentSha256,
        selection: expect.objectContaining({
          activationDecisionRecordId: secondActivationRecordId,
          selectedDirectorySha256: hostedDirectory.contentSha256,
        }),
      }),
    );
    const pauseResumedCheckpointSubscriptionResponse = await app.request(
      `${selectionCheckpointSubscriptionPath}/${checkpointSubscription.id}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: thread.id,
          expectedRevision: resumedCheckpointSubscription.revision,
          status: "paused",
        }),
      },
    );
    expect(pauseResumedCheckpointSubscriptionResponse.status).toBe(200);
    expect(
      (await pauseResumedCheckpointSubscriptionResponse.json()) as ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription,
    ).toEqual(
      expect.objectContaining({
        status: "paused",
        revision: 7,
      }),
    );
    const pauseResumedMirrorCheckpointSubscriptionResponse = await app.request(
      `${selectionCheckpointSubscriptionPath}/${mirrorCheckpointSubscription.id}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: thread.id,
          expectedRevision: resumedMirrorCheckpointSubscription.revision,
          status: "paused",
        }),
      },
    );
    expect(pauseResumedMirrorCheckpointSubscriptionResponse.status).toBe(200);
    expect(
      (await pauseResumedMirrorCheckpointSubscriptionResponse.json()) as ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription,
    ).toEqual(
      expect.objectContaining({
        status: "paused",
        revision: 4,
      }),
    );
    const importRoot = await mkdtemp(
      path.join(tmpdir(), "napier-trust-baseline-import-http-"),
    );
    temporaryRoots.push(importRoot);
    const importServices = await createNapierServices({
      dataRoot: path.join(importRoot, "data"),
      workspaceRoot: path.join(importRoot, "workspace"),
    });
    openServices.push(importServices);
    const importApp = createApp(importServices);
    const importThread = importServices.store.listThreads()[0]!;
    const baselineImportRequest = {
      baseline: baselineResult.baseline,
      threadId: importThread.id,
      expectedCurrentBaselineSha256: "",
      importPolicy: activationPolicy,
      trustDirectory: hostedDirectory,
      trustDirectoryPolicy: {
        expectedAnchorSetSha256: hostedDirectory.anchorSetSha256,
        minimumTrustedCount: 1,
      },
    };
    const baselineImportResponse = await importApp.request(
      "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/import",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(baselineImportRequest),
      },
    );
    expect(baselineImportResponse.status).toBe(201);
    const baselineImport =
      (await baselineImportResponse.json()) as ImportReceiptTrustAnchorDirectoryQuorumPromotionBaselineResult;
    expect(baselineImport).toEqual(
      expect.objectContaining({
        imported: true,
        expectedCurrentBaselineSha256: "",
        verification: expect.objectContaining({
          status: "trusted",
          baselineSha256: baselineResult.baseline.contentSha256,
        }),
        policyReview: expect.objectContaining({
          status: "accepted",
          diagnostics: [],
          baselineSha256: baselineResult.baseline.contentSha256,
          selectedSourceOriginCount: 2,
          selectedMetadataPublisherCount: 1,
          selectedMetadataSignerCount: 1,
        }),
        baseline: expect.objectContaining({
          promotedByThreadId: importThread.id,
          envelope: baselineResult.baseline.envelope,
          selectedAnchorSetSha256: hostedDirectory.anchorSetSha256,
          selectedDirectorySha256: hostedDirectory.contentSha256,
        }),
      }),
    );
    expect(baselineImport.baseline.id).not.toBe(baselineResult.baseline.id);
    expect(
      baselineImportResponse.headers.get(
        "x-napier-receipt-trust-directory-quorum-promotion-baseline-imported",
      ),
    ).toBe("true");
    expect(
      baselineImportResponse.headers.get(
        "x-napier-receipt-trust-directory-quorum-promotion-baseline-import-policy-sha256",
      ),
    ).toBe(baselineImport.policyReview?.policySha256);
    expect(
      baselineImportResponse.headers.get(
        "x-napier-receipt-trust-directory-quorum-promotion-baseline-import-policy-review-sha256",
      ),
    ).toBe(baselineImport.policyReview?.contentSha256);
    const rejectedPolicyImportResponse = await importApp.request(
      "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/import",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...baselineImportRequest,
          expectedCurrentBaselineSha256: baselineImport.baseline.contentSha256,
          importPolicy: {
            ...baselineImportRequest.importPolicy,
            requiredSourceOriginSha256s: ["e".repeat(64)],
          },
        }),
      },
    );
    expect(rejectedPolicyImportResponse.status).toBe(409);
    expect(await rejectedPolicyImportResponse.json()).toEqual(
      expect.objectContaining({
        error: expect.stringContaining("policy rejected"),
      }),
    );
    const duplicateImportResponse = await importApp.request(
      "/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/import",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...baselineImportRequest,
          expectedCurrentBaselineSha256: baselineImport.baseline.contentSha256,
        }),
      },
    );
    expect(duplicateImportResponse.status).toBe(200);
    const duplicateImport =
      (await duplicateImportResponse.json()) as ImportReceiptTrustAnchorDirectoryQuorumPromotionBaselineResult;
    expect(duplicateImport).toEqual(
      expect.objectContaining({
        imported: false,
        expectedCurrentBaselineSha256: baselineImport.baseline.contentSha256,
        previousBaselineSha256: baselineImport.baseline.contentSha256,
        baseline: baselineImport.baseline,
      }),
    );
    expect(JSON.stringify(quorum)).not.toContain(sourceUrl);
    expect(JSON.stringify(quorum)).not.toContain(mirrorSourceUrl);

    const firstDirectory = hostedDirectory;
    const secondDirectory = createDirectory(thread.id, "Hosted verifier B");
    hostedDirectory = secondDirectory;
    const refreshResponse = await refreshSubscription(
      app,
      created.id,
      thread.id,
      created.revision,
    );
    expect(refreshResponse.status).toBe(200);
    const promoted =
      (await refreshResponse.json()) as ReceiptTrustAnchorDirectorySubscriptionRefreshResult;
    expect(promoted).toEqual(
      expect.objectContaining({
        status: "promoted",
        subscription: expect.objectContaining({
          revision: 2,
          lastRefreshStatus: "promoted",
        }),
      }),
    );
    expect(
      promoted.subscription.lastGoodDiscovery?.directory?.anchorSetSha256,
    ).toBe(secondDirectory.anchorSetSha256);
    expect(
      refreshResponse.headers.get(
        "x-napier-receipt-trust-directory-subscription-refresh-status",
      ),
    ).toBe("promoted");

    const staleResponse = await refreshSubscription(
      app,
      created.id,
      thread.id,
      created.revision,
    );
    expect(staleResponse.status).toBe(409);
    expect(fetchCount).toBe(3);

    hostedDirectory = firstDirectory;
    const rollbackResponse = await refreshSubscription(
      app,
      created.id,
      thread.id,
      promoted.subscription.revision,
    );
    expect(rollbackResponse.status).toBe(200);
    const rollback =
      (await rollbackResponse.json()) as ReceiptTrustAnchorDirectorySubscriptionRefreshResult;
    expect(rollback).toEqual(
      expect.objectContaining({
        status: "rollback_rejected",
        subscription: expect.objectContaining({
          lastRefreshStatus: "rollback_rejected",
          lastDiscoverySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          transparencyTailSha256: promoted.subscription.transparencyTailSha256,
        }),
      }),
    );
    expect(
      rollback.subscription.lastGoodDiscovery?.directory?.anchorSetSha256,
    ).toBe(secondDirectory.anchorSetSha256);
    expect(
      rollbackResponse.headers.get(
        "x-napier-receipt-trust-directory-subscription-refresh-status",
      ),
    ).toBe("rollback_rejected");

    responseMode = "invalid";
    const rejectedResponse = await refreshSubscription(
      app,
      created.id,
      thread.id,
      rollback.subscription.revision,
    );
    expect(rejectedResponse.status).toBe(200);
    const rejected =
      (await rejectedResponse.json()) as ReceiptTrustAnchorDirectorySubscriptionRefreshResult;
    expect(rejected.status).toBe("rejected");
    expect(
      rejected.subscription.lastGoodDiscovery?.directory?.anchorSetSha256,
    ).toBe(secondDirectory.anchorSetSha256);

    responseMode = "failure";
    const failedResponse = await refreshSubscription(
      app,
      created.id,
      thread.id,
      rejected.subscription.revision,
    );
    expect(failedResponse.status).toBe(200);
    const failed =
      (await failedResponse.json()) as ReceiptTrustAnchorDirectorySubscriptionRefreshResult;
    expect(failed).toEqual(
      expect.objectContaining({
        status: "failed",
        failureSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        subscription: expect.objectContaining({
          lastRefreshStatus: "failed",
          lastGoodDiscovery: rejected.subscription.lastGoodDiscovery,
        }),
      }),
    );
    expect(JSON.stringify(failed)).not.toContain("private upstream detail");

    const pauseResponse = await app.request(
      `/api/receipt-trust/anchors/directory/subscriptions/${created.id}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: thread.id,
          expectedRevision: failed.subscription.revision,
          status: "paused",
        }),
      },
    );
    expect(pauseResponse.status).toBe(200);
    const paused =
      (await pauseResponse.json()) as ReceiptTrustAnchorDirectorySubscription;
    expect(paused.status).toBe("paused");
    const pauseMirrorResponse = await app.request(
      `/api/receipt-trust/anchors/directory/subscriptions/${mirror.id}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: thread.id,
          expectedRevision: mirror.revision,
          status: "paused",
        }),
      },
    );
    expect(pauseMirrorResponse.status).toBe(200);
    expect(
      await services.receiptTrustDirectorySubscriptions.refreshDue(
        new Date("2030-01-01T00:00:00.000Z"),
      ),
    ).toBe(0);

    const events = await services.store.listEvents(thread.id);
    expect(
      events.filter((event) =>
        event.type.startsWith("receipt.trust_directory_subscription."),
      ),
    ).toHaveLength(8);
    expect(
      events.filter((event) =>
        event.type.startsWith("receipt.trust_checkpoint_subscription."),
      ),
    ).toHaveLength(11);
    expect(JSON.stringify(events)).not.toContain(sourceUrl);
    expect(JSON.stringify(events)).not.toContain(checkpointSourceUrl);
    expect(JSON.stringify(events)).not.toContain("private upstream detail");
  });
});

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function createDirectory(
  threadId: string,
  label: string,
): ReceiptTrustAnchorDirectory {
  const { publicKey } = generateKeyPairSync("ed25519");
  const publicKeySpki = publicKey
    .export({ format: "der", type: "spki" })
    .toString("base64");
  const anchor = createReceiptTrustAnchor({
    threadId,
    label,
    source: { type: "public_key", publicKeySpki },
  });
  return createReceiptTrustAnchorDirectory([anchor]);
}

function refreshSubscription(
  app: ReturnType<typeof createApp>,
  subscriptionId: string,
  threadId: string,
  expectedRevision: number,
): Promise<Response> {
  return app.request(
    `/api/receipt-trust/anchors/directory/subscriptions/${subscriptionId}/refresh`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ threadId, expectedRevision }),
    },
  );
}
