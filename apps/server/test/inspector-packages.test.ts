import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  ExtensionPublisherTrustAnchor,
  InspectorPackageQualification,
  InspectorPackageVerification,
  SignedInspectorPackageEnvelope,
} from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import {
  createApp,
  createServices as createNapierServices,
} from "../src/app.js";

const SIGNING_ENV = "NAPIER_TEST_SERVER_INSPECTOR_PACKAGE_KEY";
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

function jsonRequest(value: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  };
}

async function createFixture() {
  const root = await mkdtemp(
    path.join(tmpdir(), "napier-server-inspectorpkg-"),
  );
  temporaryRoots.push(root);
  const services = await createNapierServices({
    dataRoot: path.join(root, "data"),
    workspaceRoot: path.join(root, "workspace"),
  });
  openServices.push(services);
  return { services, app: createApp(services) };
}

function installSigningKey(): void {
  const { privateKey } = generateKeyPairSync("ed25519");
  process.env[SIGNING_ENV] = privateKey
    .export({ format: "pem", type: "pkcs8" })
    .toString();
}

function responseSha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function expectInspectorPackageVerificationHeaders(
  response: Response,
  verification: InspectorPackageVerification,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    responseSha256(verification),
  );
  expect(response.headers.get("x-napier-inspector-package-status")).toBe(
    verification.status,
  );
  expect(response.headers.get("x-napier-inspector-count")).toBe(
    String(verification.panelCount),
  );
  expect(response.headers.get("x-napier-manifest-sha256")).toBe(
    verification.manifestSha256 ?? null,
  );
  expect(
    response.headers.get("x-napier-inspector-package-envelope-sha256"),
  ).toBe(verification.envelopeSha256 ?? null);
  expect(response.headers.get("x-napier-signature-key-id")).toBe(
    verification.keyId ?? null,
  );
}

function expectInspectorPackageQualificationHeaders(
  response: Response,
  qualification: InspectorPackageQualification,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    responseSha256(qualification),
  );
  expect(response.headers.get("x-napier-inspector-package-status")).toBe(
    qualification.status,
  );
  expect(
    response.headers.get("x-napier-inspector-package-verification-status"),
  ).toBe(qualification.verificationStatus);
  expect(response.headers.get("x-napier-inspector-count")).toBe(
    String(qualification.panelCount),
  );
  expect(response.headers.get("x-napier-manifest-sha256")).toBe(
    qualification.manifestSha256 ?? null,
  );
  expect(
    response.headers.get("x-napier-inspector-package-envelope-sha256"),
  ).toBe(qualification.envelopeSha256 ?? null);
  expect(response.headers.get("x-napier-inspector-catalog-sha256")).toBe(
    qualification.inspectorCatalogSha256 ?? null,
  );
  expect(
    response.headers.get("x-napier-observed-inspector-catalog-sha256"),
  ).toBe(qualification.observedInspectorCatalogSha256 ?? null);
  expect(response.headers.get("x-napier-signature-key-id")).toBe(
    qualification.keyId ?? null,
  );
}

describe("signed Inspector package API", () => {
  it("signs, verifies, and qualifies the Workbench Inspector catalog", async () => {
    installSigningKey();
    const { services, app } = await createFixture();
    const thread = services.store.listThreads()[0]!;

    const anchorResponse = await app.request(
      "/api/extensions/publishers",
      jsonRequest({
        threadId: thread.id,
        label: "Inspector package signer",
        source: { type: "environment", variable: SIGNING_ENV },
      }),
    );
    expect(anchorResponse.status).toBe(201);
    const anchor =
      (await anchorResponse.json()) as ExtensionPublisherTrustAnchor;

    const signResponse = await app.request(
      "/api/inspectors/packages/sign",
      jsonRequest({
        threadId: thread.id,
        trustAnchorId: anchor.id,
        publisher: "Napier Inspector Registry",
      }),
    );
    expect(signResponse.status).toBe(200);
    const envelope =
      (await signResponse.json()) as SignedInspectorPackageEnvelope;
    expect(signResponse.headers.get("cache-control")).toBe("no-store");
    expect(signResponse.headers.get("x-napier-content-sha256")).toBe(
      envelope.contentSha256,
    );
    expect(signResponse.headers.get("x-napier-manifest-sha256")).toBe(
      envelope.manifest.contentSha256,
    );
    expect(signResponse.headers.get("x-napier-inspector-catalog-sha256")).toBe(
      envelope.manifest.inspectorCatalogSha256,
    );
    expect(signResponse.headers.get("x-napier-inspector-count")).toBe(
      String(envelope.manifest.panels.length),
    );

    const verifyResponse = await app.request(
      "/api/inspectors/packages/verify",
      jsonRequest({ envelope }),
    );
    expect(verifyResponse.status).toBe(200);
    const verification =
      (await verifyResponse.json()) as InspectorPackageVerification;
    expectInspectorPackageVerificationHeaders(verifyResponse, verification);
    expect(verification).toEqual(
      expect.objectContaining({
        status: "trusted",
        panelCount: envelope.manifest.panels.length,
        manifestSha256: envelope.manifest.contentSha256,
        envelopeSha256: envelope.contentSha256,
        keyId: anchor.keyId,
      }),
    );

    const qualifyResponse = await app.request(
      "/api/inspectors/packages/qualify",
      jsonRequest({ threadId: thread.id, envelope }),
    );
    expect(qualifyResponse.status).toBe(200);
    const qualification =
      (await qualifyResponse.json()) as InspectorPackageQualification;
    expectInspectorPackageQualificationHeaders(qualifyResponse, qualification);
    expect(qualification).toEqual(
      expect.objectContaining({
        status: "qualified",
        verificationStatus: "trusted",
        panelCount: envelope.manifest.panels.length,
        manifestSha256: envelope.manifest.contentSha256,
        envelopeSha256: envelope.contentSha256,
        inspectorCatalogSha256: envelope.manifest.inspectorCatalogSha256,
        observedInspectorCatalogSha256:
          envelope.manifest.inspectorCatalogSha256,
        keyId: anchor.keyId,
      }),
    );

    const events = await services.store.listEvents(thread.id);
    const signedEvent = events.find(
      (event) => event.type === "inspector.package.signed",
    );
    expect(signedEvent?.payload).toEqual(
      expect.objectContaining({
        manifestSha256: envelope.manifest.contentSha256,
        envelopeSha256: envelope.contentSha256,
        inspectorCatalogSha256: envelope.manifest.inspectorCatalogSha256,
        panelCount: envelope.manifest.panels.length,
        keyId: anchor.keyId,
        panelIdsSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(JSON.stringify(signedEvent?.payload)).not.toContain("Run Lab");
    const qualifiedEvent = events.find(
      (event) => event.type === "inspector.package.qualified",
    );
    expect(qualifiedEvent?.payload).toEqual(
      expect.objectContaining({
        status: "qualified",
        verificationStatus: "trusted",
        panelCount: envelope.manifest.panels.length,
        manifestSha256: envelope.manifest.contentSha256,
        envelopeSha256: envelope.contentSha256,
        inspectorCatalogSha256: envelope.manifest.inspectorCatalogSha256,
        observedInspectorCatalogSha256:
          envelope.manifest.inspectorCatalogSha256,
        keyId: anchor.keyId,
      }),
    );
    expect(JSON.stringify(qualifiedEvent?.payload)).not.toContain("Run Lab");
  });
});
