import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import type {
  EvaluationCasebook,
  EvaluationCasebookQualificationExecution,
  EvaluationQualificationBaseline,
  PromoteEvaluationQualificationBaselineResult,
  ReceiptTrustAnchor,
  ReceiptTrustAnchorDirectory,
  ReceiptTrustAnchorDirectoryDiscovery,
  ReceiptTrustAnchorDirectoryMetadataVerification,
  ReceiptTrustAnchorDirectoryVerification,
  TrustedReceiptEnvelope,
  TrustedReceiptVerification,
} from "@napier/contracts";
import {
  DEFAULT_EVALUATION_RUBRIC,
  EvaluationCasebookQualificationService,
  ModelRegistry,
  createRunReplaySnapshot,
  hashTrustedReceiptEnvelope,
} from "@napier/runtime";
import { afterEach, describe, expect, it } from "vitest";

import {
  createApp,
  createServices as createNapierServices,
} from "../src/app.js";

const SIGNING_ENV = "NAPIER_TEST_SERVER_RECEIPT_KEY";
const temporaryRoots: string[] = [];
const openServices: Awaited<ReturnType<typeof createNapierServices>>[] = [];

afterEach(async () => {
  delete process.env[SIGNING_ENV];
  for (const services of openServices.splice(0)) {
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

describe("trusted receipt HTTP surface", () => {
  it("signs, verifies, audits, and revokes receipt provenance", async () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    process.env[SIGNING_ENV] = privateKey
      .export({ format: "pem", type: "pkcs8" })
      .toString();
    const root = await mkdtemp(path.join(tmpdir(), "napier-server-trust-"));
    temporaryRoots.push(root);
    const discoverySourceUrl = "https://trust.example.test/napier/anchors.json";
    let hostedDirectory: ReceiptTrustAnchorDirectory | undefined;
    const services = await createNapierServices({
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
      receiptTrustDirectoryDiscovery: {
        allowedOrigins: ["https://trust.example.test"],
        validateEndpoint: async () => undefined,
        fetcher: async (input, init) => {
          expect(init).toEqual(
            expect.objectContaining({
              method: "GET",
              redirect: "manual",
            }),
          );
          if (!hostedDirectory) {
            throw new Error("Hosted directory is not ready");
          }
          const value =
            input === "https://trust.example.test/napier/invalid-anchors.json"
              ? {
                  ...hostedDirectory,
                  anchors: [
                    {
                      ...hostedDirectory.anchors[0]!,
                      label: "Forged hosted signer",
                    },
                  ],
                }
              : hostedDirectory;
          const body = JSON.stringify(value);
          return new Response(body, {
            status: 200,
            headers: {
              "content-type": "application/json; charset=utf-8",
              "content-length": String(Buffer.byteLength(body)),
            },
          });
        },
      },
    });
    openServices.push(services);
    const app = createApp(services);
    const thread = services.store.listThreads()[0]!;
    const agent = services.store.getAgent(thread.agentId);
    const candidate = await services.store.createRun({
      threadId: thread.id,
      agentId: agent.id,
    });
    await services.store.appendEvent({
      threadId: thread.id,
      runId: candidate.id,
      type: "message.assistant",
      category: "message",
      visibility: "user",
      payload: { role: "assistant", text: "Candidate release evidence." },
    });
    await services.store.finishRun(candidate.id, "completed");
    const suite = await services.store.createEvaluationSuite(thread.id, {
      name: "Trusted release gate",
      baselineRunId: thread.runIds[0]!,
      candidateRunIds: [candidate.id],
    });

    const unsupported = await app.request("/api/receipt-trust/anchors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        threadId: thread.id,
        label: "Invalid signer",
        source: { type: "environment", variable: SIGNING_ENV },
        privateKey: "must never be accepted",
      }),
    });
    expect(unsupported.status).toBe(400);

    const createResponse = await app.request("/api/receipt-trust/anchors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        threadId: thread.id,
        label: "Release signer",
        source: { type: "environment", variable: SIGNING_ENV },
      }),
    });
    expect(createResponse.status).toBe(201);
    const anchor = (await createResponse.json()) as ReceiptTrustAnchor;
    expectReceiptTrustAnchorHeaders(createResponse, anchor);
    expect(anchor).toEqual(
      expect.objectContaining({
        algorithm: "Ed25519",
        status: "trusted",
        keyId: expect.stringMatching(/^[a-f0-9]{64}$/),
        signingSource: { type: "environment", variable: SIGNING_ENV },
      }),
    );
    expect(JSON.stringify(anchor)).not.toContain("BEGIN PRIVATE KEY");

    const anchorListResponse = await app.request("/api/receipt-trust/anchors");
    expect(anchorListResponse.status).toBe(200);
    const anchors = (await anchorListResponse.json()) as ReceiptTrustAnchor[];
    expectReceiptTrustAnchorListHeaders(anchorListResponse, anchors);
    expect(anchors).toEqual([anchor]);

    const directoryResponse = await app.request(
      "/api/receipt-trust/anchors/directory",
    );
    expect(directoryResponse.status).toBe(200);
    const directory =
      (await directoryResponse.json()) as ReceiptTrustAnchorDirectory;
    hostedDirectory = directory;
    expectReceiptTrustAnchorDirectoryHeaders(directoryResponse, directory);
    expect(directory).toEqual(
      expect.objectContaining({
        kind: "napier.receipt-trust-anchor-directory",
        schemaVersion: 1,
        anchorCount: 1,
        trustedCount: 1,
        revokedCount: 0,
        receiptKinds: [
          "evaluation_gate",
          "casebook_qualification",
          "policy_retirement_proof_bundle",
          "receipt_trust_anchor_directory_metadata",
          "receipt_trust_anchor_directory_quorum_promotion",
          "receipt_trust_anchor_directory_quorum_activation_decision",
          "receipt_trust_anchor_directory_quorum_activation_selection_rotation_proposal",
          "receipt_trust_anchor_directory_quorum_activation_selection_rotation_proposal_subscription_approval",
          "receipt_trust_anchor_directory_quorum_activation_selection_rotation_proposal_subscription_approval_policy_review",
          "receipt_trust_anchor_directory_quorum_activation_selection_checkpoint",
          "receipt_trust_anchor_directory_quorum_activation_selection_checkpoint_registry_quorum",
        ],
        anchorSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        anchors: [
          expect.objectContaining({
            id: anchor.id,
            keyId: anchor.keyId,
            publicKeySpki: anchor.publicKeySpki,
            status: "trusted",
            anchorSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          }),
        ],
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(JSON.stringify(directory)).not.toContain(SIGNING_ENV);
    expect(JSON.stringify(directory)).not.toContain("BEGIN PRIVATE KEY");
    const directoryPolicy = {
      maxAgeMs: 60_000,
      expectedAnchorSetSha256: directory.anchorSetSha256,
      minimumTrustedCount: 1,
      requiredTrustedKeyIds: [anchor.keyId],
    };
    const directoryVerificationResponse = await app.request(
      "/api/receipt-trust/anchors/directory/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ directory }),
      },
    );
    expect(directoryVerificationResponse.status).toBe(200);
    const directoryVerification =
      (await directoryVerificationResponse.json()) as ReceiptTrustAnchorDirectoryVerification;
    expectReceiptTrustAnchorDirectoryVerificationHeaders(
      directoryVerificationResponse,
      directoryVerification,
    );
    expect(directoryVerification).toEqual(
      expect.objectContaining({
        status: "valid",
        diagnostics: [],
        declaredContentSha256: directory.contentSha256,
        recomputedContentSha256: directory.contentSha256,
        declaredAnchorSetSha256: directory.anchorSetSha256,
        recomputedAnchorSetSha256: directory.anchorSetSha256,
        anchorCount: 1,
        trustedCount: 1,
        revokedCount: 0,
      }),
    );
    const directoryPolicyVerificationResponse = await app.request(
      "/api/receipt-trust/anchors/directory/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ directory, policy: directoryPolicy }),
      },
    );
    expect(directoryPolicyVerificationResponse.status).toBe(200);
    const directoryPolicyVerification =
      (await directoryPolicyVerificationResponse.json()) as ReceiptTrustAnchorDirectoryVerification;
    expectReceiptTrustAnchorDirectoryVerificationHeaders(
      directoryPolicyVerificationResponse,
      directoryPolicyVerification,
    );
    expect(directoryPolicyVerification).toEqual(
      expect.objectContaining({
        status: "valid",
        diagnostics: [],
        policy: directoryPolicy,
        policySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        directoryGeneratedAt: directory.generatedAt,
        directoryAgeMs: expect.any(Number),
      }),
    );
    const expiredDirectoryVerificationResponse = await app.request(
      "/api/receipt-trust/anchors/directory/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          directory: {
            ...directory,
            generatedAt: "2000-01-01T00:00:00.000Z",
          },
          policy: { maxAgeMs: 1 },
        }),
      },
    );
    expect(expiredDirectoryVerificationResponse.status).toBe(200);
    const expiredDirectoryVerification =
      (await expiredDirectoryVerificationResponse.json()) as ReceiptTrustAnchorDirectoryVerification;
    expectReceiptTrustAnchorDirectoryVerificationHeaders(
      expiredDirectoryVerificationResponse,
      expiredDirectoryVerification,
    );
    expect(expiredDirectoryVerification).toEqual(
      expect.objectContaining({
        status: "invalid",
        diagnostics: expect.arrayContaining(["directory_expired"]),
        policy: { maxAgeMs: 1 },
        policySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    const metadataSignResponse = await app.request(
      "/api/receipt-trust/anchors/directory/signed-metadata",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: thread.id,
          trustAnchorId: anchor.id,
          publisher: "Napier Trust Registry",
          sourceUrlSha256: "a".repeat(64),
          sourceOriginSha256: "b".repeat(64),
          expiresAt: "2999-01-01T00:00:00.000Z",
        }),
      },
    );
    expect(metadataSignResponse.status).toBe(201);
    const metadataEnvelope =
      (await metadataSignResponse.json()) as TrustedReceiptEnvelope;
    expect(metadataEnvelope).toEqual(
      expect.objectContaining({
        receiptKind: "receipt_trust_anchor_directory_metadata",
        receipt: expect.objectContaining({
          publisher: "Napier Trust Registry",
          directorySha256: directory.contentSha256,
          anchorSetSha256: directory.anchorSetSha256,
          sourceUrlSha256: "a".repeat(64),
          sourceOriginSha256: "b".repeat(64),
        }),
        signature: expect.objectContaining({
          keyId: anchor.keyId,
        }),
      }),
    );
    expect(metadataSignResponse.headers.get("x-napier-receipt-sha256")).toBe(
      metadataEnvelope.receipt.contentSha256,
    );
    expect(metadataSignResponse.headers.get("x-napier-signature-key-id")).toBe(
      anchor.keyId,
    );
    expect(JSON.stringify(metadataEnvelope)).not.toContain(discoverySourceUrl);

    const metadataVerifyResponse = await app.request(
      "/api/receipt-trust/anchors/directory/metadata/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          envelope: metadataEnvelope,
          directory,
          directoryPolicy,
          trustDirectory: directory,
          trustDirectoryPolicy: directoryPolicy,
        }),
      },
    );
    expect(metadataVerifyResponse.status).toBe(200);
    const metadataVerification =
      (await metadataVerifyResponse.json()) as ReceiptTrustAnchorDirectoryMetadataVerification;
    expectReceiptTrustAnchorDirectoryMetadataVerificationHeaders(
      metadataVerifyResponse,
      metadataVerification,
    );
    expect(metadataVerification).toEqual(
      expect.objectContaining({
        status: "trusted",
        diagnostics: [],
        publisher: "Napier Trust Registry",
        directorySha256: directory.contentSha256,
        anchorSetSha256: directory.anchorSetSha256,
        signerKeyId: anchor.keyId,
        signatureValid: true,
        integrityValid: true,
        directoryBindingValid: true,
      }),
    );

    const metadataMismatchResponse = await app.request(
      "/api/receipt-trust/anchors/directory/metadata/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          envelope: metadataEnvelope,
          directory: {
            ...directory,
            anchors: [
              {
                ...directory.anchors[0]!,
                label: "Tampered metadata directory",
              },
            ],
          },
          trustDirectory: directory,
          trustDirectoryPolicy: directoryPolicy,
        }),
      },
    );
    expect(metadataMismatchResponse.status).toBe(200);
    const metadataMismatch =
      (await metadataMismatchResponse.json()) as ReceiptTrustAnchorDirectoryMetadataVerification;
    expectReceiptTrustAnchorDirectoryMetadataVerificationHeaders(
      metadataMismatchResponse,
      metadataMismatch,
    );
    expect(metadataMismatch).toEqual(
      expect.objectContaining({
        status: "invalid",
        diagnostics: expect.arrayContaining(["directory_invalid"]),
        signatureValid: true,
        integrityValid: true,
        directoryBindingValid: false,
      }),
    );
    const eventCountBeforeDiscovery = (
      await services.store.listEvents(thread.id)
    ).length;
    const discoveryResponse = await app.request(
      "/api/receipt-trust/anchors/directory/discover",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceUrl: discoverySourceUrl,
          policy: directoryPolicy,
        }),
      },
    );
    expect(discoveryResponse.status).toBe(200);
    const discovery =
      (await discoveryResponse.json()) as ReceiptTrustAnchorDirectoryDiscovery;
    expectReceiptTrustAnchorDirectoryDiscoveryHeaders(
      discoveryResponse,
      discovery,
    );
    expect(discovery).toEqual(
      expect.objectContaining({
        kind: "napier.receipt-trust-anchor-directory-discovery",
        schemaVersion: 1,
        status: "valid",
        sourceUrlSha256: createHash("sha256")
          .update(discoverySourceUrl)
          .digest("hex"),
        sourceOriginSha256: createHash("sha256")
          .update("https://trust.example.test")
          .digest("hex"),
        httpStatus: 200,
        responseMediaType: "application/json",
        responseBytes: expect.any(Number),
        responseBodySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        verification: expect.objectContaining({
          status: "valid",
          policy: directoryPolicy,
        }),
        directory,
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(JSON.stringify(discovery)).not.toContain(discoverySourceUrl);
    const invalidDiscoveryResponse = await app.request(
      "/api/receipt-trust/anchors/directory/discover",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceUrl: "https://trust.example.test/napier/invalid-anchors.json",
          policy: directoryPolicy,
        }),
      },
    );
    expect(invalidDiscoveryResponse.status).toBe(200);
    const invalidDiscovery =
      (await invalidDiscoveryResponse.json()) as ReceiptTrustAnchorDirectoryDiscovery;
    expectReceiptTrustAnchorDirectoryDiscoveryHeaders(
      invalidDiscoveryResponse,
      invalidDiscovery,
    );
    expect(invalidDiscovery).toEqual(
      expect.objectContaining({
        status: "invalid",
        verification: expect.objectContaining({
          status: "invalid",
          diagnostics: expect.arrayContaining([
            "content_hash_mismatch",
            "anchors_invalid",
          ]),
        }),
      }),
    );
    expect(invalidDiscovery).not.toHaveProperty("directory");
    const deniedDiscoveryResponse = await app.request(
      "/api/receipt-trust/anchors/directory/discover",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceUrl: "https://untrusted.example.test/anchors.json",
          policy: directoryPolicy,
        }),
      },
    );
    expect(deniedDiscoveryResponse.status).toBe(403);
    const deniedDiscoveryBody = await deniedDiscoveryResponse.text();
    expect(deniedDiscoveryBody).not.toContain("untrusted.example.test");
    expect(deniedDiscoveryResponse.headers.get("cache-control")).toBe(
      "no-store",
    );
    expect(deniedDiscoveryResponse.headers.get("x-napier-content-sha256")).toBe(
      createHash("sha256").update(deniedDiscoveryBody).digest("hex"),
    );
    expect(await services.store.listEvents(thread.id)).toHaveLength(
      eventCountBeforeDiscovery,
    );
    const tamperedDirectoryVerificationResponse = await app.request(
      "/api/receipt-trust/anchors/directory/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          directory: {
            ...directory,
            anchors: [
              {
                ...directory.anchors[0]!,
                label: "Forged release signer",
              },
            ],
          },
        }),
      },
    );
    expect(tamperedDirectoryVerificationResponse.status).toBe(200);
    const tamperedDirectoryVerification =
      (await tamperedDirectoryVerificationResponse.json()) as ReceiptTrustAnchorDirectoryVerification;
    expectReceiptTrustAnchorDirectoryVerificationHeaders(
      tamperedDirectoryVerificationResponse,
      tamperedDirectoryVerification,
    );
    expect(tamperedDirectoryVerification).toEqual(
      expect.objectContaining({
        status: "invalid",
        diagnostics: expect.arrayContaining([
          "content_hash_mismatch",
          "anchors_invalid",
        ]),
      }),
    );

    const invalidSignedResponse = await app.request(
      `/api/threads/${thread.id}/evaluation-suites/${suite.id}/signed-receipt`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          trustAnchorId: anchor.id,
          unexpected: true,
        }),
      },
    );
    expect(invalidSignedResponse.status).toBe(400);
    expect(await invalidSignedResponse.json()).toEqual(
      expect.objectContaining({
        error: "Signed evaluation gate receipt request is invalid",
      }),
    );
    const signedEventsBeforeGate = (
      await services.store.listEvents(thread.id)
    ).filter((event) => event.type === "receipt.signed");
    expect(signedEventsBeforeGate).toHaveLength(1);
    expect(signedEventsBeforeGate[0]?.payload).toEqual(
      expect.objectContaining({
        receiptKind: "receipt_trust_anchor_directory_metadata",
        directorySha256: directory.contentSha256,
        anchorSetSha256: directory.anchorSetSha256,
      }),
    );
    expect(JSON.stringify(signedEventsBeforeGate)).not.toContain(
      discoverySourceUrl,
    );

    const signedResponse = await app.request(
      `/api/threads/${thread.id}/evaluation-suites/${suite.id}/signed-receipt`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trustAnchorId: anchor.id }),
      },
    );
    expect(signedResponse.status).toBe(201);
    const envelope = (await signedResponse.json()) as TrustedReceiptEnvelope;
    expect(envelope).toEqual(
      expect.objectContaining({
        receiptKind: "evaluation_gate",
        receipt: expect.objectContaining({ state: "not_run" }),
        signature: expect.objectContaining({ keyId: anchor.keyId }),
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(signedResponse.headers.get("x-napier-signature-key-id")).toBe(
      anchor.keyId,
    );
    expect(signedResponse.headers.get("x-napier-content-sha256")).toBe(
      envelope.contentSha256,
    );
    expect(signedResponse.headers.get("x-napier-receipt-artifact-sha256")).toBe(
      envelope.signature.receiptArtifactSha256,
    );

    const verifyResponse = await app.request("/api/receipt-trust/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ envelope }),
    });
    expect(verifyResponse.status).toBe(200);
    const verification =
      (await verifyResponse.json()) as TrustedReceiptVerification;
    expectTrustedReceiptVerificationHeaders(verifyResponse, verification);
    expect(verification).toEqual(
      expect.objectContaining({
        status: "trusted",
        signatureValid: true,
        integrityValid: true,
        keyId: anchor.keyId,
      }),
    );
    const orphanedDirectoryPolicyResponse = await app.request(
      "/api/receipt-trust/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          envelope,
          directoryPolicy: { requiredTrustedKeyIds: [anchor.keyId] },
        }),
      },
    );
    expect(orphanedDirectoryPolicyResponse.status).toBe(400);
    const orphanedDirectoryPolicyBody =
      await orphanedDirectoryPolicyResponse.text();
    expect(orphanedDirectoryPolicyResponse.headers.get("cache-control")).toBe(
      "no-store",
    );
    expect(
      orphanedDirectoryPolicyResponse.headers.get("x-napier-content-sha256"),
    ).toBe(
      createHash("sha256").update(orphanedDirectoryPolicyBody).digest("hex"),
    );
    expect(
      orphanedDirectoryPolicyResponse.headers.get(
        "x-napier-content-sha256-mode",
      ),
    ).toBe("body");
    const directoryVerifyResponse = await app.request(
      "/api/receipt-trust/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ envelope, directory }),
      },
    );
    expect(directoryVerifyResponse.status).toBe(200);
    const directoryVerificationBody =
      (await directoryVerifyResponse.json()) as TrustedReceiptVerification;
    expectTrustedReceiptVerificationHeaders(
      directoryVerifyResponse,
      directoryVerificationBody,
    );
    expect(directoryVerificationBody).toEqual(
      expect.objectContaining({
        status: "trusted",
        keyId: anchor.keyId,
        anchorDirectorySha256: directory.contentSha256,
        anchorDirectoryVerificationSha256:
          expect.stringMatching(/^[a-f0-9]{64}$/),
        anchorDirectoryAnchorCount: 1,
        signatureValid: true,
        integrityValid: true,
      }),
    );
    const directoryPolicyVerifyResponse = await app.request(
      "/api/receipt-trust/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          envelope,
          directory,
          directoryPolicy,
        }),
      },
    );
    expect(directoryPolicyVerifyResponse.status).toBe(200);
    const directoryPolicyVerificationBody =
      (await directoryPolicyVerifyResponse.json()) as TrustedReceiptVerification;
    expectTrustedReceiptVerificationHeaders(
      directoryPolicyVerifyResponse,
      directoryPolicyVerificationBody,
    );
    expect(directoryPolicyVerificationBody).toEqual(
      expect.objectContaining({
        status: "trusted",
        keyId: anchor.keyId,
        anchorDirectorySha256: directory.contentSha256,
        anchorDirectoryVerificationSha256:
          expect.stringMatching(/^[a-f0-9]{64}$/),
        anchorDirectoryPolicySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        anchorDirectoryGeneratedAt: directory.generatedAt,
        anchorDirectoryAgeMs: expect.any(Number),
        signatureValid: true,
        integrityValid: true,
      }),
    );
    const rejectedDirectoryPolicyVerifyResponse = await app.request(
      "/api/receipt-trust/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          envelope,
          directory,
          directoryPolicy: { requiredTrustedKeyIds: ["f".repeat(64)] },
        }),
      },
    );
    expect(rejectedDirectoryPolicyVerifyResponse.status).toBe(200);
    const rejectedDirectoryPolicyVerification =
      (await rejectedDirectoryPolicyVerifyResponse.json()) as TrustedReceiptVerification;
    expectTrustedReceiptVerificationHeaders(
      rejectedDirectoryPolicyVerifyResponse,
      rejectedDirectoryPolicyVerification,
    );
    expect(rejectedDirectoryPolicyVerification).toEqual(
      expect.objectContaining({
        status: "invalid",
        anchorDirectorySha256: directory.contentSha256,
        anchorDirectoryVerificationSha256:
          expect.stringMatching(/^[a-f0-9]{64}$/),
        anchorDirectoryPolicySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        signatureValid: false,
        integrityValid: false,
        reason: "Receipt trust anchor directory is invalid",
      }),
    );

    const tampered = structuredClone(envelope);
    tampered.receipt.generatedAt = "2026-01-01T00:00:00.000Z";
    const { contentSha256: _tamperedSha256, ...tamperedContent } = tampered;
    tampered.contentSha256 = hashTrustedReceiptEnvelope(tamperedContent);
    const tamperedResponse = await app.request("/api/receipt-trust/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ envelope: tampered }),
    });
    expect(tamperedResponse.status).toBe(200);
    const tamperedVerification =
      (await tamperedResponse.json()) as TrustedReceiptVerification;
    expectTrustedReceiptVerificationHeaders(
      tamperedResponse,
      tamperedVerification,
    );
    expect(tamperedVerification).toEqual(
      expect.objectContaining({
        status: "invalid",
        integrityValid: false,
      }),
    );

    const casebookResponse = await app.request("/api/evaluation-casebooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        threadId: thread.id,
        name: "Unqualified baseline",
      }),
    });
    const casebook = (await casebookResponse.json()) as EvaluationCasebook;
    const invalidBaseline = await app.request(
      `/api/evaluation-casebooks/${casebook.id}/qualification-baselines`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: thread.id,
          trustAnchorId: anchor.id,
          unexpected: true,
        }),
      },
    );
    expect(invalidBaseline.status).toBe(400);
    expect(await invalidBaseline.json()).toEqual(
      expect.objectContaining({
        error: "Qualification baseline request is invalid",
      }),
    );
    expect(
      services.store.listEvaluationQualificationBaselines(casebook.id),
    ).toHaveLength(0);

    const rejectedBaseline = await app.request(
      `/api/evaluation-casebooks/${casebook.id}/qualification-baselines`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: thread.id,
          trustAnchorId: anchor.id,
        }),
      },
    );
    expect(rejectedBaseline.status).toBe(409);
    const baselineListResponse = await app.request(
      `/api/evaluation-casebooks/${casebook.id}/qualification-baselines`,
    );
    expect(baselineListResponse.status).toBe(200);
    const baselines =
      (await baselineListResponse.json()) as EvaluationQualificationBaseline[];
    expectEvaluationQualificationBaselineListHeaders(
      baselineListResponse,
      casebook.id,
      baselines,
    );
    expect(baselines).toEqual([]);

    const leftRun = await services.store.createRun({
      threadId: thread.id,
      agentId: agent.id,
    });
    await services.store.appendEvent({
      threadId: thread.id,
      runId: leftRun.id,
      type: "message.assistant",
      category: "message",
      visibility: "user",
      payload: { role: "assistant", text: "Baseline answer." },
    });
    const completedLeftRun = await services.store.finishRun(
      leftRun.id,
      "completed",
    );
    const rightRun = await services.store.createRun({
      threadId: thread.id,
      agentId: agent.id,
    });
    await services.store.appendEvent({
      threadId: thread.id,
      runId: rightRun.id,
      type: "message.assistant",
      category: "message",
      visibility: "user",
      payload: { role: "assistant", text: "Candidate answer with evidence." },
    });
    const completedRightRun = await services.store.finishRun(
      rightRun.id,
      "completed",
    );
    const [leftSnapshot, rightSnapshot] = await Promise.all([
      createRunReplaySnapshot(services.store, thread.id, completedLeftRun.id),
      createRunReplaySnapshot(services.store, thread.id, completedRightRun.id),
    ]);
    const baselineEvaluation = await services.store.saveRunEvaluation({
      id: "evaluation_receipt_trust_baseline",
      threadId: thread.id,
      leftRunId: completedLeftRun.id,
      rightRunId: completedRightRun.id,
      leftSnapshotSha256: leftSnapshot.eventStreamSha256,
      rightSnapshotSha256: rightSnapshot.eventStreamSha256,
      rubric: structuredClone(DEFAULT_EVALUATION_RUBRIC),
      scores: DEFAULT_EVALUATION_RUBRIC.criteria.map((criterion) => ({
        criterionId: criterion.id,
        leftScore: 3,
        rightScore: 4,
        reason: `${criterion.name} is stronger in the candidate.`,
      })),
      verdict: "right_better",
      reason: "The candidate preserves stronger evidence.",
      evidence: "Compared immutable replay snapshots.",
      evaluatorModel: { provider: "receipt-trust-source", id: "judge-1" },
      createdAt: "2026-07-25T10:00:00.000Z",
    });
    await services.store.reviewRunEvaluation(thread.id, baselineEvaluation.id, {
      expectedVerdict: "right_better",
      note: "Human review confirmed the candidate.",
    });
    await services.store.curateEvaluationCasebookCase(casebook.id, {
      threadId: thread.id,
      evaluationId: baselineEvaluation.id,
    });
    const qualificationProvider = fauxProvider({
      provider: "receipt-trust-qualification",
    });
    qualificationProvider.setResponses([
      fauxAssistantMessage(passingQualificationResponse()),
    ]);
    const qualificationModels = new ModelRegistry();
    qualificationModels.registerProvider(qualificationProvider.provider);
    const qualification = await new EvaluationCasebookQualificationService(
      services.store,
      qualificationModels,
    ).execute(casebook.id, {
      threadId: thread.id,
      model: { provider: "receipt-trust-qualification", id: "faux-1" },
      gate: { minimumAgreementRate: 1, allowInconclusive: false },
    });
    expect(qualification).toEqual(
      expect.objectContaining({
        status: "passed",
        sampleCount: 1,
        agreementCount: 1,
        inconclusiveCount: 0,
      } satisfies Partial<EvaluationCasebookQualificationExecution>),
    );

    const promotedBaselineResponse = await app.request(
      `/api/evaluation-casebooks/${casebook.id}/qualification-baselines`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: thread.id,
          trustAnchorId: anchor.id,
        }),
      },
    );
    expect(promotedBaselineResponse.status).toBe(201);
    const promotedBaseline =
      (await promotedBaselineResponse.json()) as PromoteEvaluationQualificationBaselineResult;
    expectPromoteEvaluationQualificationBaselineResultHeaders(
      promotedBaselineResponse,
      promotedBaseline,
    );
    expect(promotedBaseline).toEqual(
      expect.objectContaining({
        created: true,
        baseline: expect.objectContaining({
          casebookId: casebook.id,
          qualificationExecutionId: qualification.id,
          qualificationExecutionSha256: qualification.contentSha256,
          promotedByThreadId: thread.id,
          contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    );

    const duplicateBaselineResponse = await app.request(
      `/api/evaluation-casebooks/${casebook.id}/qualification-baselines`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: thread.id,
          trustAnchorId: anchor.id,
        }),
      },
    );
    expect(duplicateBaselineResponse.status).toBe(200);
    const duplicateBaseline =
      (await duplicateBaselineResponse.json()) as PromoteEvaluationQualificationBaselineResult;
    expectPromoteEvaluationQualificationBaselineResultHeaders(
      duplicateBaselineResponse,
      duplicateBaseline,
    );
    expect(duplicateBaseline).toEqual({
      baseline: promotedBaseline.baseline,
      created: false,
    });

    const promotedBaselineListResponse = await app.request(
      `/api/evaluation-casebooks/${casebook.id}/qualification-baselines`,
    );
    expect(promotedBaselineListResponse.status).toBe(200);
    const promotedBaselines =
      (await promotedBaselineListResponse.json()) as EvaluationQualificationBaseline[];
    expectEvaluationQualificationBaselineListHeaders(
      promotedBaselineListResponse,
      casebook.id,
      promotedBaselines,
    );
    expect(promotedBaselines).toEqual([promotedBaseline.baseline]);

    const invalidRevokeResponse = await app.request(
      `/api/receipt-trust/anchors/${anchor.id}/revoke`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: thread.id,
          unexpected: true,
        }),
      },
    );
    expect(invalidRevokeResponse.status).toBe(400);
    expect(await invalidRevokeResponse.json()).toEqual(
      expect.objectContaining({
        error: "Receipt trust anchor revocation is invalid",
      }),
    );
    expect(services.store.getReceiptTrustAnchor(anchor.id)).toEqual(
      expect.objectContaining({ status: "trusted" }),
    );

    const revokeResponse = await app.request(
      `/api/receipt-trust/anchors/${anchor.id}/revoke`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId: thread.id }),
      },
    );
    expect(revokeResponse.status).toBe(200);
    const revokedAnchor = (await revokeResponse.json()) as ReceiptTrustAnchor;
    expectReceiptTrustAnchorHeaders(revokeResponse, revokedAnchor);
    expect(revokedAnchor).toEqual(
      expect.objectContaining({ status: "revoked" }),
    );

    const revokedAnchorListResponse = await app.request(
      "/api/receipt-trust/anchors",
    );
    expect(revokedAnchorListResponse.status).toBe(200);
    const revokedAnchors =
      (await revokedAnchorListResponse.json()) as ReceiptTrustAnchor[];
    expectReceiptTrustAnchorListHeaders(
      revokedAnchorListResponse,
      revokedAnchors,
    );
    expect(revokedAnchors).toEqual([revokedAnchor]);
    const revokedDirectoryResponse = await app.request(
      "/api/receipt-trust/anchors/directory",
    );
    expect(revokedDirectoryResponse.status).toBe(200);
    const revokedDirectory =
      (await revokedDirectoryResponse.json()) as ReceiptTrustAnchorDirectory;
    expectReceiptTrustAnchorDirectoryHeaders(
      revokedDirectoryResponse,
      revokedDirectory,
    );
    expect(revokedDirectory).toEqual(
      expect.objectContaining({
        anchorCount: 1,
        trustedCount: 0,
        revokedCount: 1,
        anchors: [
          expect.objectContaining({
            keyId: anchor.keyId,
            status: "revoked",
          }),
        ],
      }),
    );

    const revokedVerification = await app.request("/api/receipt-trust/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ envelope }),
    });
    const revokedVerificationBody =
      (await revokedVerification.json()) as TrustedReceiptVerification;
    expectTrustedReceiptVerificationHeaders(
      revokedVerification,
      revokedVerificationBody,
    );
    expect(revokedVerificationBody).toEqual(
      expect.objectContaining({
        status: "revoked",
        signatureValid: true,
        integrityValid: true,
      }),
    );
    const revokedDirectoryVerification = await app.request(
      "/api/receipt-trust/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ envelope, directory: revokedDirectory }),
      },
    );
    const revokedDirectoryVerificationBody =
      (await revokedDirectoryVerification.json()) as TrustedReceiptVerification;
    expectTrustedReceiptVerificationHeaders(
      revokedDirectoryVerification,
      revokedDirectoryVerificationBody,
    );
    expect(revokedDirectoryVerificationBody).toEqual(
      expect.objectContaining({
        status: "revoked",
        anchorDirectorySha256: revokedDirectory.contentSha256,
        anchorDirectoryAnchorCount: 1,
        signatureValid: true,
        integrityValid: true,
      }),
    );
    const rejectedSigning = await app.request(
      `/api/threads/${thread.id}/evaluation-suites/${suite.id}/signed-receipt`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trustAnchorId: anchor.id }),
      },
    );
    expect(rejectedSigning.status).toBe(409);

    const detail = await services.store.getDetail(thread.id);
    expect(detail.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "receipt.trust_anchor.created",
        "receipt.signed",
        "receipt.trust_anchor.revoked",
      ]),
    );
    expect(JSON.stringify(detail.events)).not.toContain(SIGNING_ENV);
    expect(JSON.stringify(detail.events)).not.toContain("BEGIN PRIVATE KEY");
  });
});

function passingQualificationResponse(): string {
  return JSON.stringify({
    verdict: "right_better",
    reason: "Compared the frozen replay evidence.",
    evidence: "The candidate includes a stronger supported answer.",
    scores: DEFAULT_EVALUATION_RUBRIC.criteria.map((criterion) => ({
      criterionId: criterion.id,
      leftScore: 3,
      rightScore: 4,
      reason: `Scored ${criterion.name}.`,
    })),
  });
}

function expectReceiptTrustAnchorListHeaders(
  response: Response,
  anchors: ReceiptTrustAnchor[],
): void {
  const contentSha256 = createHash("sha256")
    .update(JSON.stringify(anchors))
    .digest("hex");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(contentSha256);
  expect(response.headers.get("x-napier-receipt-trust-anchor-count")).toBe(
    String(anchors.length),
  );
  expect(response.headers.get("x-napier-receipt-trust-trusted-count")).toBe(
    String(anchors.filter((anchor) => anchor.status === "trusted").length),
  );
  expect(response.headers.get("x-napier-receipt-trust-revoked-count")).toBe(
    String(anchors.filter((anchor) => anchor.status === "revoked").length),
  );
  expect(
    response.headers.get("x-napier-receipt-trust-signing-capable-count"),
  ).toBe(
    String(anchors.filter((anchor) => Boolean(anchor.signingSource)).length),
  );
}

function expectReceiptTrustAnchorHeaders(
  response: Response,
  anchor: ReceiptTrustAnchor,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    anchor.contentSha256,
  );
  expect(response.headers.get("x-napier-receipt-trust-anchor-id")).toBe(
    anchor.id,
  );
  expect(response.headers.get("x-napier-signature-key-id")).toBe(anchor.keyId);
  expect(response.headers.get("x-napier-receipt-trust-anchor-status")).toBe(
    anchor.status,
  );
  expect(response.headers.get("x-napier-receipt-trust-signing-capable")).toBe(
    String(Boolean(anchor.signingSource)),
  );
}

function expectReceiptTrustAnchorDirectoryHeaders(
  response: Response,
  directory: ReceiptTrustAnchorDirectory,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    directory.contentSha256,
  );
  expect(response.headers.get("x-napier-content-sha256-mode")).toBe("stable");
  expect(
    response.headers.get("x-napier-receipt-trust-anchor-directory-sha256"),
  ).toBe(directory.contentSha256);
  expect(
    response.headers.get(
      "x-napier-receipt-trust-anchor-directory-anchor-set-sha256",
    ),
  ).toBe(directory.anchorSetSha256);
  expect(response.headers.get("x-napier-receipt-trust-anchor-count")).toBe(
    String(directory.anchorCount),
  );
  expect(response.headers.get("x-napier-receipt-trust-trusted-count")).toBe(
    String(directory.trustedCount),
  );
  expect(response.headers.get("x-napier-receipt-trust-revoked-count")).toBe(
    String(directory.revokedCount),
  );
}

function expectReceiptTrustAnchorDirectoryDiscoveryHeaders(
  response: Response,
  discovery: ReceiptTrustAnchorDirectoryDiscovery,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    discovery.contentSha256,
  );
  expect(response.headers.get("x-napier-content-sha256-mode")).toBe("stable");
  expect(
    response.headers.get(
      "x-napier-receipt-trust-anchor-directory-discovery-sha256",
    ),
  ).toBe(discovery.contentSha256);
  expect(
    response.headers.get(
      "x-napier-receipt-trust-anchor-directory-source-url-sha256",
    ),
  ).toBe(discovery.sourceUrlSha256);
  expect(
    response.headers.get(
      "x-napier-receipt-trust-anchor-directory-source-origin-sha256",
    ),
  ).toBe(discovery.sourceOriginSha256);
  expect(
    response.headers.get(
      "x-napier-receipt-trust-anchor-directory-response-sha256",
    ),
  ).toBe(discovery.responseBodySha256);
  expect(
    response.headers.get(
      "x-napier-receipt-trust-anchor-directory-response-bytes",
    ),
  ).toBe(String(discovery.responseBytes));
  expect(
    response.headers.get("x-napier-receipt-trust-anchor-directory-http-status"),
  ).toBe(String(discovery.httpStatus));
  expect(response.headers.get("x-napier-verification-status")).toBe(
    discovery.status,
  );
  expect(
    response.headers.get(
      "x-napier-receipt-trust-anchor-directory-verification-sha256",
    ),
  ).toBe(discovery.verification.contentSha256);
  expect(
    response.headers.get("x-napier-receipt-trust-anchor-directory-sha256"),
  ).toBe(discovery.directory?.contentSha256 ?? null);
  expect(
    response.headers.get(
      "x-napier-receipt-trust-anchor-directory-anchor-set-sha256",
    ),
  ).toBe(discovery.directory?.anchorSetSha256 ?? null);
}

function expectReceiptTrustAnchorDirectoryVerificationHeaders(
  response: Response,
  verification: ReceiptTrustAnchorDirectoryVerification,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    verification.contentSha256,
  );
  expect(response.headers.get("x-napier-content-sha256-mode")).toBe("stable");
  expect(response.headers.get("x-napier-verification-status")).toBe(
    verification.status,
  );
  expect(response.headers.get("x-napier-diagnostic-count")).toBe(
    String(verification.diagnostics.length),
  );
  expect(response.headers.get("x-napier-diagnostics-sha256")).toBe(
    createHash("sha256")
      .update(JSON.stringify(verification.diagnostics))
      .digest("hex"),
  );
  expect(
    response.headers.get("x-napier-receipt-trust-anchor-directory-sha256"),
  ).toBe(verification.declaredContentSha256 ?? null);
  expect(
    response.headers.get(
      "x-napier-receipt-trust-anchor-directory-verification-sha256",
    ),
  ).toBe(verification.contentSha256);
  expect(
    response.headers.get(
      "x-napier-receipt-trust-anchor-directory-policy-sha256",
    ),
  ).toBe(verification.policySha256 ?? null);
  expect(
    response.headers.get(
      "x-napier-receipt-trust-anchor-directory-generated-at",
    ),
  ).toBe(verification.directoryGeneratedAt ?? null);
  expect(
    response.headers.get("x-napier-receipt-trust-anchor-directory-age-ms"),
  ).toBe(
    verification.directoryAgeMs === undefined
      ? null
      : String(verification.directoryAgeMs),
  );
  expect(
    response.headers.get(
      "x-napier-receipt-trust-anchor-directory-anchor-set-sha256",
    ),
  ).toBe(verification.declaredAnchorSetSha256 ?? null);
  expect(
    response.headers.get(
      "x-napier-recomputed-receipt-trust-anchor-directory-anchor-set-sha256",
    ),
  ).toBe(verification.recomputedAnchorSetSha256 ?? null);
  expect(response.headers.get("x-napier-receipt-trust-anchor-count")).toBe(
    verification.anchorCount === undefined
      ? null
      : String(verification.anchorCount),
  );
  expect(response.headers.get("x-napier-receipt-trust-trusted-count")).toBe(
    verification.trustedCount === undefined
      ? null
      : String(verification.trustedCount),
  );
  expect(response.headers.get("x-napier-receipt-trust-revoked-count")).toBe(
    verification.revokedCount === undefined
      ? null
      : String(verification.revokedCount),
  );
}

function expectReceiptTrustAnchorDirectoryMetadataVerificationHeaders(
  response: Response,
  verification: ReceiptTrustAnchorDirectoryMetadataVerification,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    verification.contentSha256,
  );
  expect(response.headers.get("x-napier-content-sha256-mode")).toBe("stable");
  expect(response.headers.get("x-napier-verification-status")).toBe(
    verification.status,
  );
  expect(
    response.headers.get(
      "x-napier-receipt-trust-anchor-directory-metadata-verification-sha256",
    ),
  ).toBe(verification.contentSha256);
  expect(response.headers.get("x-napier-diagnostic-count")).toBe(
    String(verification.diagnostics.length),
  );
  expect(response.headers.get("x-napier-diagnostics-sha256")).toBe(
    createHash("sha256")
      .update(JSON.stringify(verification.diagnostics))
      .digest("hex"),
  );
  expect(response.headers.get("x-napier-signature-valid")).toBe(
    String(verification.signatureValid),
  );
  expect(response.headers.get("x-napier-integrity-valid")).toBe(
    String(verification.integrityValid),
  );
  expect(response.headers.get("x-napier-directory-binding-valid")).toBe(
    String(verification.directoryBindingValid),
  );
  expect(response.headers.get("x-napier-signature-key-id")).toBe(
    verification.signerKeyId ?? null,
  );
  expect(response.headers.get("x-napier-envelope-sha256")).toBe(
    verification.envelopeSha256 ?? null,
  );
  expect(
    response.headers.get("x-napier-receipt-trust-anchor-directory-sha256"),
  ).toBe(verification.directorySha256 ?? null);
  expect(
    response.headers.get(
      "x-napier-receipt-trust-anchor-directory-anchor-set-sha256",
    ),
  ).toBe(verification.anchorSetSha256 ?? null);
}

function expectTrustedReceiptVerificationHeaders(
  response: Response,
  verification: TrustedReceiptVerification,
): void {
  const contentSha256 = createHash("sha256")
    .update(JSON.stringify(verification))
    .digest("hex");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(contentSha256);
  expect(response.headers.get("x-napier-receipt-verification-status")).toBe(
    verification.status,
  );
  expect(response.headers.get("x-napier-signature-valid")).toBe(
    String(verification.signatureValid),
  );
  expect(response.headers.get("x-napier-integrity-valid")).toBe(
    String(verification.integrityValid),
  );
  expect(response.headers.get("x-napier-receipt-kind")).toBe(
    verification.receiptKind ?? null,
  );
  expect(response.headers.get("x-napier-receipt-sha256")).toBe(
    verification.receiptContentSha256 ?? null,
  );
  expect(response.headers.get("x-napier-receipt-artifact-sha256")).toBe(
    verification.receiptArtifactSha256 ?? null,
  );
  expect(response.headers.get("x-napier-signature-key-id")).toBe(
    verification.keyId ?? null,
  );
  expect(response.headers.get("x-napier-envelope-sha256")).toBe(
    verification.envelopeSha256 ?? null,
  );
  expect(
    response.headers.get("x-napier-receipt-trust-anchor-directory-sha256"),
  ).toBe(verification.anchorDirectorySha256 ?? null);
  expect(
    response.headers.get("x-napier-receipt-trust-anchor-directory-source"),
  ).toBe(verification.anchorDirectorySource ?? null);
  expect(
    response.headers.get(
      "x-napier-receipt-trust-directory-quorum-activation-selection-id",
    ),
  ).toBe(verification.anchorDirectorySelectionId ?? null);
  expect(
    response.headers.get(
      "x-napier-receipt-trust-directory-quorum-activation-selection-sha256",
    ),
  ).toBe(verification.anchorDirectorySelectionSha256 ?? null);
  expect(
    response.headers.get(
      "x-napier-receipt-trust-directory-quorum-activation-selection-state-sha256",
    ),
  ).toBe(verification.anchorDirectorySelectionStateSha256 ?? null);
  expect(
    response.headers.get(
      "x-napier-receipt-trust-anchor-directory-verification-sha256",
    ),
  ).toBe(verification.anchorDirectoryVerificationSha256 ?? null);
  expect(
    response.headers.get(
      "x-napier-receipt-trust-anchor-directory-policy-sha256",
    ),
  ).toBe(verification.anchorDirectoryPolicySha256 ?? null);
  expect(
    response.headers.get(
      "x-napier-receipt-trust-anchor-directory-generated-at",
    ),
  ).toBe(verification.anchorDirectoryGeneratedAt ?? null);
  expect(
    response.headers.get("x-napier-receipt-trust-anchor-directory-age-ms"),
  ).toBe(
    verification.anchorDirectoryAgeMs === undefined
      ? null
      : String(verification.anchorDirectoryAgeMs),
  );
  expect(
    response.headers.get(
      "x-napier-receipt-trust-anchor-directory-anchor-count",
    ),
  ).toBe(
    verification.anchorDirectoryAnchorCount === undefined
      ? null
      : String(verification.anchorDirectoryAnchorCount),
  );
}

function expectPromoteEvaluationQualificationBaselineResultHeaders(
  response: Response,
  result: PromoteEvaluationQualificationBaselineResult,
): void {
  const contentSha256 = createHash("sha256")
    .update(JSON.stringify(result))
    .digest("hex");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(contentSha256);
  expect(response.headers.get("x-napier-casebook-id")).toBe(
    result.baseline.casebookId,
  );
  expect(response.headers.get("x-napier-casebook-revision")).toBe(
    String(result.baseline.casebookRevision),
  );
  expect(response.headers.get("x-napier-qualification-baseline-created")).toBe(
    String(result.created),
  );
  expect(response.headers.get("x-napier-qualification-baseline-id")).toBe(
    result.baseline.id,
  );
  expect(response.headers.get("x-napier-qualification-baseline-sha256")).toBe(
    result.baseline.contentSha256,
  );
  expect(response.headers.get("x-napier-qualification-execution-id")).toBe(
    result.baseline.qualificationExecutionId,
  );
  expect(response.headers.get("x-napier-qualification-execution-sha256")).toBe(
    result.baseline.qualificationExecutionSha256,
  );
  expect(response.headers.get("x-napier-receipt-sha256")).toBe(
    result.baseline.envelope.receipt.contentSha256,
  );
  expect(response.headers.get("x-napier-receipt-artifact-sha256")).toBe(
    result.baseline.envelope.signature.receiptArtifactSha256,
  );
  expect(response.headers.get("x-napier-envelope-sha256")).toBe(
    result.baseline.envelope.contentSha256,
  );
  expect(response.headers.get("x-napier-signature-key-id")).toBe(
    result.baseline.envelope.signature.keyId,
  );
}

function expectEvaluationQualificationBaselineListHeaders(
  response: Response,
  casebookId: string,
  baselines: EvaluationQualificationBaseline[],
): void {
  const contentSha256 = createHash("sha256")
    .update(JSON.stringify(baselines))
    .digest("hex");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(contentSha256);
  expect(response.headers.get("x-napier-casebook-id")).toBe(casebookId);
  expect(response.headers.get("x-napier-qualification-baseline-count")).toBe(
    String(baselines.length),
  );
  const current = baselines.at(-1);
  if (current) {
    expect(response.headers.get("x-napier-qualification-baseline-id")).toBe(
      current.id,
    );
    expect(response.headers.get("x-napier-qualification-baseline-sha256")).toBe(
      current.contentSha256,
    );
    expect(response.headers.get("x-napier-qualification-execution-id")).toBe(
      current.qualificationExecutionId,
    );
    expect(
      response.headers.get("x-napier-qualification-execution-sha256"),
    ).toBe(current.qualificationExecutionSha256);
  } else {
    expect(response.headers.get("x-napier-qualification-baseline-id")).toBe(
      null,
    );
    expect(response.headers.get("x-napier-qualification-baseline-sha256")).toBe(
      null,
    );
    expect(response.headers.get("x-napier-qualification-execution-id")).toBe(
      null,
    );
    expect(
      response.headers.get("x-napier-qualification-execution-sha256"),
    ).toBe(null);
  }
}
