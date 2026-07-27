import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  ReceiptTrustAnchor,
  ReceiptTrustAnchorDirectory,
  ReceiptTrustAnchorDirectoryQuorum,
  ReceiptTrustAnchorDirectoryQuorumPromotionBaseline,
  ReceiptTrustAnchorDirectoryQuorumPromotionBaselineVerification,
  ReceiptTrustAnchorDirectoryQuorumPromotionReceipt,
  ReceiptTrustAnchorDirectorySubscription,
  ReceiptTrustAnchorDirectorySubscriptionRefreshResult,
  PromoteReceiptTrustAnchorDirectoryQuorumBaselineResult,
  TrustedReceiptEnvelope,
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
          selectedSubscriptionSetSha256: promotion.selectedSubscriptionSetSha256,
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
