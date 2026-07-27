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
  createReceiptTrustAnchorDirectorySubscription,
  createReceiptTrustAnchorDirectoryQuorumPromotionReceipt,
  validatePersistedReceiptTrustAnchorDirectorySubscription,
} from "../src/receipt-trust-directory-subscriptions.js";
import {
  createReceiptTrustAnchor,
  createReceiptTrustAnchorDirectory,
  createReceiptTrustAnchorDirectoryMetadataReceipt,
  signTrustedReceipt,
  verifyReceiptTrustAnchorDirectory,
} from "../src/receipt-trust.js";
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
    const dissenting = await store.createReceiptTrustAnchorDirectorySubscription(
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
    const metadataPinned = store.getReceiptTrustAnchorDirectorySubscriptionQuorum(
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
        agreementMetadataPublisherSetSha256: expect.stringMatching(
          /^[a-f0-9]{64}$/,
        ),
      }),
    );
    expect(
      metadataPinned.sources.find((source) => source.subscriptionId === left.id),
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
          selectedSubscriptionSetSha256: promotion.selectedSubscriptionSetSha256,
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

    const missingPublisher = store.getReceiptTrustAnchorDirectorySubscriptionQuorum(
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
