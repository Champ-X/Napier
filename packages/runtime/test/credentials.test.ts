import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createCredentialReference } from "../src/credential-references.js";
import {
  CredentialReferenceStore,
  type KeychainSecretResolver,
  type KeychainSecretStore,
  MacOsKeychainResolver,
} from "../src/credentials.js";
import { ModelRegistry } from "../src/models.js";
import { LocalStore } from "../src/store.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function createStore(): Promise<{
  store: LocalStore;
  dataRoot: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-credentials-"));
  temporaryRoots.push(root);
  const dataRoot = path.join(root, "data");
  const store = new LocalStore({
    dataRoot,
    workspaceRoot: path.join(root, "workspace"),
  });
  await store.initialize();
  return { store, dataRoot };
}

describe("credential references", () => {
  it("normalizes references and rejects unsafe locators", () => {
    expect(
      createCredentialReference({
        providerId: "OpenAI",
        label: "Primary key",
        source: { type: "environment", variable: "NAPIER_OPENAI_KEY" },
      }),
    ).toEqual(
      expect.objectContaining({
        providerId: "openai",
        status: "active",
        availability: "unknown",
        source: {
          type: "environment",
          variable: "NAPIER_OPENAI_KEY",
        },
      }),
    );
    expect(() =>
      createCredentialReference({
        providerId: "openai",
        label: "Invalid",
        source: { type: "environment", variable: "bad variable" },
      }),
    ).toThrow("Invalid credential environment variable");
    expect(() =>
      createCredentialReference({
        providerId: "openai",
        label: "Invalid",
        source: {
          type: "macos_keychain",
          service: "",
          account: "operator",
        },
      }),
    ).toThrow("require service and account");
  });

  it("resolves environment secrets without persisting or enumerating values", async () => {
    const { store, dataRoot } = await createStore();
    const reference = await store.createCredentialReference({
      providerId: "openai",
      label: "Environment key",
      source: { type: "environment", variable: "NAPIER_TEST_SECRET" },
    });
    const keychain: KeychainSecretResolver = {
      resolve: vi.fn(async () => {
        throw new Error("must not read keychain");
      }),
    };
    const credentials = new CredentialReferenceStore({
      store,
      env: { NAPIER_TEST_SECRET: "secret-value-never-persisted" },
      keychain,
    });

    expect(await credentials.read("openai")).toEqual({
      type: "api_key",
      key: "secret-value-never-persisted",
    });
    const models = new ModelRegistry(credentials);
    expect(await models.models.getAuth("openai")).toEqual(
      expect.objectContaining({
        auth: expect.objectContaining({
          apiKey: "secret-value-never-persisted",
        }),
      }),
    );
    expect(await credentials.list()).toEqual([
      { providerId: "openai", type: "api_key" },
    ]);
    const checked = await credentials.check(reference.id);
    expect(checked.availability).toBe("available");
    expect(keychain.resolve).not.toHaveBeenCalled();

    const persisted = await readFile(
      path.join(dataRoot, "workspace.json"),
      "utf8",
    );
    expect(persisted).toContain("NAPIER_TEST_SECRET");
    expect(persisted).not.toContain("secret-value-never-persisted");
  });

  it("fails closed when an active reference is unavailable", async () => {
    const { store } = await createStore();
    const reference = await store.createCredentialReference({
      providerId: "anthropic",
      label: "Missing key",
      source: { type: "environment", variable: "MISSING_NAPIER_KEY" },
    });
    const credentials = new CredentialReferenceStore({ store, env: {} });

    await expect(credentials.read("anthropic")).rejects.toThrow(
      `Active credential reference is unavailable: ${reference.id}`,
    );
    expect((await credentials.check(reference.id)).availability).toBe(
      "missing",
    );
  });

  it("resolves keychain references lazily and never during metadata listing", async () => {
    const { store } = await createStore();
    const reference = await store.createCredentialReference({
      providerId: "google",
      label: "Login keychain",
      source: {
        type: "macos_keychain",
        service: "dev.napier.google",
        account: "operator",
      },
    });
    const resolve = vi.fn(async () => "keychain-secret");
    const credentials = new CredentialReferenceStore({
      store,
      env: {},
      keychain: { resolve },
    });

    expect(await credentials.list()).toEqual([
      { providerId: "google", type: "api_key" },
    ]);
    expect(resolve).not.toHaveBeenCalled();
    expect(await credentials.read("google")).toEqual({
      type: "api_key",
      key: "keychain-secret",
    });
    expect(resolve).toHaveBeenCalledWith("dev.napier.google", "operator");
    expect((await credentials.check(reference.id)).availability).toBe(
      "available",
    );
  });

  it("writes keychain secrets once while persisting only the locator", async () => {
    const { store, dataRoot } = await createStore();
    const keychainSecret = "sk-keychain-write-never-persisted";
    const keychain: KeychainSecretStore = {
      resolve: vi.fn(async () => keychainSecret),
      write: vi.fn(async () => undefined),
    };
    const credentials = new CredentialReferenceStore({
      store,
      env: {},
      keychain,
    });

    const reference = await credentials.createMacOsKeychainReference({
      providerId: "openai",
      label: "Written keychain",
      service: "dev.napier.openai",
      account: "workspace",
      secret: keychainSecret,
      replaceExisting: true,
    });

    expect(keychain.write).toHaveBeenCalledWith(
      "dev.napier.openai",
      "workspace",
      keychainSecret,
      { replaceExisting: true },
    );
    expect(reference).toEqual(
      expect.objectContaining({
        providerId: "openai",
        source: {
          type: "macos_keychain",
          service: "dev.napier.openai",
          account: "workspace",
        },
      }),
    );
    expect(await credentials.read("openai")).toEqual({
      type: "api_key",
      key: keychainSecret,
    });

    await expect(
      credentials.createMacOsKeychainReference({
        providerId: "openai",
        label: "Duplicate locator",
        service: "dev.napier.openai",
        account: "workspace",
        secret: "sk-duplicate-should-not-write",
      }),
    ).rejects.toThrow("already has an active credential");
    expect(keychain.write).toHaveBeenCalledTimes(1);

    const persisted = await readFile(
      path.join(dataRoot, "workspace.json"),
      "utf8",
    );
    expect(persisted).toContain("dev.napier.openai");
    expect(persisted).not.toContain(keychainSecret);
    expect(persisted).not.toContain("sk-duplicate-should-not-write");
  });

  it("refuses secret persistence and unsupported keychain platforms", async () => {
    const { store } = await createStore();
    await store.createCredentialReference({
      providerId: "openrouter",
      label: "Referenced key",
      source: { type: "environment", variable: "OPENROUTER_REF" },
    });
    const credentials = new CredentialReferenceStore({
      store,
      env: { OPENROUTER_REF: "resolved-only" },
    });
    await expect(
      credentials.modify("openrouter", async () => ({
        type: "api_key",
        key: "must-not-persist",
      })),
    ).rejects.toThrow("cannot persist secret values");
    await expect(
      new MacOsKeychainResolver("linux").resolve("service", "account"),
    ).rejects.toThrow("unavailable on this platform");
  });
});
