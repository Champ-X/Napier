import type { CredentialReference } from "@napier/contracts";
import {
  createId,
  type CredentialReferenceStore,
  type LocalStore,
  type ModelRegistry,
} from "@napier/runtime";
import type { ProviderSetupService } from "@napier/runtime/provider-setup";
import { Hono, type Context } from "hono";

import {
  errorMessage,
  jsonError,
  setBodyContentSha256Header,
} from "./http-response-evidence.js";
import {
  readLimitedJson,
  readOptionalLimitedJson,
  RequestBodyTooLargeError,
} from "./http-request-body.js";
import {
  parseCreateCredentialReferenceRequest,
  parseCreateMacOsKeychainCredentialRequest,
  parseCredentialThreadContextRequest,
  parseSetCredentialReferenceStatusRequest,
} from "./credential-http-validation.js";
import { registerProviderSetupHttp } from "./provider-setup-http.js";

const MAX_CREDENTIAL_REQUEST_BYTES = 8 * 1024;
const MAX_CREDENTIAL_SECRET_REQUEST_BYTES = 16 * 1024;

type CredentialHttpStore = Pick<
  LocalStore,
  | "appendEvent"
  | "createCredentialReference"
  | "getThread"
  | "listCredentialReferences"
  | "setCredentialReferenceStatus"
>;

export interface CredentialHttpServices {
  store: CredentialHttpStore;
  models: ModelRegistry;
  credentials: CredentialReferenceStore;
  providerSetup: ProviderSetupService;
}

export function registerCredentialHttp(
  app: Hono,
  services: CredentialHttpServices,
): void {
  registerProviderSetupHttp(app, services.providerSetup);
  app.get("/api/credentials", (context) => {
    const references = services.store.listCredentialReferences();
    setCredentialReferenceListHeaders(context, references);
    return context.json(references);
  });

  app.post("/api/credentials", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_CREDENTIAL_REQUEST_BYTES,
        "Credential reference request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseCreateCredentialReferenceRequest(input);
    if (!body) {
      return jsonError(context, "Credential reference request is invalid", 400);
    }
    if (body.threadId) services.store.getThread(body.threadId);
    if (!services.models.models.getProvider(body.providerId)) {
      return jsonError(context, `Provider not found: ${body.providerId}`, 400);
    }
    const reference = await services.store.createCredentialReference(body);
    await appendCredentialEvent(
      services.store,
      body.threadId,
      "credential.reference.created",
      reference,
    );
    setCredentialReferenceHeaders(context, reference);
    return context.json(reference, 201);
  });

  app.post("/api/credentials/macos-keychain", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_CREDENTIAL_SECRET_REQUEST_BYTES,
        "macOS Keychain credential request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseCreateMacOsKeychainCredentialRequest(input);
    if (!body) {
      return jsonError(
        context,
        "macOS Keychain credential request is invalid",
        400,
      );
    }
    if (body.threadId) services.store.getThread(body.threadId);
    if (!services.models.models.getProvider(body.providerId)) {
      return jsonError(context, `Provider not found: ${body.providerId}`, 400);
    }
    let reference;
    try {
      reference = await services.credentials.createMacOsKeychainReference(body);
    } catch (error) {
      if (isCredentialReferenceMutationError(error)) {
        return jsonError(context, error.message, 400);
      }
      throw error;
    }
    await appendCredentialEvent(
      services.store,
      body.threadId,
      "credential.reference.keychain_created",
      reference,
    );
    setCredentialReferenceHeaders(context, reference);
    return context.json(reference, 201);
  });

  app.post("/api/credentials/:referenceId/check", async (context) => {
    let input: unknown;
    try {
      input = await readOptionalLimitedJson(
        context.req.raw,
        MAX_CREDENTIAL_REQUEST_BYTES,
        "Credential check request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseCredentialThreadContextRequest(input);
    if (!body) {
      return jsonError(context, "Credential check request is invalid", 400);
    }
    if (body.threadId) services.store.getThread(body.threadId);
    const reference = await services.credentials.check(
      context.req.param("referenceId"),
    );
    await appendCredentialEvent(
      services.store,
      body.threadId,
      "credential.reference.checked",
      reference,
    );
    setCredentialReferenceHeaders(context, reference);
    return context.json(reference);
  });

  app.post("/api/credentials/:referenceId/status", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_CREDENTIAL_REQUEST_BYTES,
        "Credential status request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseSetCredentialReferenceStatusRequest(input);
    if (!body) {
      return jsonError(context, "Credential status request is invalid", 400);
    }
    if (body.threadId) services.store.getThread(body.threadId);
    const reference = await services.store.setCredentialReferenceStatus(
      context.req.param("referenceId"),
      body.status,
    );
    await appendCredentialEvent(
      services.store,
      body.threadId,
      body.status === "active"
        ? "credential.reference.enabled"
        : "credential.reference.disabled",
      reference,
    );
    setCredentialReferenceHeaders(context, reference);
    return context.json(reference);
  });
}

function isCredentialReferenceMutationError(error: unknown): error is Error {
  if (!(error instanceof Error)) return false;
  return (
    error.message.startsWith("Provider already has an active credential") ||
    error.message.startsWith("Credential reference source already exists") ||
    error.message.startsWith("Credential secret") ||
    error.message.startsWith("macOS Keychain")
  );
}

function setCredentialReferenceListHeaders(
  context: Context,
  references: readonly CredentialReference[],
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, references);
  context.header("X-Napier-Credential-Count", String(references.length));
  for (const status of [
    "active",
    "disabled",
  ] satisfies CredentialReference["status"][]) {
    context.header(
      `X-Napier-Credential-${status[0]!.toUpperCase()}${status.slice(1)}-Count`,
      String(
        references.filter((reference) => reference.status === status).length,
      ),
    );
  }
  for (const availability of [
    "unknown",
    "available",
    "missing",
    "error",
  ] satisfies CredentialReference["availability"][]) {
    context.header(
      `X-Napier-Credential-${availability[0]!.toUpperCase()}${availability.slice(1)}-Count`,
      String(
        references.filter(
          (reference) => reference.availability === availability,
        ).length,
      ),
    );
  }
}

function setCredentialReferenceHeaders(
  context: Context,
  reference: CredentialReference,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, reference);
  context.header("X-Napier-Credential-Id", reference.id);
  context.header("X-Napier-Credential-Provider", reference.providerId);
  context.header("X-Napier-Credential-Source-Type", reference.source.type);
  context.header("X-Napier-Credential-Status", reference.status);
  context.header("X-Napier-Credential-Availability", reference.availability);
  context.header("X-Napier-Credential-Revision", String(reference.revision));
  if (reference.lastCheckedAt) {
    context.header(
      "X-Napier-Credential-Last-Checked-At",
      reference.lastCheckedAt,
    );
  }
}

async function appendCredentialEvent(
  store: CredentialHttpStore,
  threadId: string | undefined,
  type: string,
  reference: CredentialReference,
): Promise<void> {
  if (!threadId) return;
  await store.appendEvent({
    threadId,
    runId: createId("runctl"),
    type,
    category: "credential",
    visibility: "user",
    payload: {
      referenceId: reference.id,
      providerId: reference.providerId,
      label: reference.label,
      sourceType: reference.source.type,
      status: reference.status,
      availability: reference.availability,
      revision: reference.revision,
      ...(reference.lastError ? { error: reference.lastError } : {}),
    },
  });
}
