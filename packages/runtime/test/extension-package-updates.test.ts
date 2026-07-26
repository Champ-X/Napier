import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  ExtensionPublisherTrustAnchor,
  JsonValue,
  McpToolEffect,
  SignedExtensionPackageEnvelope,
} from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyExtensionPackageUpdateRecord,
  compareExtensionPackageVersions,
  createExtensionPackageUpdatePreview,
  createExtensionPublisherTrustAnchor,
  createMcpExtensionFromSignedPackage,
  signExtensionPackage,
  validateExtensionPackageHistory,
} from "../src/extension-packages.js";
import {
  createMcpExtension,
  mergeDiscoveredMcpTools,
  reviewExtensionRecord,
  reviewMcpToolRecord,
  setExtensionAgentEnabled,
} from "../src/extensions.js";
import { LocalStore } from "../src/store.js";
import { LEDGER_DATABASE_FILENAME } from "../src/sqlite-ledger.js";

const PRIMARY_KEY_ENV = "NAPIER_TEST_PACKAGE_UPDATE_PRIMARY_KEY";
const ROTATED_KEY_ENV = "NAPIER_TEST_PACKAGE_UPDATE_ROTATED_KEY";
const temporaryRoots: string[] = [];
const openStores: LocalStore[] = [];

afterEach(async () => {
  delete process.env[PRIMARY_KEY_ENV];
  delete process.env[ROTATED_KEY_ENV];
  for (const store of openStores.splice(0)) store.close();
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

function installKey(variable: string): void {
  const { privateKey } = generateKeyPairSync("ed25519");
  process.env[variable] = privateKey
    .export({ format: "pem", type: "pkcs8" })
    .toString();
}

function createAnchor(
  variable: string,
  label: string,
): ExtensionPublisherTrustAnchor {
  installKey(variable);
  return createExtensionPublisherTrustAnchor({
    threadId: "thread_packageupdate",
    label,
    source: { type: "environment", variable },
  });
}

async function createSignedPackage(
  anchor: ExtensionPublisherTrustAnchor,
  options: {
    version: string;
    publisher?: string;
    url?: string;
    description?: string;
    routingHint?: string;
    schema?: JsonValue;
    effect?: Exclude<McpToolEffect, "unknown">;
  },
): Promise<SignedExtensionPackageEnvelope> {
  let extension = createMcpExtension({
    name: "Portable research",
    description: options.description ?? "Portable signed records",
    version: options.version,
    transport: {
      type: "streamable_http",
      url: options.url ?? "https://example.com/mcp",
    },
    requestedCapabilities: ["external.read", "external.write"],
  });
  extension = reviewExtensionRecord(extension, { action: "approve" });
  extension = mergeDiscoveredMcpTools(extension, [
    {
      name: "search",
      description: "Search portable records",
      inputSchema: options.schema ?? { type: "object" },
    },
  ]);
  extension = reviewMcpToolRecord(extension, "search", {
    action: "approve",
    effect: options.effect ?? "read",
    ...(options.routingHint ? { routingHint: options.routingHint } : {}),
  });
  return signExtensionPackage(
    extension,
    options.publisher ?? "Example Labs",
    anchor,
  );
}

function locallyApprovePackage(envelope: SignedExtensionPackageEnvelope) {
  let extension = createMcpExtensionFromSignedPackage(envelope);
  extension = reviewExtensionRecord(extension, { action: "approve" });
  const signedTool = envelope.manifest.tools[0];
  if (!signedTool) throw new Error("Expected signed tool");
  extension = mergeDiscoveredMcpTools(extension, [
    {
      name: signedTool.name,
      description: signedTool.description,
      inputSchema: signedTool.inputSchema,
    },
  ]);
  extension = reviewMcpToolRecord(extension, signedTool.name, {
    action: "approve",
    effect: signedTool.effect,
  });
  return setExtensionAgentEnabled(extension, "agent_packageupdate", true);
}

async function createStore(label: string): Promise<{
  store: LocalStore;
  options: { dataRoot: string; workspaceRoot: string };
}> {
  const root = await mkdtemp(
    path.join(tmpdir(), `napier-extension-update-${label}-`),
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

describe("reviewed Extension package updates", () => {
  it("previews deep changes and atomically resets all local authorization", async () => {
    const anchor = createAnchor(PRIMARY_KEY_ENV, "Primary publisher");
    const currentEnvelope = await createSignedPackage(anchor, {
      version: "1.2.0",
    });
    const nextEnvelope = await createSignedPackage(anchor, {
      version: "1.3.0",
      url: "https://example.com/v2/mcp",
      description: "Portable signed records v2",
      schema: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number" },
        },
      },
      effect: "write",
    });
    const current = locallyApprovePackage(currentEnvelope);
    const preview = createExtensionPackageUpdatePreview(current, nextEnvelope, [
      anchor,
    ]);

    expect(preview).toEqual(
      expect.objectContaining({
        extensionId: current.id,
        versionDirection: "upgrade",
        publisherChanged: false,
        requiresPublisherConfirmation: false,
        requiresVersionOverride: false,
        transportChanged: true,
        metadataChanged: true,
        noChanges: false,
        resetsLocalReview: true,
        changes: expect.arrayContaining([
          "version",
          "metadata",
          "transport",
          "tools",
          "effects",
          "lifecycle",
          "signature",
        ]),
        tools: expect.objectContaining({
          schemaChanged: ["search"],
          effectChanged: ["search"],
        }),
      }),
    );
    expect(preview.contentSha256).toMatch(/^[a-f0-9]{64}$/);

    const result = applyExtensionPackageUpdateRecord(
      current,
      nextEnvelope,
      [anchor],
      {
        expectedPackageBindingSha256: preview.expectedPackageBindingSha256,
      },
    );
    expect(result.updated).toBe(true);
    expect(result.extension).toEqual(
      expect.objectContaining({
        id: current.id,
        version: "1.3.0",
        trustStatus: "pending",
        approvedCapabilities: [],
        enabledAgentIds: [],
        tools: [],
        connection: expect.objectContaining({
          status: "disconnected",
          toolCount: 0,
        }),
        revision: current.revision + 1,
      }),
    );
    expect(result.extension.packageHistory).toEqual([
      expect.objectContaining({
        sequence: 1,
        binding: current.packageBinding,
        supersededByEnvelopeSha256: nextEnvelope.contentSha256,
      }),
    ]);
    expect(validateExtensionPackageHistory(result.extension, [anchor])).toEqual(
      result.extension.packageHistory,
    );
    expect(() =>
      createExtensionPackageUpdatePreview(result.extension, currentEnvelope, [
        anchor,
      ]),
    ).toThrow("replays a historical envelope");
  });

  it("treats an identical envelope as a no-op and rejects stale binding CAS", async () => {
    const anchor = createAnchor(PRIMARY_KEY_ENV, "Primary publisher");
    const envelope = await createSignedPackage(anchor, { version: "2.0.0" });
    const extension = createMcpExtensionFromSignedPackage(envelope);
    const binding = extension.packageBinding;
    if (!binding) throw new Error("Expected current package binding");

    const noOp = applyExtensionPackageUpdateRecord(
      extension,
      envelope,
      [anchor],
      { expectedPackageBindingSha256: binding.contentSha256 },
    );
    expect(noOp).toEqual(
      expect.objectContaining({
        updated: false,
        extension,
        preview: expect.objectContaining({
          noChanges: true,
          changes: [],
          versionDirection: "same",
        }),
      }),
    );
    expect(() =>
      applyExtensionPackageUpdateRecord(extension, envelope, [anchor], {
        expectedPackageBindingSha256: "0".repeat(64),
      }),
    ).toThrow("changed since the update preview");
  });

  it("flags reviewed routing hint drift as a tool update", async () => {
    const anchor = createAnchor(PRIMARY_KEY_ENV, "Primary publisher");
    const currentEnvelope = await createSignedPackage(anchor, {
      version: "2.0.0",
      routingHint: "Use for portable records after local search misses.",
    });
    const nextEnvelope = await createSignedPackage(anchor, {
      version: "2.0.0",
      routingHint: "Use for source-of-truth records before generic search.",
    });
    const current = locallyApprovePackage(currentEnvelope);

    const preview = createExtensionPackageUpdatePreview(current, nextEnvelope, [
      anchor,
    ]);

    expect(preview).toEqual(
      expect.objectContaining({
        noChanges: false,
        changes: expect.arrayContaining(["tools"]),
        tools: expect.objectContaining({
          routingHintChanged: ["search"],
          schemaChanged: [],
          effectChanged: [],
        }),
      }),
    );
  });

  it("requires explicit overrides for rollback, opaque versions, and publisher rotation", async () => {
    const primary = createAnchor(PRIMARY_KEY_ENV, "Primary publisher");
    const currentEnvelope = await createSignedPackage(primary, {
      version: "2.0.0",
    });
    const extension = createMcpExtensionFromSignedPackage(currentEnvelope);
    const binding = extension.packageBinding;
    if (!binding) throw new Error("Expected current package binding");
    const rollbackEnvelope = await createSignedPackage(primary, {
      version: "1.9.0",
    });
    const rollbackPreview = createExtensionPackageUpdatePreview(
      extension,
      rollbackEnvelope,
      [primary],
    );
    expect(rollbackPreview).toEqual(
      expect.objectContaining({
        versionDirection: "regression",
        requiresVersionOverride: true,
      }),
    );
    expect(() =>
      applyExtensionPackageUpdateRecord(
        extension,
        rollbackEnvelope,
        [primary],
        { expectedPackageBindingSha256: binding.contentSha256 },
      ),
    ).toThrow("version direction requires explicit override");

    const opaqueEnvelope = await createSignedPackage(primary, {
      version: "next",
    });
    expect(
      createExtensionPackageUpdatePreview(extension, opaqueEnvelope, [primary]),
    ).toEqual(
      expect.objectContaining({
        versionDirection: "unknown",
        requiresVersionOverride: true,
      }),
    );

    const rotated = createAnchor(ROTATED_KEY_ENV, "Rotated publisher");
    const rotatedEnvelope = await createSignedPackage(rotated, {
      version: "3.0.0",
      publisher: "Example Labs Next",
    });
    const rotationPreview = createExtensionPackageUpdatePreview(
      extension,
      rotatedEnvelope,
      [primary, rotated],
    );
    expect(rotationPreview).toEqual(
      expect.objectContaining({
        versionDirection: "upgrade",
        publisherChanged: true,
        requiresPublisherConfirmation: true,
      }),
    );
    expect(() =>
      applyExtensionPackageUpdateRecord(
        extension,
        rotatedEnvelope,
        [primary, rotated],
        { expectedPackageBindingSha256: binding.contentSha256 },
      ),
    ).toThrow("publisher change requires explicit confirmation");
    expect(
      applyExtensionPackageUpdateRecord(
        extension,
        rotatedEnvelope,
        [primary, rotated],
        {
          expectedPackageBindingSha256: binding.contentSha256,
          confirmPublisherChange: true,
        },
      ).updated,
    ).toBe(true);
  });

  it("persists a CAS-applied package history chain across restart", async () => {
    const primary = createAnchor(PRIMARY_KEY_ENV, "Primary publisher");
    const currentEnvelope = await createSignedPackage(primary, {
      version: "4.0.0",
    });
    const nextEnvelope = await createSignedPackage(primary, {
      version: "4.1.0",
    });
    const { store, options } = await createStore("restart");
    const thread = firstOrThrow(store.listThreads(), "update Thread");
    await store.createExtensionPublisherTrustAnchor({
      threadId: thread.id,
      label: "Primary public key",
      source: {
        type: "public_key",
        publicKeySpki: primary.publicKeySpki,
      },
    });
    const imported = await store.importSignedExtensionPackage({
      threadId: thread.id,
      envelope: currentEnvelope,
    });
    const preview = store.previewExtensionPackageUpdate(
      imported.id,
      nextEnvelope,
    );
    const applied = await store.applyExtensionPackageUpdate(imported.id, {
      threadId: thread.id,
      envelope: nextEnvelope,
      expectedPackageBindingSha256: preview.expectedPackageBindingSha256,
    });
    expect(applied).toEqual(
      expect.objectContaining({
        updated: true,
        extension: expect.objectContaining({
          id: imported.id,
          version: "4.1.0",
          packageHistory: [
            expect.objectContaining({
              sequence: 1,
              supersededByEnvelopeSha256: nextEnvelope.contentSha256,
            }),
          ],
        }),
      }),
    );

    store.close();
    openStores.splice(openStores.indexOf(store), 1);
    const reopened = new LocalStore(options);
    openStores.push(reopened);
    await reopened.initialize();
    expect(reopened.getExtension(imported.id)).toEqual(applied.extension);
  });

  it("migrates a legacy installed package to an explicit empty history once", async () => {
    const primary = createAnchor(PRIMARY_KEY_ENV, "Primary publisher");
    const envelope = await createSignedPackage(primary, {
      version: "5.0.0",
    });
    const { store, options } = await createStore("migration");
    const thread = firstOrThrow(store.listThreads(), "migration Thread");
    await store.createExtensionPublisherTrustAnchor({
      threadId: thread.id,
      label: "Primary public key",
      source: {
        type: "public_key",
        publicKeySpki: primary.publicKeySpki,
      },
    });
    const imported = await store.importSignedExtensionPackage({
      threadId: thread.id,
      envelope,
    });
    store.close();
    openStores.splice(openStores.indexOf(store), 1);

    const databasePath = path.join(options.dataRoot, LEDGER_DATABASE_FILENAME);
    const database = new DatabaseSync(databasePath);
    const row = database
      .prepare(
        "SELECT revision, state_json FROM workspace_state WHERE singleton = 1",
      )
      .get() as { revision: number; state_json: string };
    const state = JSON.parse(row.state_json) as {
      extensions: Array<Record<string, unknown>>;
    };
    const persistedExtension = state.extensions.find(
      (extension) => extension["id"] === imported.id,
    );
    if (!persistedExtension) throw new Error("Expected persisted Extension");
    delete persistedExtension["packageHistory"];
    database
      .prepare("UPDATE workspace_state SET state_json = ? WHERE singleton = 1")
      .run(JSON.stringify(state));
    database.close();

    const reopened = new LocalStore(options);
    openStores.push(reopened);
    await reopened.initialize();
    expect(reopened.getExtension(imported.id).packageHistory).toEqual([]);
    reopened.close();
    openStores.splice(openStores.indexOf(reopened), 1);

    const persisted = new DatabaseSync(databasePath);
    const migratedRow = persisted
      .prepare("SELECT state_json FROM workspace_state WHERE singleton = 1")
      .get() as { state_json: string };
    persisted.close();
    const migrated = JSON.parse(migratedRow.state_json) as {
      extensions: Array<{ id: string; packageHistory?: unknown }>;
    };
    expect(
      migrated.extensions.find((extension) => extension.id === imported.id)
        ?.packageHistory,
    ).toEqual([]);
  });

  it("implements strict SemVer precedence without guessing opaque labels", () => {
    expect(compareExtensionPackageVersions("1.0.0", "1.0.1")).toBe("upgrade");
    expect(
      compareExtensionPackageVersions("1.0.0-beta.2", "1.0.0-beta.11"),
    ).toBe("upgrade");
    expect(compareExtensionPackageVersions("1.0.0-rc.1", "1.0.0")).toBe(
      "upgrade",
    );
    expect(compareExtensionPackageVersions("2.0.0", "1.9.9")).toBe(
      "regression",
    );
    expect(compareExtensionPackageVersions("latest", "next")).toBe("unknown");
    expect(compareExtensionPackageVersions("1.0.0", "1.0.0")).toBe("same");
    expect(
      compareExtensionPackageVersions("1.0.0+build.1", "1.0.0+build.2"),
    ).toBe("same");
    expect(
      compareExtensionPackageVersions(
        "1.0.0-alpha.999999999999999999999999",
        "1.0.0-alpha.1000000000000000000000000",
      ),
    ).toBe("upgrade");
  });
});
