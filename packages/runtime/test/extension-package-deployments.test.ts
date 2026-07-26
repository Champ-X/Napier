import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  ExtensionPackageDependency,
  ExtensionPublisherTrustAnchor,
  SignedExtensionPackageEnvelope,
} from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyExtensionPackageDeploymentRecords,
  createExtensionPackageLockfile,
  createExtensionPackageDeploymentPreview,
  createExtensionPublisherTrustAnchor,
  extensionPackageLockfileEnvelopes,
  extensionPackageDependencyFailure,
  normalizeExtensionPackageDependencies,
  normalizeExtensionPackageVersionRange,
  revokeExtensionPublisherTrustAnchor,
  satisfiesExtensionPackageVersionRange,
  signExtensionPackage,
  validateExtensionPackageLockfile,
  validateExtensionPackageDependencyGraph,
  validateExtensionPackageManifest,
  verifyExtensionPackageLockfile,
} from "../src/extension-packages.js";
import {
  createMcpExtension,
  mergeDiscoveredMcpTools,
  reviewExtensionRecord,
  reviewMcpToolRecord,
} from "../src/extensions.js";
import { McpExtensionManager } from "../src/mcp.js";
import { LocalStore } from "../src/store.js";

const SIGNING_KEY_ENV = "NAPIER_TEST_DEPLOYMENT_SIGNING_KEY";
const DEPENDENCY_KEY_ENV = "NAPIER_TEST_DEPLOYMENT_DEPENDENCY_KEY";
const temporaryRoots: string[] = [];
const openStores: LocalStore[] = [];

afterEach(async () => {
  delete process.env[SIGNING_KEY_ENV];
  delete process.env[DEPENDENCY_KEY_ENV];
  for (const store of openStores.splice(0)) store.close();
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

function createAnchor(
  variable = SIGNING_KEY_ENV,
  label = "Deployment publisher",
): ExtensionPublisherTrustAnchor {
  const { privateKey } = generateKeyPairSync("ed25519");
  process.env[variable] = privateKey
    .export({ format: "pem", type: "pkcs8" })
    .toString();
  return createExtensionPublisherTrustAnchor({
    threadId: "thread_deployment",
    label,
    source: { type: "environment", variable },
  });
}

async function createPackage(
  anchor: ExtensionPublisherTrustAnchor,
  options: {
    name: string;
    version: string;
    dependencies?: ExtensionPackageDependency[];
  },
): Promise<SignedExtensionPackageEnvelope> {
  let extension = createMcpExtension({
    name: options.name,
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
  return signExtensionPackage(extension, "Napier Test Publisher", anchor, {
    ...(options.dependencies ? { dependencies: options.dependencies } : {}),
  });
}

async function createStore(label: string): Promise<{
  store: LocalStore;
  options: { dataRoot: string; workspaceRoot: string };
}> {
  const root = await mkdtemp(
    path.join(tmpdir(), `napier-package-deployment-${label}-`),
  );
  temporaryRoots.push(root);
  const options = {
    dataRoot: path.join(root, "data"),
    workspaceRoot: path.join(root, "workspace"),
  };
  await mkdir(options.workspaceRoot, { recursive: true });
  const store = new LocalStore(options);
  openStores.push(store);
  await store.initialize();
  return { store, options };
}

function firstOrThrow<T>(values: T[], label: string): T {
  const value = values[0];
  if (!value) throw new Error(`Expected ${label}`);
  return value;
}

describe("dependency-aware signed package deployments", () => {
  it("normalizes bounded dependency ranges without guessing opaque versions", () => {
    expect(
      normalizeExtensionPackageDependencies([
        { normalizedName: "zeta", versionRange: " >=1.2.0   <2.0.0 " },
        { normalizedName: "alpha", versionRange: "^0.3.1" },
      ]),
    ).toEqual([
      { normalizedName: "alpha", versionRange: "^0.3.1" },
      { normalizedName: "zeta", versionRange: ">=1.2.0 <2.0.0" },
    ]);
    expect(normalizeExtensionPackageVersionRange("~1.4.2")).toBe("~1.4.2");
    expect(normalizeExtensionPackageVersionRange("<2.0.0 >=1.2.0")).toBe(
      ">=1.2.0 <2.0.0",
    );
    expect(satisfiesExtensionPackageVersionRange("1.8.0", "^1.2.3")).toBe(true);
    expect(satisfiesExtensionPackageVersionRange("2.0.0", "^1.2.3")).toBe(
      false,
    );
    expect(satisfiesExtensionPackageVersionRange("0.3.8", "^0.3.1")).toBe(true);
    expect(satisfiesExtensionPackageVersionRange("0.4.0", "^0.3.1")).toBe(
      false,
    );
    expect(
      satisfiesExtensionPackageVersionRange("1.5.0", ">=1.2.0 <2.0.0"),
    ).toBe(true);
    expect(() => normalizeExtensionPackageVersionRange("1.x")).toThrow(
      "version range is invalid",
    );
    expect(() =>
      normalizeExtensionPackageDependencies(
        [{ normalizedName: "self", versionRange: "*" }],
        "self",
      ),
    ).toThrow("cannot depend on itself");
  });

  it("atomically installs an unordered dependency set and survives restart", async () => {
    const anchor = createAnchor();
    const provider = await createPackage(anchor, {
      name: "Provider core",
      version: "1.2.0",
    });
    const consumer = await createPackage(anchor, {
      name: "Consumer tools",
      version: "1.0.0",
      dependencies: [
        { normalizedName: "provider_core", versionRange: "^1.0.0" },
      ],
    });
    expect(provider.manifest.schemaVersion).toBe(1);
    expect(consumer.manifest.schemaVersion).toBe(2);
    expect(() =>
      validateExtensionPackageManifest({
        ...consumer.manifest,
        schemaVersion: 1,
      }),
    ).toThrow("dependencies are not canonical");
    expect(() =>
      validateExtensionPackageManifest({
        ...provider.manifest,
        schemaVersion: 2,
      }),
    ).toThrow("dependencies are not canonical");
    const { store, options } = await createStore("install");
    const thread = firstOrThrow(store.listThreads(), "deployment Thread");
    await store.createExtensionPublisherTrustAnchor({
      threadId: thread.id,
      label: "Deployment verify key",
      source: { type: "public_key", publicKeySpki: anchor.publicKeySpki },
    });

    await expect(
      store.importSignedExtensionPackage({
        threadId: thread.id,
        envelope: consumer,
      }),
    ).rejects.toThrow("dependency is missing");
    const before = store.listExtensions().length;
    const preview = store.previewExtensionPackageDeployment([
      consumer,
      provider,
    ]);
    expect(preview).toEqual(
      expect.objectContaining({
        candidateCount: 2,
        installCount: 2,
        updateCount: 0,
        applyOrder: ["provider_core", "consumer_tools"],
        resolutions: [
          expect.objectContaining({
            dependentName: "consumer_tools",
            dependencyName: "provider_core",
            source: "candidate",
            resolvedVersion: "1.2.0",
          }),
        ],
      }),
    );
    const deployed = await store.applyExtensionPackageDeployment({
      threadId: thread.id,
      envelopes: [consumer, provider],
      expectedDeploymentSha256: preview.contentSha256,
    });
    expect(deployed.installedExtensionIds).toHaveLength(2);
    expect(deployed.updatedExtensionIds).toEqual([]);
    expect(deployed.extensions).toEqual([
      expect.objectContaining({
        normalizedName: "provider_core",
        trustStatus: "pending",
        enabledAgentIds: [],
        tools: [],
      }),
      expect.objectContaining({
        normalizedName: "consumer_tools",
        trustStatus: "pending",
        enabledAgentIds: [],
        tools: [],
      }),
    ]);
    expect(store.listExtensions()).toHaveLength(before + 2);

    store.close();
    openStores.splice(openStores.indexOf(store), 1);
    const reopened = new LocalStore(options);
    openStores.push(reopened);
    await reopened.initialize();
    expect(
      validateExtensionPackageDependencyGraph(
        reopened.listExtensions(),
        reopened.listExtensionPublisherTrustAnchors(),
        { requireTrusted: true },
      ),
    ).toEqual([
      expect.objectContaining({
        dependentName: "consumer_tools",
        dependencyName: "provider_core",
      }),
    ]);
  });

  it("requires coordinated major upgrades and rejects a stale whole-plan CAS", async () => {
    const anchor = createAnchor();
    const providerV1 = await createPackage(anchor, {
      name: "Provider core",
      version: "1.5.0",
    });
    const consumerV1 = await createPackage(anchor, {
      name: "Consumer tools",
      version: "1.0.0",
      dependencies: [
        { normalizedName: "provider_core", versionRange: "^1.0.0" },
      ],
    });
    const initialPreview = createExtensionPackageDeploymentPreview(
      [],
      [consumerV1, providerV1],
      [anchor],
    );
    const initial = applyExtensionPackageDeploymentRecords(
      [],
      [consumerV1, providerV1],
      [anchor],
      { expectedDeploymentSha256: initialPreview.contentSha256 },
    ).extensions;
    const providerV2 = await createPackage(anchor, {
      name: "Provider core",
      version: "2.0.0",
    });
    const consumerV2 = await createPackage(anchor, {
      name: "Consumer tools",
      version: "2.0.0",
      dependencies: [
        { normalizedName: "provider_core", versionRange: "^2.0.0" },
      ],
    });
    expect(() =>
      createExtensionPackageDeploymentPreview(initial, [providerV2], [anchor]),
    ).toThrow("dependency version is incompatible");
    expect(() =>
      createExtensionPackageDeploymentPreview(initial, [consumerV2], [anchor]),
    ).toThrow("dependency version is incompatible");

    const preview = createExtensionPackageDeploymentPreview(
      initial,
      [consumerV2, providerV2],
      [anchor],
    );
    expect(preview.applyOrder).toEqual(["provider_core", "consumer_tools"]);
    const deployed = applyExtensionPackageDeploymentRecords(
      initial,
      [consumerV2, providerV2],
      [anchor],
      { expectedDeploymentSha256: preview.contentSha256 },
    );
    expect(deployed.updatedExtensionIds).toHaveLength(2);
    expect(
      deployed.extensions.map((extension) => [
        extension.normalizedName,
        extension.version,
        extension.packageHistory?.length,
      ]),
    ).toEqual([
      ["provider_core", "2.0.0", 1],
      ["consumer_tools", "2.0.0", 1],
    ]);

    const providerV16 = await createPackage(anchor, {
      name: "Provider core",
      version: "1.6.0",
    });
    const consumerV11 = await createPackage(anchor, {
      name: "Consumer tools",
      version: "1.1.0",
      dependencies: [
        { normalizedName: "provider_core", versionRange: "^1.0.0" },
      ],
    });
    const interimPreview = createExtensionPackageDeploymentPreview(
      initial,
      [consumerV11, providerV16],
      [anchor],
    );
    const interim = applyExtensionPackageDeploymentRecords(
      initial,
      [consumerV11, providerV16],
      [anchor],
      { expectedDeploymentSha256: interimPreview.contentSha256 },
    );
    expect(() =>
      applyExtensionPackageDeploymentRecords(
        interim.extensions,
        [consumerV2, providerV2],
        [anchor],
        { expectedDeploymentSha256: preview.contentSha256 },
      ),
    ).toThrow("changed since the deployment preview");
    expect(interim.extensions.map((extension) => extension.version)).toEqual([
      "1.6.0",
      "1.1.0",
    ]);
    expect(deployed.extensions.map((extension) => extension.version)).toEqual([
      "2.0.0",
      "2.0.0",
    ]);
  });

  it("fails closed on missing, cyclic, and revoked dependency evidence", async () => {
    const anchor = createAnchor();
    const missing = await createPackage(anchor, {
      name: "Missing consumer",
      version: "1.0.0",
      dependencies: [{ normalizedName: "absent_provider", versionRange: "*" }],
    });
    expect(() =>
      createExtensionPackageDeploymentPreview([], [missing], [anchor]),
    ).toThrow("dependency is missing");

    const alpha = await createPackage(anchor, {
      name: "Alpha package",
      version: "1.0.0",
      dependencies: [
        { normalizedName: "beta_package", versionRange: "^1.0.0" },
      ],
    });
    const beta = await createPackage(anchor, {
      name: "Beta package",
      version: "1.0.0",
      dependencies: [
        { normalizedName: "alpha_package", versionRange: "^1.0.0" },
      ],
    });
    expect(() =>
      createExtensionPackageDeploymentPreview([], [alpha, beta], [anchor]),
    ).toThrow("dependency cycle");

    const provider = await createPackage(anchor, {
      name: "Trusted provider",
      version: "1.0.0",
    });
    const consumer = await createPackage(anchor, {
      name: "Trusted consumer",
      version: "1.0.0",
      dependencies: [
        { normalizedName: "trusted_provider", versionRange: "^1.0.0" },
      ],
    });
    const preview = createExtensionPackageDeploymentPreview(
      [],
      [consumer, provider],
      [anchor],
    );
    const installed = applyExtensionPackageDeploymentRecords(
      [],
      [consumer, provider],
      [anchor],
      { expectedDeploymentSha256: preview.contentSha256 },
    ).extensions;
    const revoked = revokeExtensionPublisherTrustAnchor(anchor);
    const installedConsumer = installed.find(
      (extension) => extension.normalizedName === "trusted_consumer",
    );
    if (!installedConsumer) throw new Error("Expected installed consumer");
    expect(
      extensionPackageDependencyFailure(installedConsumer, installed, [
        revoked,
      ]),
    ).toContain("dependency is not trusted");
  });

  it("cascades provider-key revocation across a separately signed dependency", async () => {
    const providerAnchor = createAnchor(SIGNING_KEY_ENV, "Provider publisher");
    const consumerAnchor = createAnchor(
      DEPENDENCY_KEY_ENV,
      "Consumer publisher",
    );
    const provider = await createPackage(providerAnchor, {
      name: "Cross publisher provider",
      version: "1.0.0",
    });
    const consumer = await createPackage(consumerAnchor, {
      name: "Cross publisher consumer",
      version: "1.0.0",
      dependencies: [
        {
          normalizedName: "cross_publisher_provider",
          versionRange: "^1.0.0",
        },
      ],
    });
    const { store } = await createStore("revocation-cascade");
    const thread = firstOrThrow(store.listThreads(), "revocation Thread");
    const providerTrust = await store.createExtensionPublisherTrustAnchor({
      threadId: thread.id,
      label: "Provider verify key",
      source: {
        type: "public_key",
        publicKeySpki: providerAnchor.publicKeySpki,
      },
    });
    await store.createExtensionPublisherTrustAnchor({
      threadId: thread.id,
      label: "Consumer verify key",
      source: {
        type: "public_key",
        publicKeySpki: consumerAnchor.publicKeySpki,
      },
    });
    const preview = store.previewExtensionPackageDeployment([
      consumer,
      provider,
    ]);
    await store.applyExtensionPackageDeployment({
      threadId: thread.id,
      envelopes: [consumer, provider],
      expectedDeploymentSha256: preview.contentSha256,
    });
    const agent = firstOrThrow(store.listAgents(), "Agent");
    for (const extension of store.listExtensions()) {
      const signedTool = extension.packageBinding?.envelope.manifest.tools[0];
      if (!signedTool) throw new Error("Expected signed package tool");
      await store.reviewExtension(extension.id, { action: "approve" });
      await store.replaceDiscoveredMcpTools(extension.id, [
        {
          name: signedTool.name,
          description: signedTool.description,
          inputSchema: signedTool.inputSchema,
        },
      ]);
      await store.reviewMcpTool(extension.id, signedTool.name, {
        action: "approve",
        effect: signedTool.effect,
      });
      await store.setExtensionEnabled(extension.id, agent.id, true);
    }
    const manager = new McpExtensionManager({ store });
    expect(manager.createAgentTools(agent.id)).toHaveLength(2);

    await store.revokeExtensionPublisherTrustAnchor(providerTrust.id);
    const current = store.listExtensions();
    const currentConsumer = current.find(
      (extension) => extension.normalizedName === "cross_publisher_consumer",
    );
    if (!currentConsumer) throw new Error("Expected dependent Extension");
    expect(currentConsumer.enabledAgentIds).toEqual([]);
    expect(currentConsumer.connection).toEqual(
      expect.objectContaining({
        status: "disconnected",
        error: expect.stringContaining("dependency is not trusted"),
      }),
    );
    expect(manager.createAgentTools(agent.id)).toEqual([]);
  });

  it("exports a stable self-contained lockfile for cross-workspace replay", async () => {
    const anchor = createAnchor();
    const provider = await createPackage(anchor, {
      name: "Lockfile provider",
      version: "1.0.0",
    });
    const consumer = await createPackage(anchor, {
      name: "Lockfile consumer",
      version: "1.0.0",
      dependencies: [
        { normalizedName: "lockfile_provider", versionRange: "^1.0.0" },
      ],
    });
    const { store } = await createStore("lockfile-source");
    const thread = firstOrThrow(store.listThreads(), "lockfile Thread");
    await store.createExtensionPublisherTrustAnchor({
      threadId: thread.id,
      label: "Lockfile verify key",
      source: { type: "public_key", publicKeySpki: anchor.publicKeySpki },
    });
    const preview = store.previewExtensionPackageDeployment([
      consumer,
      provider,
    ]);
    await store.applyExtensionPackageDeployment({
      threadId: thread.id,
      envelopes: [consumer, provider],
      expectedDeploymentSha256: preview.contentSha256,
    });

    const lockfile = store.exportExtensionPackageLockfile({
      threadId: thread.id,
    });
    expect(lockfile).toEqual(
      expect.objectContaining({
        kind: "napier.extension-package-lockfile",
        packages: [
          expect.objectContaining({
            normalizedName: "lockfile_consumer",
            dependencies: [
              {
                normalizedName: "lockfile_provider",
                versionRange: "^1.0.0",
              },
            ],
          }),
          expect.objectContaining({ normalizedName: "lockfile_provider" }),
        ],
      }),
    );
    expect(lockfile.packages).toHaveLength(2);
    expect(validateExtensionPackageLockfile(lockfile).contentSha256).toBe(
      lockfile.contentSha256,
    );
    expect(
      verifyExtensionPackageLockfile(
        lockfile,
        store.listExtensionPublisherTrustAnchors(),
      ),
    ).toEqual(
      expect.objectContaining({
        status: "trusted",
        packageCount: 2,
        lockfileSha256: lockfile.contentSha256,
      }),
    );
    const firstEntry = firstOrThrow(lockfile.packages, "lockfile entry");
    const secondEntry = firstOrThrow(
      lockfile.packages.slice(1),
      "lockfile entry",
    );
    expect(() =>
      validateExtensionPackageLockfile({
        ...lockfile,
        packages: [
          {
            ...firstEntry,
            normalizedName: "forged_name",
          },
          secondEntry,
        ],
      }),
    ).toThrow("does not match envelope");

    const replayPreview = createExtensionPackageDeploymentPreview(
      [],
      extensionPackageLockfileEnvelopes(lockfile),
      [anchor],
    );
    expect(replayPreview.applyOrder).toEqual([
      "lockfile_provider",
      "lockfile_consumer",
    ]);
    expect(
      applyExtensionPackageDeploymentRecords(
        [],
        extensionPackageLockfileEnvelopes(lockfile),
        [anchor],
        { expectedDeploymentSha256: replayPreview.contentSha256 },
      ).installedExtensionIds,
    ).toHaveLength(2);

    const direct = createExtensionPackageLockfile(
      store.listExtensions(),
      store.listExtensionPublisherTrustAnchors(),
      {
        generatedAt: new Date(
          Date.parse(lockfile.generatedAt) + 60_000,
        ).toISOString(),
      },
    );
    expect(direct.contentSha256).toBe(lockfile.contentSha256);

    const rollout = await store.publishExtensionPackageRolloutChannel({
      threadId: thread.id,
      name: "Stable",
    });
    expect(rollout).toEqual(
      expect.objectContaining({
        name: "Stable",
        normalizedName: "stable",
        revision: 1,
        lockfileSha256: lockfile.contentSha256,
        packageCount: 2,
        dependencyCount: 1,
      }),
    );
    expect(rollout.policy.allowedPackageNames).toEqual([
      "lockfile_consumer",
      "lockfile_provider",
    ]);
    expect(rollout.policy.allowedPublisherKeyIds).toEqual([anchor.keyId]);

    const rolloutPreview = store.previewExtensionPackageRolloutChannel({
      channelId: rollout.id,
    });
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
    expect(
      await store.applyExtensionPackageRolloutChannel({
        threadId: thread.id,
        channelId: rollout.id,
        expectedRolloutSha256: rolloutPreview.contentSha256,
        expectedDeploymentSha256:
          rolloutPreview.deploymentPreview.contentSha256,
      }),
    ).toEqual(
      expect.objectContaining({
        deployment: expect.objectContaining({
          installedExtensionIds: [],
          updatedExtensionIds: [],
        }),
      }),
    );

    const indexAnchor = createAnchor(
      DEPENDENCY_KEY_ENV,
      "Channel index signer",
    );
    const persistedIndexAnchor =
      await store.createExtensionPublisherTrustAnchor({
        threadId: thread.id,
        label: "Channel index signer",
        source: { type: "environment", variable: DEPENDENCY_KEY_ENV },
      });
    const channelIndex = await store.signExtensionPackageChannelIndex({
      threadId: thread.id,
      trustAnchorId: persistedIndexAnchor.id,
      publisher: "Napier Channel Registry",
      lockfileBaseUrl: "https://registry.example.com/napier",
    });
    expect(channelIndex).toEqual(
      expect.objectContaining({
        kind: "napier.signed-extension-package-channel-index",
        index: expect.objectContaining({
          kind: "napier.extension-package-channel-index",
          publisher: "Napier Channel Registry",
          channels: [
            expect.objectContaining({
              normalizedName: "stable",
              lockfileSha256: lockfile.contentSha256,
              lockfileLocator: `https://registry.example.com/napier/api/extensions/packages/lockfiles/${lockfile.contentSha256}`,
              packageCount: 2,
              dependencyCount: 1,
            }),
          ],
        }),
      }),
    );
    expect(JSON.stringify(channelIndex.index.channels)).not.toContain(
      '"packages"',
    );
    expect(JSON.stringify(channelIndex.index.channels)).not.toContain(
      '"envelope"',
    );
    expect(
      store.getExtensionPackageRolloutLockfile(lockfile.contentSha256),
    ).toEqual(
      expect.objectContaining({
        contentSha256: lockfile.contentSha256,
        packages: lockfile.packages,
      }),
    );
    expect(
      store.verifyExtensionPackageChannelIndex({ envelope: channelIndex }),
    ).toEqual(
      expect.objectContaining({
        status: "trusted",
        channelCount: 1,
        indexSha256: channelIndex.index.contentSha256,
        envelopeSha256: channelIndex.contentSha256,
        keyId: indexAnchor.keyId,
      }),
    );

    await expect(
      store.publishExtensionPackageRolloutChannel({
        threadId: thread.id,
        name: "Stable",
        expectedRevision: rollout.revision,
        policy: {
          maxPackages: 2,
          allowedPublisherKeyIds: [anchor.keyId],
          allowedPackageNames: ["lockfile_provider"],
        },
      }),
    ).rejects.toThrow("rollout policy rejects package");
  });
});
