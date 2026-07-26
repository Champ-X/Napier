import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  ExtensionPublisherTrustAnchor,
  SignedExtensionPackageEnvelope,
} from "@napier/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createExtensionPublisherTrustAnchor,
  createMcpExtensionFromSignedPackage,
  hashExtensionPublisherTrustAnchor,
  revokeExtensionPublisherTrustAnchor,
  signExtensionPackage,
  validateExtensionPublisherTrustAnchor,
  verifyBoundExtensionPackage,
  verifyBoundExtensionPackageTrust,
  verifySignedExtensionPackageEnvelope,
} from "../src/extension-packages.js";
import {
  createMcpExtension,
  mergeDiscoveredMcpTools,
  reviewExtensionRecord,
  reviewMcpToolRecord,
} from "../src/extensions.js";
import { type McpClient, McpExtensionManager } from "../src/mcp.js";
import { LocalStore } from "../src/store.js";

const SIGNING_ENV = "NAPIER_TEST_EXTENSION_PACKAGE_KEY";
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

async function createStore(label: string): Promise<{
  store: LocalStore;
  options: { dataRoot: string; workspaceRoot: string };
}> {
  const root = await mkdtemp(
    path.join(tmpdir(), `napier-extension-package-${label}-`),
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

function installSigningKey(): void {
  const { privateKey } = generateKeyPairSync("ed25519");
  process.env[SIGNING_ENV] = privateKey
    .export({ format: "pem", type: "pkcs8" })
    .toString();
}

function firstOrThrow<T>(values: T[], label: string): T {
  const value = values[0];
  if (!value) throw new Error(`Expected ${label}`);
  return value;
}

function createFakeClient(schema: object = { type: "object" }) {
  const callTool = vi.fn(async () => ({
    contentText: "Signed source result",
    isError: false,
  }));
  const client: McpClient = {
    initialize: vi.fn(async () => undefined),
    listTools: vi.fn(async () => ({
      tools: [
        {
          name: "search",
          description: "Search the signed source",
          inputSchema: schema,
        },
      ],
    })),
    callTool,
    close: vi.fn(async () => undefined),
  };
  return { client, callTool };
}

async function publishRemotePackage(): Promise<{
  envelope: SignedExtensionPackageEnvelope;
  anchor: ExtensionPublisherTrustAnchor;
}> {
  installSigningKey();
  const { store } = await createStore("publisher");
  const thread = firstOrThrow(store.listThreads(), "publisher Thread");
  const anchor = await store.createExtensionPublisherTrustAnchor({
    threadId: thread.id,
    label: "Example publisher",
    source: { type: "environment", variable: SIGNING_ENV },
  });
  let extension = await store.createMcpExtension({
    name: "Signed research",
    description: "Curated research records",
    version: "2.4.0",
    transport: {
      type: "streamable_http",
      url: "https://example.com/mcp",
    },
    requestedCapabilities: ["external.read", "external.write"],
  });
  extension = await store.reviewExtension(extension.id, {
    action: "approve",
  });
  const fake = createFakeClient();
  const manager = new McpExtensionManager({
    store,
    createClient: async () => fake.client,
  });
  extension = await manager.connect(extension.id);
  await store.reviewMcpTool(extension.id, "search", {
    action: "approve",
    effect: "read",
    routingHint: "Use for signed research records after local sources miss.",
  });
  const envelope = await store.signExtensionPackage(extension.id, {
    threadId: thread.id,
    trustAnchorId: anchor.id,
    publisher: "Example Labs",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  await manager.shutdown();
  return { envelope, anchor };
}

describe("signed Extension packages", () => {
  it("binds deep manifest evidence and reports unknown, revoked, expired, and tampered packages", async () => {
    const { envelope, anchor } = await publishRemotePackage();

    expect(verifySignedExtensionPackageEnvelope(envelope, [anchor])).toEqual(
      expect.objectContaining({
        status: "trusted",
        signatureValid: true,
        integrityValid: true,
      }),
    );
    expect(verifySignedExtensionPackageEnvelope(envelope, [])).toEqual(
      expect.objectContaining({
        status: "unknown_key",
        integrityValid: true,
      }),
    );
    expect(
      verifySignedExtensionPackageEnvelope(envelope, [
        revokeExtensionPublisherTrustAnchor(anchor),
      ]),
    ).toEqual(
      expect.objectContaining({
        status: "revoked",
        signatureValid: true,
      }),
    );
    expect(envelope.manifest.tools[0]).toEqual(
      expect.objectContaining({
        name: "search",
        routingHint:
          "Use for signed research records after local sources miss.",
      }),
    );
    expect(
      verifySignedExtensionPackageEnvelope(
        envelope,
        [anchor],
        new Date(Date.now() + 120_000),
      ),
    ).toEqual(
      expect.objectContaining({
        status: "expired",
        signatureValid: true,
      }),
    );
    expect(
      verifySignedExtensionPackageEnvelope(
        envelope,
        [anchor],
        new Date(Date.now() - 10 * 60_000),
      ),
    ).toEqual(
      expect.objectContaining({
        status: "invalid",
        signatureValid: true,
        reason: expect.stringContaining("future"),
      }),
    );

    const tampered = structuredClone(envelope);
    tampered.manifest.description = "Changed after signing";
    expect(verifySignedExtensionPackageEnvelope(tampered, [anchor])).toEqual(
      expect.objectContaining({
        status: "invalid",
        integrityValid: false,
      }),
    );

    const nonCanonicalAnchor = structuredClone(anchor);
    nonCanonicalAnchor.createdAt = new Date(anchor.createdAt).toUTCString();
    nonCanonicalAnchor.updatedAt = nonCanonicalAnchor.createdAt;
    const { contentSha256: _contentSha256, ...content } = nonCanonicalAnchor;
    nonCanonicalAnchor.contentSha256 =
      hashExtensionPublisherTrustAnchor(content);
    expect(() =>
      validateExtensionPublisherTrustAnchor(nonCanonicalAnchor),
    ).toThrow("trust anchor is invalid");
    expect(
      verifySignedExtensionPackageEnvelope(
        {
          ...envelope,
          oversized: "x".repeat(4 * 1024 * 1024),
        },
        [anchor],
      ),
    ).toEqual(
      expect.objectContaining({
        status: "invalid",
        reason: expect.stringContaining("exceeds"),
      }),
    );
  });

  it("imports into a separate trust domain without inheriting local approval and survives restart", async () => {
    const { envelope, anchor } = await publishRemotePackage();
    const { store, options } = await createStore("importer");
    const thread = firstOrThrow(store.listThreads(), "importer Thread");
    const importedAnchor = await store.createExtensionPublisherTrustAnchor({
      threadId: thread.id,
      label: "Example publisher public key",
      source: { type: "public_key", publicKeySpki: anchor.publicKeySpki },
    });
    const extension = await store.importSignedExtensionPackage({
      threadId: thread.id,
      envelope,
    });

    expect(extension).toEqual(
      expect.objectContaining({
        trustStatus: "pending",
        approvedCapabilities: [],
        enabledAgentIds: [],
        provenance: expect.objectContaining({
          source: "signed_package",
          manifestSha256: envelope.manifest.contentSha256,
          envelopeSha256: envelope.contentSha256,
        }),
      }),
    );
    expect(extension.tools).toEqual([]);
    expect(extension.packageBinding?.envelope).toEqual(envelope);
    expect(importedAnchor.keyId).toBe(anchor.keyId);

    store.close();
    openStores.splice(openStores.indexOf(store), 1);
    const reopened = new LocalStore(options);
    openStores.push(reopened);
    await reopened.initialize();
    expect(reopened.listExtensionPublisherTrustAnchors()).toEqual([
      importedAnchor,
    ]);
    expect(
      reopened.getExtension(extension.id).packageBinding?.envelope,
    ).toEqual(envelope);
  });

  it("rejects signed configuration and discovered schema drift", async () => {
    const { envelope, anchor } = await publishRemotePackage();
    const extension = createMcpExtensionFromSignedPackage(envelope);
    const drifted = structuredClone(extension);
    if (drifted.transport.type !== "streamable_http") {
      throw new Error("Expected HTTP test transport");
    }
    drifted.transport.url = "https://different.example.com/mcp";
    expect(verifyBoundExtensionPackageTrust(drifted, [anchor])).toEqual(
      expect.objectContaining({
        status: "configuration_drift",
        configurationValid: false,
      }),
    );
    expect(() =>
      mergeDiscoveredMcpTools(extension, [
        {
          name: "search",
          inputSchema: {
            type: "object",
            properties: { destructive: { type: "boolean" } },
          },
        },
      ]),
    ).toThrow("differs from the signed package manifest");

    let reviewed = reviewExtensionRecord(extension, { action: "approve" });
    const signedTool = envelope.manifest.tools[0];
    if (!signedTool) throw new Error("Expected signed search tool");
    reviewed = mergeDiscoveredMcpTools(reviewed, [
      {
        name: "search",
        inputSchema: signedTool.inputSchema,
      },
    ]);
    expect(() =>
      reviewMcpToolRecord(reviewed, "search", {
        action: "approve",
        effect: "write",
      }),
    ).toThrow("differs from signed package manifest: expected read");
  });

  it("rehashes stdio executables and fails closed after binary drift", async () => {
    installSigningKey();
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-extension-executable-"),
    );
    temporaryRoots.push(root);
    const commandPath = path.join(root, "signed-mcp");
    await writeFile(commandPath, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    const command = await realpath(commandPath);
    const anchor = createExtensionPublisherTrustAnchor({
      threadId: "thread_test0000",
      label: "Local binary publisher",
      source: { type: "environment", variable: SIGNING_ENV },
    });
    let extension = createMcpExtension({
      name: "Signed local binary",
      transport: { type: "stdio", command },
      requestedCapabilities: ["external.read"],
    });
    extension = reviewExtensionRecord(extension, { action: "approve" });
    extension = mergeDiscoveredMcpTools(extension, [
      { name: "search", inputSchema: { type: "object" } },
    ]);
    extension = reviewMcpToolRecord(extension, "search", {
      action: "approve",
      effect: "read",
    });
    const envelope = await signExtensionPackage(
      extension,
      "Local Publisher",
      anchor,
    );
    const imported = createMcpExtensionFromSignedPackage(envelope);

    expect(await verifyBoundExtensionPackage(imported, [anchor])).toEqual(
      expect.objectContaining({
        status: "trusted",
        executableValid: true,
      }),
    );
    await writeFile(command, "#!/bin/sh\nexit 1\n", { mode: 0o700 });
    expect(await verifyBoundExtensionPackage(imported, [anchor])).toEqual(
      expect.objectContaining({
        status: "executable_mismatch",
        executableValid: false,
      }),
    );
  });

  it("blocks an already exposed Agent tool immediately after publisher revocation", async () => {
    const { envelope, anchor } = await publishRemotePackage();
    const { store } = await createStore("revocation");
    const thread = firstOrThrow(store.listThreads(), "revocation Thread");
    const agent = firstOrThrow(store.listAgents(), "revocation Agent");
    const importedAnchor = await store.createExtensionPublisherTrustAnchor({
      threadId: thread.id,
      label: "Example publisher public key",
      source: { type: "public_key", publicKeySpki: anchor.publicKeySpki },
    });
    let extension = await store.importSignedExtensionPackage({
      threadId: thread.id,
      envelope,
    });
    extension = await store.reviewExtension(extension.id, {
      action: "approve",
    });
    const fake = createFakeClient();
    const manager = new McpExtensionManager({
      store,
      createClient: async () => fake.client,
    });
    extension = await manager.connect(extension.id);
    extension = await store.reviewMcpTool(extension.id, "search", {
      action: "approve",
      effect: "read",
    });
    await store.setExtensionEnabled(extension.id, agent.id, true);
    const [tool] = manager.createAgentTools(agent.id);
    expect(tool).toBeDefined();
    if (!tool) throw new Error("Expected exposed MCP tool");
    await tool.execute("before-revocation", {});
    expect(fake.callTool).toHaveBeenCalledTimes(1);

    await store.revokeExtensionPublisherTrustAnchor(importedAnchor.id);
    expect(manager.createAgentTools(agent.id)).toEqual([]);
    expect(store.getExtension(extension.id)).toEqual(
      expect.objectContaining({
        enabledAgentIds: [],
        connection: expect.objectContaining({ status: "disconnected" }),
      }),
    );
    await expect(tool.execute("after-revocation", {})).rejects.toThrow(
      "publisher key is revoked",
    );
    expect(fake.callTool).toHaveBeenCalledTimes(1);
    await manager.shutdown();
  });
});
