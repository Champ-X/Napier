import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import type {
  ApiKeyCredential,
  Credential,
  CredentialInfo,
  CredentialStore,
} from "@earendil-works/pi-ai";
import type {
  CreateMacOsKeychainCredentialRequest,
  CredentialReference,
  CredentialReferenceSource,
} from "@napier/contracts";

import {
  createCredentialReference,
  credentialSourceKey,
} from "./credential-references.js";
import type { LocalStore } from "./store.js";

const execFile = promisify(execFileCallback);
const KEYCHAIN_TIMEOUT_MS = 5_000;

export interface KeychainSecretResolver {
  resolve(service: string, account: string): Promise<string | undefined>;
}

export interface KeychainSecretWriter {
  write(
    service: string,
    account: string,
    secret: string,
    options?: { replaceExisting?: boolean },
  ): Promise<void>;
}

export type KeychainSecretStore = KeychainSecretResolver &
  Partial<KeychainSecretWriter>;

export interface CredentialReferenceStoreOptions {
  store: LocalStore;
  env?: Readonly<Record<string, string | undefined>>;
  keychain?: KeychainSecretStore;
}

export class CredentialReferenceStore implements CredentialStore {
  private readonly env: Readonly<Record<string, string | undefined>>;
  private readonly keychain: KeychainSecretStore;

  constructor(private readonly options: CredentialReferenceStoreOptions) {
    this.env = options.env ?? process.env;
    this.keychain = options.keychain ?? new MacOsKeychainResolver();
  }

  async read(providerId: string): Promise<Credential | undefined> {
    const reference =
      this.options.store.getActiveCredentialReference(providerId);
    if (!reference) return undefined;
    const value = await this.resolveReference(reference);
    if (!value) {
      throw new Error(
        `Active credential reference is unavailable: ${reference.id}`,
      );
    }
    const credential: ApiKeyCredential = {
      type: "api_key",
      key: value,
    };
    return credential;
  }

  async list(): Promise<readonly CredentialInfo[]> {
    return this.options.store
      .listCredentialReferences()
      .filter((reference) => reference.status === "active")
      .map((reference) => ({
        providerId: reference.providerId,
        type: "api_key" as const,
      }));
  }

  async modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    const current = await this.read(providerId);
    const next = await fn(current);
    if (next === undefined) return current;
    throw new Error(
      "Napier credential references cannot persist secret values or OAuth tokens",
    );
  }

  async delete(providerId: string): Promise<void> {
    const reference =
      this.options.store.getActiveCredentialReference(providerId);
    if (!reference) return;
    await this.options.store.setCredentialReferenceStatus(
      reference.id,
      "disabled",
    );
  }

  async check(referenceId: string): Promise<CredentialReference> {
    const reference = this.options.store.getCredentialReference(referenceId);
    if (reference.status !== "active") {
      return this.options.store.recordCredentialAvailability(
        reference.id,
        "missing",
        "Credential reference is disabled",
      );
    }
    try {
      const value = await this.resolveReference(reference);
      return this.options.store.recordCredentialAvailability(
        reference.id,
        value ? "available" : "missing",
        value ? undefined : "Referenced credential is unavailable",
      );
    } catch (error) {
      return this.options.store.recordCredentialAvailability(
        reference.id,
        "error",
        safeCredentialError(error),
      );
    }
  }

  async createMacOsKeychainReference(
    request: CreateMacOsKeychainCredentialRequest,
  ): Promise<CredentialReference> {
    if (!this.keychain.write) {
      throw new Error("macOS Keychain write adapter is unavailable");
    }
    const source = {
      type: "macos_keychain" as const,
      service: request.service,
      account: request.account,
    };
    const referenceRequest = {
      providerId: request.providerId,
      label: request.label,
      source,
      ...(request.threadId ? { threadId: request.threadId } : {}),
    };
    const reference = createCredentialReference(referenceRequest);
    this.assertCanCreateCredentialReference(reference);
    const secret = normalizeKeychainSecret(request.secret);
    await this.keychain.write(source.service, source.account, secret, {
      replaceExisting: request.replaceExisting === true,
    });
    return this.options.store.createCredentialReference(referenceRequest);
  }

  private async resolveReference(
    reference: CredentialReference,
  ): Promise<string | undefined> {
    const value =
      reference.source.type === "environment"
        ? this.env[reference.source.variable]
        : await this.keychain.resolve(
            reference.source.service,
            reference.source.account,
          );
    const normalized = value?.trim();
    return normalized ? normalized : undefined;
  }

  private assertCanCreateCredentialReference(
    reference: CredentialReference,
  ): void {
    const references = this.options.store.listCredentialReferences();
    if (
      references.some(
        (candidate) =>
          candidate.providerId === reference.providerId &&
          candidate.status === "active",
      )
    ) {
      throw new Error(
        `Provider already has an active credential reference: ${reference.providerId}`,
      );
    }
    const sourceKey = credentialSourceKey(reference);
    if (
      references.some(
        (candidate) => credentialSourceKey(candidate) === sourceKey,
      )
    ) {
      throw new Error("Credential reference source already exists");
    }
  }
}

export class MacOsKeychainResolver
  implements KeychainSecretResolver, KeychainSecretWriter
{
  constructor(
    private readonly platform = process.platform,
    private readonly securityPath = "/usr/bin/security",
  ) {}

  async resolve(service: string, account: string): Promise<string | undefined> {
    if (this.platform !== "darwin") {
      throw new Error("macOS Keychain is unavailable on this platform");
    }
    try {
      const result = await execFile(
        this.securityPath,
        ["find-generic-password", "-w", "-s", service, "-a", account],
        {
          encoding: "utf8",
          timeout: KEYCHAIN_TIMEOUT_MS,
          maxBuffer: 64 * 1024,
          windowsHide: true,
        },
      );
      const value = result.stdout.trim();
      return value || undefined;
    } catch (error) {
      if (isKeychainItemMissing(error)) return undefined;
      throw new Error("macOS Keychain lookup failed");
    }
  }

  async write(
    service: string,
    account: string,
    secret: string,
    options: { replaceExisting?: boolean } = {},
  ): Promise<void> {
    if (this.platform !== "darwin") {
      throw new Error("macOS Keychain is unavailable on this platform");
    }
    const args = [
      "add-generic-password",
      ...(options.replaceExisting ? ["-U"] : []),
      "-s",
      service,
      "-a",
      account,
      "-w",
      secret,
    ];
    try {
      await execFile(this.securityPath, args, {
        encoding: "utf8",
        timeout: KEYCHAIN_TIMEOUT_MS,
        maxBuffer: 64 * 1024,
        windowsHide: true,
      });
    } catch {
      throw new Error("macOS Keychain write failed");
    }
  }
}

export function credentialReferenceLocator(
  source: CredentialReferenceSource,
): string {
  return source.type === "environment"
    ? source.variable
    : `${source.service} / ${source.account}`;
}

function isKeychainItemMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === 44 || code === "44";
}

function safeCredentialError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);
  }
  return "Credential lookup failed";
}

function normalizeKeychainSecret(secret: string): string {
  const normalized = secret.trim();
  if (normalized.length < 8 || normalized.length > 4096) {
    throw new Error("Credential secret must be 8 to 4096 characters");
  }
  if (/[\u0000]/.test(normalized)) {
    throw new Error("Credential secret must not contain NUL bytes");
  }
  return normalized;
}
