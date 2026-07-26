import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  ApplyExtensionPackageUpdateResult,
  BootstrapResponse,
  ExtensionPackageUpdatePreview,
  ExtensionPackageVerification,
  ExtensionPublisherTrustAnchor,
  ExtensionRecord,
  SignedExtensionPackageEnvelope,
} from "@napier/contracts";
import {
  createMcpExtension,
  McpExtensionManager,
  mergeDiscoveredMcpTools,
  reviewExtensionRecord,
  reviewMcpToolRecord,
  signExtensionPackage,
} from "@napier/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createApp,
  createServices as createNapierServices,
} from "../src/app.js";

const SIGNING_ENV = "NAPIER_TEST_SERVER_EXTENSION_PACKAGE_KEY";
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

async function createServices(label: string) {
  const root = await mkdtemp(
    path.join(tmpdir(), `napier-server-extension-${label}-`),
  );
  temporaryRoots.push(root);
  const services = await createNapierServices({
    dataRoot: path.join(root, "data"),
    workspaceRoot: path.join(root, "workspace"),
  });
  openServices.push(services);
  return services;
}

function jsonRequest(value: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  };
}

function firstOrThrow<T>(values: T[], label: string): T {
  const value = values[0];
  if (!value) throw new Error(`Expected ${label}`);
  return value;
}

function expectExtensionPublisherTrustAnchorListHeaders(
  response: Response,
  anchors: ExtensionPublisherTrustAnchor[],
): void {
  const contentSha256 = createHash("sha256")
    .update(JSON.stringify(anchors))
    .digest("hex");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(contentSha256);
  expect(
    response.headers.get("x-napier-extension-publisher-trust-anchor-count"),
  ).toBe(String(anchors.length));
  expect(
    response.headers.get("x-napier-extension-publisher-trust-trusted-count"),
  ).toBe(
    String(anchors.filter((anchor) => anchor.status === "trusted").length),
  );
  expect(
    response.headers.get("x-napier-extension-publisher-trust-revoked-count"),
  ).toBe(
    String(anchors.filter((anchor) => anchor.status === "revoked").length),
  );
  expect(
    response.headers.get(
      "x-napier-extension-publisher-trust-signing-capable-count",
    ),
  ).toBe(
    String(anchors.filter((anchor) => Boolean(anchor.signingSource)).length),
  );
}

function expectExtensionPublisherTrustAnchorHeaders(
  response: Response,
  anchor: ExtensionPublisherTrustAnchor,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    anchor.contentSha256,
  );
  expect(
    response.headers.get("x-napier-extension-publisher-trust-anchor-id"),
  ).toBe(anchor.id);
  expect(response.headers.get("x-napier-signature-key-id")).toBe(anchor.keyId);
  expect(
    response.headers.get("x-napier-extension-publisher-trust-anchor-status"),
  ).toBe(anchor.status);
  expect(
    response.headers.get("x-napier-extension-publisher-trust-signing-capable"),
  ).toBe(String(Boolean(anchor.signingSource)));
}

function responseSha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function expectExtensionPackageVerificationHeaders(
  response: Response,
  verification: ExtensionPackageVerification,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    responseSha256(verification),
  );
  expect(response.headers.get("x-napier-extension-package-status")).toBe(
    verification.status,
  );
  expect(
    response.headers.get("x-napier-extension-package-signature-valid"),
  ).toBe(String(verification.signatureValid));
  expect(
    response.headers.get("x-napier-extension-package-integrity-valid"),
  ).toBe(String(verification.integrityValid));
  expect(
    response.headers.get("x-napier-extension-package-configuration-valid"),
  ).toBe(String(verification.configurationValid));
  expect(
    response.headers.get("x-napier-extension-package-executable-valid"),
  ).toBe(
    verification.executableValid === undefined
      ? null
      : String(verification.executableValid),
  );
  expect(response.headers.get("x-napier-signature-key-id")).toBe(
    verification.keyId ?? null,
  );
  expect(response.headers.get("x-napier-manifest-sha256")).toBe(
    verification.manifestSha256 ?? null,
  );
  expect(
    response.headers.get("x-napier-extension-package-envelope-sha256"),
  ).toBe(verification.envelopeSha256 ?? null);
  expect(
    response.headers.get("x-napier-extension-package-transport-sha256"),
  ).toBe(verification.transportSha256 ?? null);
}

function expectExtensionPackageUpdatePreviewHeaders(
  response: Response,
  preview: ExtensionPackageUpdatePreview,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    preview.contentSha256,
  );
  expect(response.headers.get("x-napier-extension-id")).toBe(
    preview.extensionId,
  );
  expect(response.headers.get("x-napier-extension-package-update-sha256")).toBe(
    preview.contentSha256,
  );
  expect(
    response.headers.get("x-napier-extension-package-binding-sha256"),
  ).toBe(preview.expectedPackageBindingSha256);
  expect(
    response.headers.get("x-napier-extension-package-current-manifest-sha256"),
  ).toBe(preview.current.manifestSha256);
  expect(
    response.headers.get("x-napier-extension-package-next-manifest-sha256"),
  ).toBe(preview.next.manifestSha256);
  expect(
    response.headers.get("x-napier-extension-package-version-direction"),
  ).toBe(preview.versionDirection);
  expect(
    response.headers.get(
      "x-napier-extension-package-requires-publisher-confirmation",
    ),
  ).toBe(String(preview.requiresPublisherConfirmation));
  expect(
    response.headers.get(
      "x-napier-extension-package-requires-version-override",
    ),
  ).toBe(String(preview.requiresVersionOverride));
  expect(response.headers.get("x-napier-extension-package-change-count")).toBe(
    String(preview.changes.length),
  );
  expect(
    response.headers.get("x-napier-extension-package-added-capability-count"),
  ).toBe(String(preview.capabilitiesAdded.length));
  expect(
    response.headers.get("x-napier-extension-package-removed-capability-count"),
  ).toBe(String(preview.capabilitiesRemoved.length));
  expect(
    response.headers.get("x-napier-extension-package-tool-added-count"),
  ).toBe(String(preview.tools.added.length));
  expect(
    response.headers.get("x-napier-extension-package-tool-removed-count"),
  ).toBe(String(preview.tools.removed.length));
  expect(response.headers.get("x-napier-extension-package-no-changes")).toBe(
    String(preview.noChanges),
  );
}

function expectExtensionPackageUpdateResultHeaders(
  response: Response,
  result: ApplyExtensionPackageUpdateResult,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    responseSha256(result),
  );
  expect(response.headers.get("x-napier-extension-id")).toBe(
    result.extension.id,
  );
  expect(response.headers.get("x-napier-extension-package-update-sha256")).toBe(
    result.preview.contentSha256,
  );
  expect(
    response.headers.get("x-napier-extension-package-binding-sha256"),
  ).toBe(result.preview.expectedPackageBindingSha256);
  expect(response.headers.get("x-napier-extension-package-updated")).toBe(
    String(result.updated),
  );
  expect(
    response.headers.get("x-napier-extension-package-version-direction"),
  ).toBe(result.preview.versionDirection);
  expect(response.headers.get("x-napier-extension-package-history-count")).toBe(
    String(result.extension.packageHistory?.length ?? 0),
  );
  expect(response.headers.get("x-napier-extension-revision")).toBe(
    String(result.extension.revision),
  );
}

async function createUpdateEnvelope(
  anchor: ExtensionPublisherTrustAnchor,
): Promise<SignedExtensionPackageEnvelope> {
  let extension = createMcpExtension({
    name: "Portable records",
    description: "Private package description",
    version: "1.6.0",
    transport: {
      type: "streamable_http",
      url: "https://example.com/mcp",
    },
    requestedCapabilities: ["external.read"],
  });
  extension = reviewExtensionRecord(extension, { action: "approve" });
  extension = mergeDiscoveredMcpTools(extension, [
    {
      name: "search",
      description: "Search signed records",
      inputSchema: { type: "object" },
    },
  ]);
  extension = reviewMcpToolRecord(extension, "search", {
    action: "approve",
    effect: "read",
  });
  return signExtensionPackage(extension, "Napier Test Publisher", anchor);
}

describe("signed Extension package API", () => {
  it("publishes, verifies, imports, audits, and revokes across workspaces", async () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    process.env[SIGNING_ENV] = privateKey
      .export({ format: "pem", type: "pkcs8" })
      .toString();

    const publisherServices = await createServices("publisher");
    publisherServices.extensions = new McpExtensionManager({
      store: publisherServices.store,
      createClient: async () => ({
        initialize: async () => undefined,
        listTools: async () => ({
          tools: [
            {
              name: "search",
              description: "Search signed records",
              inputSchema: { type: "object" },
            },
          ],
        }),
        callTool: async () => ({
          contentText: "Signed result",
          isError: false,
        }),
        close: async () => undefined,
      }),
    });
    const publisherApp = createApp(publisherServices);
    const publisherThread = firstOrThrow(
      publisherServices.store.listThreads(),
      "publisher Thread",
    );

    const anchorResponse = await publisherApp.request(
      "/api/extensions/publishers",
      jsonRequest({
        threadId: publisherThread.id,
        label: "Server package publisher",
        source: { type: "environment", variable: SIGNING_ENV },
      }),
    );
    expect(anchorResponse.status).toBe(201);
    const anchor =
      (await anchorResponse.json()) as ExtensionPublisherTrustAnchor;
    expectExtensionPublisherTrustAnchorHeaders(anchorResponse, anchor);

    const publisherAnchorListResponse = await publisherApp.request(
      "/api/extensions/publishers",
    );
    expect(publisherAnchorListResponse.status).toBe(200);
    const publisherAnchors =
      (await publisherAnchorListResponse.json()) as ExtensionPublisherTrustAnchor[];
    expectExtensionPublisherTrustAnchorListHeaders(
      publisherAnchorListResponse,
      publisherAnchors,
    );
    expect(publisherAnchors).toEqual([anchor]);

    const proposalResponse = await publisherApp.request(
      "/api/extensions/mcp",
      jsonRequest({
        threadId: publisherThread.id,
        name: "Portable records",
        description: "Private package description",
        version: "1.5.0",
        transport: {
          type: "streamable_http",
          url: "https://example.com/mcp",
        },
        requestedCapabilities: ["external.read"],
      }),
    );
    const proposed = (await proposalResponse.json()) as ExtensionRecord;
    await publisherApp.request(
      `/api/extensions/${proposed.id}/review`,
      jsonRequest({
        threadId: publisherThread.id,
        action: "approve",
      }),
    );
    await publisherApp.request(
      `/api/extensions/${proposed.id}/connect`,
      jsonRequest({ threadId: publisherThread.id }),
    );
    await publisherApp.request(
      `/api/extensions/${proposed.id}/tools/review`,
      jsonRequest({
        threadId: publisherThread.id,
        toolName: "search",
        action: "approve",
        effect: "read",
      }),
    );

    const signResponse = await publisherApp.request(
      `/api/extensions/${proposed.id}/package/sign`,
      jsonRequest({
        threadId: publisherThread.id,
        trustAnchorId: anchor.id,
        publisher: "Napier Test Publisher",
      }),
    );
    expect(signResponse.status).toBe(200);
    expect(signResponse.headers.get("cache-control")).toBe("no-store");
    expect(signResponse.headers.get("content-disposition")).toContain(
      "portable_records.napier-extension.json",
    );
    const envelope =
      (await signResponse.json()) as SignedExtensionPackageEnvelope;
    expect(signResponse.headers.get("x-napier-content-sha256")).toBe(
      envelope.contentSha256,
    );

    const verifyResponse = await publisherApp.request(
      "/api/extensions/packages/verify",
      jsonRequest({ envelope }),
    );
    expect(verifyResponse.status).toBe(200);
    const verification =
      (await verifyResponse.json()) as ExtensionPackageVerification;
    expectExtensionPackageVerificationHeaders(verifyResponse, verification);
    expect(verification).toEqual(
      expect.objectContaining({
        status: "trusted",
        signatureValid: true,
      }),
    );

    const importerServices = await createServices("importer");
    const importerClose = vi.fn(async () => undefined);
    importerServices.extensions = new McpExtensionManager({
      store: importerServices.store,
      createClient: async () => ({
        initialize: async () => undefined,
        listTools: async () => ({
          tools: [
            {
              name: "search",
              description: "Search signed records",
              inputSchema: { type: "object" },
            },
          ],
        }),
        callTool: async () => ({
          contentText: "Imported signed result",
          isError: false,
        }),
        close: importerClose,
      }),
    });
    const importerApp = createApp(importerServices);
    const importerThread = firstOrThrow(
      importerServices.store.listThreads(),
      "importer Thread",
    );
    const importedAnchorResponse = await importerApp.request(
      "/api/extensions/publishers",
      jsonRequest({
        threadId: importerThread.id,
        label: "Publisher public key",
        source: {
          type: "public_key",
          publicKeySpki: anchor.publicKeySpki,
        },
      }),
    );
    expect(importedAnchorResponse.status).toBe(201);
    const importedAnchor =
      (await importedAnchorResponse.json()) as ExtensionPublisherTrustAnchor;
    expectExtensionPublisherTrustAnchorHeaders(
      importedAnchorResponse,
      importedAnchor,
    );

    const importerAnchorListResponse = await importerApp.request(
      "/api/extensions/publishers",
    );
    expect(importerAnchorListResponse.status).toBe(200);
    const importerAnchors =
      (await importerAnchorListResponse.json()) as ExtensionPublisherTrustAnchor[];
    expectExtensionPublisherTrustAnchorListHeaders(
      importerAnchorListResponse,
      importerAnchors,
    );
    expect(importerAnchors).toEqual([importedAnchor]);

    const importResponse = await importerApp.request(
      "/api/extensions/packages/import",
      jsonRequest({ threadId: importerThread.id, envelope }),
    );
    expect(importResponse.status).toBe(201);
    const imported = (await importResponse.json()) as ExtensionRecord;
    expect(imported).toEqual(
      expect.objectContaining({
        trustStatus: "pending",
        approvedCapabilities: [],
        enabledAgentIds: [],
        provenance: expect.objectContaining({ source: "signed_package" }),
      }),
    );
    const bootstrap = (await (
      await importerApp.request("/api/bootstrap")
    ).json()) as BootstrapResponse;
    expect(bootstrap.extensionPublisherTrustAnchors).toEqual([
      expect.objectContaining({ keyId: anchor.keyId, status: "trusted" }),
    ]);

    await importerApp.request(
      `/api/extensions/${imported.id}/review`,
      jsonRequest({
        threadId: importerThread.id,
        action: "approve",
      }),
    );
    const importedConnection = await importerApp.request(
      `/api/extensions/${imported.id}/connect`,
      jsonRequest({ threadId: importerThread.id }),
    );
    expect(
      ((await importedConnection.json()) as ExtensionRecord).connection.status,
    ).toBe("ready");
    const updateEnvelope = await createUpdateEnvelope(anchor);
    const previewResponse = await importerApp.request(
      `/api/extensions/${imported.id}/package/update/preview`,
      jsonRequest({ envelope: updateEnvelope }),
    );
    expect(previewResponse.status).toBe(200);
    const preview =
      (await previewResponse.json()) as ExtensionPackageUpdatePreview;
    expectExtensionPackageUpdatePreviewHeaders(previewResponse, preview);
    expect(preview).toEqual(
      expect.objectContaining({
        extensionId: imported.id,
        versionDirection: "upgrade",
        publisherChanged: false,
        resetsLocalReview: true,
      }),
    );
    const staleUpdateResponse = await importerApp.request(
      `/api/extensions/${imported.id}/package/update`,
      jsonRequest({
        threadId: importerThread.id,
        envelope: updateEnvelope,
        expectedPackageBindingSha256: "0".repeat(64),
      }),
    );
    expect(staleUpdateResponse.status).toBe(409);
    expect(importerClose).not.toHaveBeenCalled();
    const updateResponse = await importerApp.request(
      `/api/extensions/${imported.id}/package/update`,
      jsonRequest({
        threadId: importerThread.id,
        envelope: updateEnvelope,
        expectedPackageBindingSha256: preview.expectedPackageBindingSha256,
      }),
    );
    expect(updateResponse.status).toBe(200);
    const updateResult =
      (await updateResponse.json()) as ApplyExtensionPackageUpdateResult;
    expectExtensionPackageUpdateResultHeaders(updateResponse, updateResult);
    expect(updateResult).toEqual(
      expect.objectContaining({
        updated: true,
        extension: expect.objectContaining({
          id: imported.id,
          version: "1.6.0",
          trustStatus: "pending",
          approvedCapabilities: [],
          enabledAgentIds: [],
          tools: [],
          connection: expect.objectContaining({ status: "disconnected" }),
          packageHistory: [expect.objectContaining({ sequence: 1 })],
        }),
      }),
    );
    expect(importerClose).toHaveBeenCalledTimes(1);

    const revokeResponse = await importerApp.request(
      `/api/extensions/publishers/${importedAnchor.id}/revoke`,
      jsonRequest({ threadId: importerThread.id }),
    );
    expect(revokeResponse.status).toBe(200);
    const revokedAnchor =
      (await revokeResponse.json()) as ExtensionPublisherTrustAnchor;
    expectExtensionPublisherTrustAnchorHeaders(revokeResponse, revokedAnchor);
    expect(revokedAnchor).toEqual(
      expect.objectContaining({ status: "revoked" }),
    );

    const revokedAnchorListResponse = await importerApp.request(
      "/api/extensions/publishers",
    );
    expect(revokedAnchorListResponse.status).toBe(200);
    const revokedAnchors =
      (await revokedAnchorListResponse.json()) as ExtensionPublisherTrustAnchor[];
    expectExtensionPublisherTrustAnchorListHeaders(
      revokedAnchorListResponse,
      revokedAnchors,
    );
    expect(revokedAnchors).toEqual([revokedAnchor]);

    expect(
      importerServices.store.getExtension(imported.id).connection.status,
    ).toBe("disconnected");

    const publisherDetail = await publisherServices.store.getDetail(
      publisherThread.id,
    );
    expect(publisherDetail.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "extension.publisher.created",
        "extension.package.signed",
      ]),
    );
    const importerDetail = await importerServices.store.getDetail(
      importerThread.id,
    );
    expect(importerDetail.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "extension.publisher.created",
        "extension.package.imported",
        "extension.package.updated",
        "extension.publisher.revoked",
      ]),
    );
    expect(JSON.stringify(importerDetail.events)).not.toContain(
      envelope.manifest.description,
    );
  });
});
