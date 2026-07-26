import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  ApplyExtensionPackageDeploymentResult,
  ApplyExtensionPackageRolloutChannelResult,
  ExtensionPackageChannelIndexVerification,
  ExtensionPackageDependency,
  ExtensionPackageDeploymentPreview,
  ExtensionPackageLockfile,
  ExtensionPackageLockfileVerification,
  ExtensionPackageRolloutChannel,
  ExtensionPackageRolloutPreview,
  ExtensionPublisherTrustAnchor,
  SignedExtensionPackageChannelIndexEnvelope,
  ExtensionRecord,
  SignedExtensionPackageEnvelope,
} from "@napier/contracts";
import {
  createExtensionPublisherTrustAnchor,
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

const SIGNING_ENV = "NAPIER_TEST_SERVER_DEPLOYMENT_KEY";
const INDEX_SIGNING_ENV = "NAPIER_TEST_SERVER_CHANNEL_INDEX_KEY";
const temporaryRoots: string[] = [];
const openServices: Awaited<ReturnType<typeof createNapierServices>>[] = [];

afterEach(async () => {
  delete process.env[SIGNING_ENV];
  delete process.env[INDEX_SIGNING_ENV];
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

async function createServices() {
  const root = await mkdtemp(
    path.join(tmpdir(), "napier-server-package-deployment-"),
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

function createAnchor(): ExtensionPublisherTrustAnchor {
  const { privateKey } = generateKeyPairSync("ed25519");
  process.env[SIGNING_ENV] = privateKey
    .export({ format: "pem", type: "pkcs8" })
    .toString();
  return createExtensionPublisherTrustAnchor({
    threadId: "thread_deployment",
    label: "Deployment signer",
    source: { type: "environment", variable: SIGNING_ENV },
  });
}

function createIndexAnchor(): ExtensionPublisherTrustAnchor {
  const { privateKey } = generateKeyPairSync("ed25519");
  process.env[INDEX_SIGNING_ENV] = privateKey
    .export({ format: "pem", type: "pkcs8" })
    .toString();
  return createExtensionPublisherTrustAnchor({
    threadId: "thread_deployment",
    label: "Channel index signer",
    source: { type: "environment", variable: INDEX_SIGNING_ENV },
  });
}

async function createPackage(
  anchor: ExtensionPublisherTrustAnchor,
  options: {
    name: string;
    version: string;
    description: string;
    dependencies?: ExtensionPackageDependency[];
  },
): Promise<SignedExtensionPackageEnvelope> {
  let extension = createMcpExtension({
    name: options.name,
    description: options.description,
    version: options.version,
    transport: {
      type: "streamable_http",
      url: `https://example.com/${options.name.toLowerCase().replace(/\s+/g, "-")}`,
    },
    requestedCapabilities: ["external.read"],
  });
  extension = reviewExtensionRecord(extension, { action: "approve" });
  extension = mergeDiscoveredMcpTools(extension, [
    {
      name: "read",
      description: `Read through ${options.name}`,
      inputSchema: { type: "object" },
    },
  ]);
  extension = reviewMcpToolRecord(extension, "read", {
    action: "approve",
    effect: "read",
  });
  return signExtensionPackage(
    extension,
    "Napier Deployment Publisher",
    anchor,
    {
      ...(options.dependencies ? { dependencies: options.dependencies } : {}),
    },
  );
}

function responseSha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function expectExtensionPackageLockfileHeaders(
  response: Response,
  lockfile: ExtensionPackageLockfile,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    lockfile.contentSha256,
  );
  expect(response.headers.get("x-napier-package-count")).toBe(
    String(lockfile.packages.length),
  );
  expect(
    response.headers.get("x-napier-extension-package-dependency-count"),
  ).toBe(
    String(
      lockfile.packages.reduce(
        (total, entry) => total + entry.dependencies.length,
        0,
      ),
    ),
  );
  expect(
    response.headers.get("x-napier-extension-package-envelope-set-sha256"),
  ).toBe(
    responseSha256(
      lockfile.packages.map((entry) => entry.envelopeSha256).sort(),
    ),
  );
  expect(
    response.headers.get("x-napier-extension-package-name-set-sha256"),
  ).toBe(
    responseSha256(
      lockfile.packages.map((entry) => entry.normalizedName).sort(),
    ),
  );
  expect(
    response.headers.get("x-napier-extension-package-publisher-key-set-sha256"),
  ).toBe(
    responseSha256(
      [...new Set(lockfile.packages.map((entry) => entry.keyId))].sort(),
    ),
  );
}

function expectExtensionPackageDeploymentPreviewHeaders(
  response: Response,
  preview: ExtensionPackageDeploymentPreview,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    preview.contentSha256,
  );
  expect(
    response.headers.get("x-napier-extension-package-deployment-sha256"),
  ).toBe(preview.contentSha256);
  expect(
    response.headers.get("x-napier-extension-package-candidate-count"),
  ).toBe(String(preview.candidateCount));
  expect(response.headers.get("x-napier-extension-package-install-count")).toBe(
    String(preview.installCount),
  );
  expect(response.headers.get("x-napier-extension-package-update-count")).toBe(
    String(preview.updateCount),
  );
  expect(
    response.headers.get(
      "x-napier-extension-package-dependency-resolution-count",
    ),
  ).toBe(String(preview.resolutions.length));
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
  expect(response.headers.get("x-napier-extension-package-no-changes")).toBe(
    String(preview.noChanges),
  );
}

function expectExtensionPackageDeploymentResultHeaders(
  response: Response,
  result: ApplyExtensionPackageDeploymentResult,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    responseSha256(result),
  );
  expect(
    response.headers.get("x-napier-extension-package-deployment-sha256"),
  ).toBe(result.preview.contentSha256);
  expect(
    response.headers.get("x-napier-extension-package-candidate-count"),
  ).toBe(String(result.preview.candidateCount));
  expect(
    response.headers.get("x-napier-extension-package-applied-extension-count"),
  ).toBe(String(result.extensions.length));
  expect(
    response.headers.get(
      "x-napier-extension-package-installed-extension-count",
    ),
  ).toBe(String(result.installedExtensionIds.length));
  expect(
    response.headers.get("x-napier-extension-package-updated-extension-count"),
  ).toBe(String(result.updatedExtensionIds.length));
  expect(response.headers.get("x-napier-extension-package-no-changes")).toBe(
    String(result.preview.noChanges),
  );
}

function expectExtensionPackageLockfileVerificationHeaders(
  response: Response,
  verification: ExtensionPackageLockfileVerification,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    responseSha256(verification),
  );
  expect(
    response.headers.get("x-napier-extension-package-lockfile-status"),
  ).toBe(verification.status);
  expect(response.headers.get("x-napier-package-count")).toBe(
    String(verification.packageCount),
  );
  expect(
    response.headers.get("x-napier-extension-package-envelope-count"),
  ).toBe(String(verification.packageEnvelopeSha256es.length));
  expect(
    response.headers.get("x-napier-extension-package-lockfile-sha256"),
  ).toBe(verification.lockfileSha256 ?? null);
}

function expectExtensionPackageRolloutChannelListHeaders(
  response: Response,
  channels: ExtensionPackageRolloutChannel[],
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    responseSha256(channels),
  );
  expect(response.headers.get("x-napier-extension-package-rollout-count")).toBe(
    String(channels.length),
  );
  expect(
    response.headers.get("x-napier-extension-package-active-rollout-count"),
  ).toBe(
    String(channels.filter((channel) => channel.status === "active").length),
  );
  expect(response.headers.get("x-napier-package-count")).toBe(
    String(
      channels.reduce((total, channel) => total + channel.packageCount, 0),
    ),
  );
  expect(
    response.headers.get("x-napier-extension-package-dependency-count"),
  ).toBe(
    String(
      channels.reduce((total, channel) => total + channel.dependencyCount, 0),
    ),
  );
}

function expectExtensionPackageRolloutChannelHeaders(
  response: Response,
  channel: ExtensionPackageRolloutChannel,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    channel.contentSha256,
  );
  expect(response.headers.get("x-napier-extension-package-rollout-id")).toBe(
    channel.id,
  );
  expect(
    response.headers.get("x-napier-extension-package-rollout-status"),
  ).toBe(channel.status);
  expect(
    response.headers.get("x-napier-extension-package-rollout-revision"),
  ).toBe(String(channel.revision));
  expect(
    response.headers.get("x-napier-extension-package-lockfile-sha256"),
  ).toBe(channel.lockfileSha256);
  expect(response.headers.get("x-napier-package-count")).toBe(
    String(channel.packageCount),
  );
  expect(
    response.headers.get("x-napier-extension-package-dependency-count"),
  ).toBe(String(channel.dependencyCount));
  expect(
    response.headers.get("x-napier-extension-package-envelope-set-sha256"),
  ).toBe(channel.packageEnvelopeIdsSha256);
  expect(
    response.headers.get("x-napier-extension-package-rollout-policy-sha256"),
  ).toBe(responseSha256(channel.policy));
}

function expectExtensionPackageRolloutPreviewHeaders(
  response: Response,
  preview: ExtensionPackageRolloutPreview,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    preview.contentSha256,
  );
  expect(
    response.headers.get("x-napier-extension-package-rollout-sha256"),
  ).toBe(preview.contentSha256);
  expect(response.headers.get("x-napier-extension-package-rollout-id")).toBe(
    preview.channelId,
  );
  expect(
    response.headers.get("x-napier-extension-package-rollout-revision"),
  ).toBe(String(preview.channelRevision));
  expect(
    response.headers.get("x-napier-extension-package-lockfile-sha256"),
  ).toBe(preview.lockfileSha256);
  expect(
    response.headers.get("x-napier-extension-package-lockfile-status"),
  ).toBe(preview.verification.status);
  expect(
    response.headers.get("x-napier-extension-package-deployment-sha256"),
  ).toBe(preview.deploymentPreview.contentSha256);
  expect(
    response.headers.get("x-napier-extension-package-candidate-count"),
  ).toBe(String(preview.deploymentPreview.candidateCount));
  expect(response.headers.get("x-napier-extension-package-install-count")).toBe(
    String(preview.deploymentPreview.installCount),
  );
  expect(response.headers.get("x-napier-extension-package-update-count")).toBe(
    String(preview.deploymentPreview.updateCount),
  );
}

function expectExtensionPackageRolloutApplyResultHeaders(
  response: Response,
  result: ApplyExtensionPackageRolloutChannelResult,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    responseSha256(result),
  );
  expect(
    response.headers.get("x-napier-extension-package-rollout-sha256"),
  ).toBe(result.rolloutPreview.contentSha256);
  expect(
    response.headers.get("x-napier-extension-package-deployment-sha256"),
  ).toBe(result.deployment.preview.contentSha256);
  expect(response.headers.get("x-napier-extension-package-rollout-id")).toBe(
    result.channel.id,
  );
  expect(
    response.headers.get("x-napier-extension-package-rollout-revision"),
  ).toBe(String(result.channel.revision));
  expect(
    response.headers.get("x-napier-extension-package-lockfile-sha256"),
  ).toBe(result.channel.lockfileSha256);
  expect(
    response.headers.get("x-napier-extension-package-applied-extension-count"),
  ).toBe(String(result.deployment.extensions.length));
  expect(
    response.headers.get(
      "x-napier-extension-package-installed-extension-count",
    ),
  ).toBe(String(result.deployment.installedExtensionIds.length));
  expect(
    response.headers.get("x-napier-extension-package-updated-extension-count"),
  ).toBe(String(result.deployment.updatedExtensionIds.length));
}

function expectExtensionPackageChannelIndexVerificationHeaders(
  response: Response,
  verification: ExtensionPackageChannelIndexVerification,
): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-napier-content-sha256")).toBe(
    responseSha256(verification),
  );
  expect(
    response.headers.get("x-napier-extension-package-channel-index-status"),
  ).toBe(verification.status);
  expect(response.headers.get("x-napier-channel-count")).toBe(
    String(verification.channelCount),
  );
  expect(response.headers.get("x-napier-index-sha256")).toBe(
    verification.indexSha256 ?? null,
  );
  expect(
    response.headers.get("x-napier-extension-package-envelope-sha256"),
  ).toBe(verification.envelopeSha256 ?? null);
  expect(response.headers.get("x-napier-signature-key-id")).toBe(
    verification.keyId ?? null,
  );
}

describe("signed Extension package deployment API", () => {
  it("atomically installs and upgrades a dependency set with hash-only audit", async () => {
    const anchor = createAnchor();
    const services = await createServices();
    const closeClient = vi.fn(async () => undefined);
    services.extensions = new McpExtensionManager({
      store: services.store,
      createClient: async () => ({
        initialize: async () => undefined,
        listTools: async () => ({
          tools: [
            {
              name: "read",
              description: "Read through deployed package",
              inputSchema: { type: "object" },
            },
          ],
        }),
        callTool: async () => ({ contentText: "ok", isError: false }),
        close: closeClient,
      }),
    });
    const app = createApp(services);
    const thread = firstOrThrow(
      services.store.listThreads(),
      "deployment Thread",
    );
    const anchorResponse = await app.request(
      "/api/extensions/publishers",
      jsonRequest({
        threadId: thread.id,
        label: "Deployment verify key",
        source: { type: "public_key", publicKeySpki: anchor.publicKeySpki },
      }),
    );
    expect(anchorResponse.status).toBe(201);

    const providerV1 = await createPackage(anchor, {
      name: "Deployment provider",
      version: "1.0.0",
      description: "Private provider manifest",
    });
    const consumerV1 = await createPackage(anchor, {
      name: "Deployment consumer",
      version: "1.0.0",
      description: "Private consumer manifest",
      dependencies: [
        { normalizedName: "deployment_provider", versionRange: "^1.0.0" },
      ],
    });
    const installPreviewResponse = await app.request(
      "/api/extensions/packages/deployment/preview",
      jsonRequest({ envelopes: [consumerV1, providerV1] }),
    );
    expect(installPreviewResponse.status).toBe(200);
    const installPreview =
      (await installPreviewResponse.json()) as ExtensionPackageDeploymentPreview;
    expectExtensionPackageDeploymentPreviewHeaders(
      installPreviewResponse,
      installPreview,
    );
    expect(installPreview.applyOrder).toEqual([
      "deployment_provider",
      "deployment_consumer",
    ]);
    expect(services.store.listExtensions()).toHaveLength(0);

    const installResponse = await app.request(
      "/api/extensions/packages/deployment",
      jsonRequest({
        threadId: thread.id,
        envelopes: [consumerV1, providerV1],
        expectedDeploymentSha256: installPreview.contentSha256,
      }),
    );
    expect(installResponse.status).toBe(200);
    const installed =
      (await installResponse.json()) as ApplyExtensionPackageDeploymentResult;
    expectExtensionPackageDeploymentResultHeaders(installResponse, installed);
    expect(installed.installedExtensionIds).toHaveLength(2);
    expect(installed.updatedExtensionIds).toEqual([]);

    const invalidLockfileResponse = await app.request(
      "/api/extensions/packages/lockfile/export",
      jsonRequest({
        threadId: thread.id,
        unexpected: true,
      }),
    );
    expect(invalidLockfileResponse.status).toBe(400);
    expect(await invalidLockfileResponse.json()).toEqual(
      expect.objectContaining({
        error: "Extension package lockfile export request is invalid",
      }),
    );

    const lockfileResponse = await app.request(
      "/api/extensions/packages/lockfile/export",
      jsonRequest({ threadId: thread.id }),
    );
    expect(lockfileResponse.status).toBe(200);
    const lockfile =
      (await lockfileResponse.json()) as ExtensionPackageLockfile;
    expectExtensionPackageLockfileHeaders(lockfileResponse, lockfile);
    expect(lockfile.packages.map((entry) => entry.normalizedName)).toEqual([
      "deployment_consumer",
      "deployment_provider",
    ]);
    const verifyLockfileResponse = await app.request(
      "/api/extensions/packages/lockfile/verify",
      jsonRequest({ lockfile }),
    );
    expect(verifyLockfileResponse.status).toBe(200);
    const lockfileVerification =
      (await verifyLockfileResponse.json()) as ExtensionPackageLockfileVerification;
    expectExtensionPackageLockfileVerificationHeaders(
      verifyLockfileResponse,
      lockfileVerification,
    );
    expect(lockfileVerification).toEqual(
      expect.objectContaining({
        status: "trusted",
        packageCount: 2,
        lockfileSha256: lockfile.contentSha256,
      }),
    );

    const invalidRolloutResponse = await app.request(
      "/api/extensions/packages/rollouts",
      jsonRequest({
        threadId: thread.id,
        name: "Stable",
        unexpected: true,
      }),
    );
    expect(invalidRolloutResponse.status).toBe(400);
    expect(await invalidRolloutResponse.json()).toEqual(
      expect.objectContaining({
        error: "Extension package rollout channel request is invalid",
      }),
    );
    expect(services.store.listExtensionPackageRolloutChannels()).toHaveLength(
      0,
    );

    const emptyRolloutListResponse = await app.request(
      "/api/extensions/packages/rollouts",
    );
    expect(emptyRolloutListResponse.status).toBe(200);
    expectExtensionPackageRolloutChannelListHeaders(
      emptyRolloutListResponse,
      (await emptyRolloutListResponse.json()) as ExtensionPackageRolloutChannel[],
    );

    const rolloutResponse = await app.request(
      "/api/extensions/packages/rollouts",
      jsonRequest({ threadId: thread.id, name: "Stable" }),
    );
    expect(rolloutResponse.status).toBe(201);
    const rollout =
      (await rolloutResponse.json()) as ExtensionPackageRolloutChannel;
    expectExtensionPackageRolloutChannelHeaders(rolloutResponse, rollout);
    expect(rollout).toEqual(
      expect.objectContaining({
        normalizedName: "stable",
        revision: 1,
        lockfileSha256: lockfile.contentSha256,
        packageCount: 2,
        dependencyCount: 1,
      }),
    );
    expect(rollout.policy.allowedPackageNames).toEqual([
      "deployment_consumer",
      "deployment_provider",
    ]);
    const rolloutListResponse = await app.request(
      "/api/extensions/packages/rollouts",
    );
    expect(rolloutListResponse.status).toBe(200);
    const rolloutChannels =
      (await rolloutListResponse.json()) as ExtensionPackageRolloutChannel[];
    expectExtensionPackageRolloutChannelListHeaders(
      rolloutListResponse,
      rolloutChannels,
    );
    expect(rolloutChannels).toEqual([rollout]);

    const rolloutPreviewResponse = await app.request(
      `/api/extensions/packages/rollouts/${rollout.id}/preview`,
      jsonRequest({}),
    );
    expect(rolloutPreviewResponse.status).toBe(200);
    const rolloutPreview =
      (await rolloutPreviewResponse.json()) as ExtensionPackageRolloutPreview;
    expectExtensionPackageRolloutPreviewHeaders(
      rolloutPreviewResponse,
      rolloutPreview,
    );
    expect(rolloutPreview).toEqual(
      expect.objectContaining({
        channelId: rollout.id,
        channelRevision: 1,
        lockfileSha256: lockfile.contentSha256,
        deploymentPreview: expect.objectContaining({
          noChanges: true,
          candidateCount: 2,
        }),
      }),
    );
    const rolloutApplyResponse = await app.request(
      `/api/extensions/packages/rollouts/${rollout.id}`,
      jsonRequest({
        threadId: thread.id,
        expectedRolloutSha256: rolloutPreview.contentSha256,
        expectedDeploymentSha256:
          rolloutPreview.deploymentPreview.contentSha256,
      }),
    );
    expect(rolloutApplyResponse.status).toBe(200);
    const rolloutApply =
      (await rolloutApplyResponse.json()) as ApplyExtensionPackageRolloutChannelResult;
    expectExtensionPackageRolloutApplyResultHeaders(
      rolloutApplyResponse,
      rolloutApply,
    );
    expect(rolloutApply.deployment.preview.noChanges).toBe(true);

    const indexAnchor = createIndexAnchor();
    const indexAnchorResponse = await app.request(
      "/api/extensions/publishers",
      jsonRequest({
        threadId: thread.id,
        label: "Channel index signer",
        source: { type: "environment", variable: INDEX_SIGNING_ENV },
      }),
    );
    expect(indexAnchorResponse.status).toBe(201);
    const persistedIndexAnchor =
      (await indexAnchorResponse.json()) as ExtensionPublisherTrustAnchor;
    expect(persistedIndexAnchor.keyId).toBe(indexAnchor.keyId);

    const invalidChannelIndexResponse = await app.request(
      "/api/extensions/packages/channel-index/sign",
      jsonRequest({
        threadId: thread.id,
        trustAnchorId: persistedIndexAnchor.id,
        publisher: "Napier Channel Registry",
        lockfileBaseUrl: "http://127.0.0.1:8787",
        unexpected: true,
      }),
    );
    expect(invalidChannelIndexResponse.status).toBe(400);
    expect(await invalidChannelIndexResponse.json()).toEqual(
      expect.objectContaining({
        error: "Extension package channel index signing request is invalid",
      }),
    );

    const channelIndexResponse = await app.request(
      "/api/extensions/packages/channel-index/sign",
      jsonRequest({
        threadId: thread.id,
        trustAnchorId: persistedIndexAnchor.id,
        publisher: "Napier Channel Registry",
        lockfileBaseUrl: "http://127.0.0.1:8787",
      }),
    );
    expect(channelIndexResponse.status).toBe(200);
    expect(channelIndexResponse.headers.get("cache-control")).toBe("no-store");
    const channelIndex =
      (await channelIndexResponse.json()) as SignedExtensionPackageChannelIndexEnvelope;
    expect(channelIndexResponse.headers.get("x-napier-content-sha256")).toBe(
      channelIndex.contentSha256,
    );
    expect(channelIndexResponse.headers.get("x-napier-index-sha256")).toBe(
      channelIndex.index.contentSha256,
    );
    expect(
      channelIndexResponse.headers.get("x-napier-index-artifact-sha256"),
    ).toBe(channelIndex.signature.indexArtifactSha256);
    expect(channelIndexResponse.headers.get("x-napier-channel-count")).toBe(
      "1",
    );
    expect(channelIndexResponse.headers.get("x-napier-signature-key-id")).toBe(
      indexAnchor.keyId,
    );
    expect(channelIndex).toEqual(
      expect.objectContaining({
        kind: "napier.signed-extension-package-channel-index",
        index: expect.objectContaining({
          kind: "napier.extension-package-channel-index",
          publisher: "Napier Channel Registry",
          channels: [
            expect.objectContaining({
              normalizedName: "stable",
              channelRevision: 1,
              channelSha256: rollout.contentSha256,
              lockfileSha256: lockfile.contentSha256,
              lockfileLocator: `http://127.0.0.1:8787/api/extensions/packages/lockfiles/${lockfile.contentSha256}`,
              packageCount: 2,
              dependencyCount: 1,
              packageEnvelopeIdsSha256: rollout.packageEnvelopeIdsSha256,
            }),
          ],
        }),
      }),
    );
    const channelIndexJson = JSON.stringify(channelIndex);
    expect(JSON.stringify(channelIndex.index.channels)).not.toContain(
      '"packages"',
    );
    expect(JSON.stringify(channelIndex.index.channels)).not.toContain(
      '"envelope"',
    );
    expect(channelIndexJson).not.toContain(providerV1.manifest.description);
    expect(channelIndexJson).not.toContain(consumerV1.manifest.description);

    const lockfileFetchResponse = await app.request(
      `/api/extensions/packages/lockfiles/${lockfile.contentSha256}`,
    );
    expect(lockfileFetchResponse.status).toBe(200);
    const fetchedLockfile =
      (await lockfileFetchResponse.json()) as ExtensionPackageLockfile;
    expectExtensionPackageLockfileHeaders(
      lockfileFetchResponse,
      fetchedLockfile,
    );
    expect(fetchedLockfile).toEqual(
      expect.objectContaining({
        contentSha256: lockfile.contentSha256,
        packages: lockfile.packages,
      }),
    );

    const channelIndexVerifyResponse = await app.request(
      "/api/extensions/packages/channel-index/verify",
      jsonRequest({ envelope: channelIndex }),
    );
    expect(channelIndexVerifyResponse.status).toBe(200);
    const channelIndexVerification =
      (await channelIndexVerifyResponse.json()) as ExtensionPackageChannelIndexVerification;
    expectExtensionPackageChannelIndexVerificationHeaders(
      channelIndexVerifyResponse,
      channelIndexVerification,
    );
    expect(channelIndexVerification).toEqual(
      expect.objectContaining({
        status: "trusted",
        channelCount: 1,
        indexSha256: channelIndex.index.contentSha256,
        envelopeSha256: channelIndex.contentSha256,
        keyId: indexAnchor.keyId,
      }),
    );

    const replayServices = await createServices();
    const replayApp = createApp(replayServices);
    const replayThread = firstOrThrow(
      replayServices.store.listThreads(),
      "replay Thread",
    );
    const replayAnchor = await replayApp.request(
      "/api/extensions/publishers",
      jsonRequest({
        threadId: replayThread.id,
        label: "Replay deployment key",
        source: { type: "public_key", publicKeySpki: anchor.publicKeySpki },
      }),
    );
    expect(replayAnchor.status).toBe(201);
    const replayPreviewResponse = await replayApp.request(
      "/api/extensions/packages/deployment/preview",
      jsonRequest({
        envelopes: lockfile.packages.map((entry) => entry.envelope),
      }),
    );
    expect(replayPreviewResponse.status).toBe(200);
    const replayPreview =
      (await replayPreviewResponse.json()) as ExtensionPackageDeploymentPreview;
    expectExtensionPackageDeploymentPreviewHeaders(
      replayPreviewResponse,
      replayPreview,
    );
    const replayDeployResponse = await replayApp.request(
      "/api/extensions/packages/deployment",
      jsonRequest({
        threadId: replayThread.id,
        envelopes: lockfile.packages.map((entry) => entry.envelope),
        expectedDeploymentSha256: replayPreview.contentSha256,
      }),
    );
    expect(replayDeployResponse.status).toBe(200);
    const replayDeploy =
      (await replayDeployResponse.json()) as ApplyExtensionPackageDeploymentResult;
    expectExtensionPackageDeploymentResultHeaders(
      replayDeployResponse,
      replayDeploy,
    );
    expect(replayDeploy.installedExtensionIds).toHaveLength(2);

    for (const extension of services.store.listExtensions()) {
      await app.request(
        `/api/extensions/${extension.id}/review`,
        jsonRequest({ threadId: thread.id, action: "approve" }),
      );
      await app.request(
        `/api/extensions/${extension.id}/connect`,
        jsonRequest({ threadId: thread.id }),
      );
      await app.request(
        `/api/extensions/${extension.id}/tools/review`,
        jsonRequest({
          threadId: thread.id,
          toolName: "read",
          action: "approve",
          effect: "read",
        }),
      );
    }

    const providerV2 = await createPackage(anchor, {
      name: "Deployment provider",
      version: "2.0.0",
      description: "Private provider manifest v2",
    });
    const consumerV2 = await createPackage(anchor, {
      name: "Deployment consumer",
      version: "2.0.0",
      description: "Private consumer manifest v2",
      dependencies: [
        { normalizedName: "deployment_provider", versionRange: "^2.0.0" },
      ],
    });
    const updatePreviewResponse = await app.request(
      "/api/extensions/packages/deployment/preview",
      jsonRequest({ envelopes: [consumerV2, providerV2] }),
    );
    expect(updatePreviewResponse.status).toBe(200);
    const updatePreview =
      (await updatePreviewResponse.json()) as ExtensionPackageDeploymentPreview;
    expectExtensionPackageDeploymentPreviewHeaders(
      updatePreviewResponse,
      updatePreview,
    );
    const staleResponse = await app.request(
      "/api/extensions/packages/deployment",
      jsonRequest({
        threadId: thread.id,
        envelopes: [consumerV2, providerV2],
        expectedDeploymentSha256: "0".repeat(64),
      }),
    );
    expect(staleResponse.status).toBe(409);
    expect(closeClient).not.toHaveBeenCalled();

    const updateResponse = await app.request(
      "/api/extensions/packages/deployment",
      jsonRequest({
        threadId: thread.id,
        envelopes: [consumerV2, providerV2],
        expectedDeploymentSha256: updatePreview.contentSha256,
      }),
    );
    expect(updateResponse.status).toBe(200);
    const updated =
      (await updateResponse.json()) as ApplyExtensionPackageDeploymentResult;
    expectExtensionPackageDeploymentResultHeaders(updateResponse, updated);
    expect(updated.updatedExtensionIds).toHaveLength(2);
    expect(closeClient).toHaveBeenCalledTimes(2);
    expect(updated.extensions).toEqual([
      expect.objectContaining({
        normalizedName: "deployment_provider",
        version: "2.0.0",
        trustStatus: "pending",
        enabledAgentIds: [],
        tools: [],
        packageHistory: [expect.objectContaining({ sequence: 1 })],
      }),
      expect.objectContaining({
        normalizedName: "deployment_consumer",
        version: "2.0.0",
        trustStatus: "pending",
        enabledAgentIds: [],
        tools: [],
        packageHistory: [expect.objectContaining({ sequence: 1 })],
      }),
    ]);

    const detail = await services.store.getDetail(thread.id);
    expect(
      detail.events.filter(
        (event) => event.type === "extension.packages.deployed",
      ),
    ).toHaveLength(2);
    expect(
      detail.events.filter(
        (event) => event.type === "extension.packages.lockfile.exported",
      ),
    ).toHaveLength(1);
    expect(
      detail.events.filter(
        (event) => event.type === "extension.packages.rollout.published",
      ),
    ).toHaveLength(1);
    const channelIndexEvents = detail.events.filter(
      (event) => event.type === "extension.packages.channel_index.signed",
    );
    expect(channelIndexEvents).toHaveLength(1);
    expect(JSON.stringify(channelIndexEvents)).not.toContain('"packages"');
    expect(JSON.stringify(channelIndexEvents)).not.toContain('"envelope"');
    expect(JSON.stringify(detail.events)).not.toContain(
      providerV1.manifest.description,
    );
    expect(JSON.stringify(detail.events)).not.toContain(
      consumerV1.manifest.description,
    );
    expect(JSON.stringify(detail.events)).not.toContain(
      providerV2.manifest.description,
    );
    expect(JSON.stringify(detail.events)).not.toContain(
      consumerV2.manifest.description,
    );
  });
});
