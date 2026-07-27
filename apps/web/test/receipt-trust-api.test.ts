import { createHash } from "node:crypto";

import type {
  ReceiptTrustAnchorDirectory,
  ReceiptTrustAnchorDirectoryVerification,
  TrustedReceiptEnvelope,
  TrustedReceiptVerification,
} from "@napier/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getReceiptTrustAnchorDirectory,
  verifyReceiptTrustAnchorDirectory,
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
          publicKeySpki: "MCowBQYDK2VwAyEA000000000000000000000000000000000000000=",
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
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
