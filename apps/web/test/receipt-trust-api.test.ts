import { createHash } from "node:crypto";

import type {
  ReceiptTrustAnchorDirectory,
  ReceiptTrustAnchorDirectoryDiscovery,
  ReceiptTrustAnchorDirectoryMetadataVerification,
  ReceiptTrustAnchorDirectoryQuorum,
  ReceiptTrustAnchorDirectorySubscription,
  ReceiptTrustAnchorDirectorySubscriptionRefreshResult,
  ReceiptTrustAnchorDirectoryVerification,
  TrustedReceiptEnvelope,
  TrustedReceiptVerification,
} from "@napier/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createReceiptTrustAnchorDirectorySubscription,
  discoverReceiptTrustAnchorDirectory,
  evaluateReceiptTrustAnchorDirectoryQuorum,
  getSignedReceiptTrustAnchorDirectoryMetadata,
  getReceiptTrustAnchorDirectory,
  listReceiptTrustAnchorDirectorySubscriptions,
  refreshReceiptTrustAnchorDirectorySubscription,
  updateReceiptTrustAnchorDirectorySubscription,
  verifyReceiptTrustAnchorDirectory,
  verifyReceiptTrustAnchorDirectoryMetadata,
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
        expectedAnchorSetSha256: "",
        requiredSourceOriginSha256s: [],
        sourceWeights: [],
      },
      policySha256: "4".repeat(64),
      sourceCount: 2,
      candidateCount: 1,
      agreementCount: 2,
      agreementWeight: 2,
      agreementDistinctSourceOriginCount: 2,
      selectedAnchorSetSha256: "5".repeat(64),
      selectedDirectorySha256: "6".repeat(64),
      sources: [],
      candidates: [],
      contentSha256: "7".repeat(64),
    } satisfies ReceiptTrustAnchorDirectoryQuorum;
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
    expect(fetchMock).toHaveBeenCalledTimes(5);
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
