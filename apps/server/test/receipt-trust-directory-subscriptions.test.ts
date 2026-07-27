import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  ImportReceiptTrustAnchorDirectoryQuorumPromotionBaselineResult,
  ReceiptTrustAnchor,
  ReceiptTrustAnchorDirectory,
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
  ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionResult,
  PromoteReceiptTrustAnchorDirectoryQuorumBaselineResult,
  SignReceiptTrustAnchorDirectoryQuorumActivationDecisionResult,
  TrustedReceiptEnvelope,
  TrustedReceiptVerification,
} from "@napier/contracts";
import {
  createReceiptTrustAnchor,
  createReceiptTrustAnchorDirectory,
} from "@napier/runtime";
import { afterEach, describe, expect, it } from "vitest";

import {
  createApp,
  createServices as createNapierServices,
} from "../src/app.js";

const temporaryRoots: string[] = [];
const openServices: Awaited<ReturnType<typeof createNapierServices>>[] = [];
const SIGNING_ENV = "NAPIER_TEST_QUORUM_METADATA_SIGNING_KEY";

afterEach(async () => {
  delete process.env[SIGNING_ENV];
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
    let hostedDirectory: ReceiptTrustAnchorDirectory | undefined;
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
        fetcher: async () => {
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
    expect(JSON.stringify(events)).not.toContain(sourceUrl);
    expect(JSON.stringify(events)).not.toContain("private upstream detail");
  });
});

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
