import type { CredentialReference } from "@napier/contracts";
import type { LocalAgentRuntimeServices } from "@napier/runtime/agent";

import type { CliCredentialBootstrapOptions } from "./cli-credential-options.js";
import { CliPublicError } from "./cli-public-error.js";

export async function configureCliModelCredential(
  services: LocalAgentRuntimeServices,
  options: CliCredentialBootstrapOptions,
  env: Readonly<Record<string, string | undefined>>,
): Promise<void> {
  if (!options.credentialEnv) return;
  const model = options.model;
  if (!model || model.provider === "napier") {
    throw new Error("CLI credential bootstrap requires a live model");
  }
  if (!env[options.credentialEnv]?.trim()) {
    throw new CliPublicError(
      "credential_env_unavailable",
      `Credential environment variable is unavailable: ${options.credentialEnv}`,
    );
  }
  const active = services.store.getActiveCredentialReference(model.provider);
  if (active) {
    assertMatchingEnvironmentReference(active, options.credentialEnv);
    await assertCredentialAvailable(services, active);
  } else {
    const reusable = services.store
      .listCredentialReferences()
      .find(
        (reference) =>
          reference.providerId === model.provider &&
          reference.source.type === "environment" &&
          reference.source.variable === options.credentialEnv,
      );
    const reference = reusable
      ? await services.store.setCredentialReferenceStatus(reusable.id, "active")
      : await services.store.createCredentialReference({
          providerId: model.provider,
          label: `CLI ${model.provider} environment`,
          source: {
            type: "environment",
            variable: options.credentialEnv,
          },
        });
    await assertCredentialAvailable(services, reference);
  }
  if (!(await services.models.isConfigured(model))) {
    throw new CliPublicError(
      "model_unavailable",
      `CLI model is unavailable after credential bootstrap: ${model.provider}/${model.id}`,
    );
  }
}

function assertMatchingEnvironmentReference(
  reference: CredentialReference,
  variable: string,
): void {
  if (
    reference.source.type !== "environment" ||
    reference.source.variable !== variable
  ) {
    throw new CliPublicError(
      "credential_reference_conflict",
      `Provider already uses a different active credential reference: ${reference.providerId}`,
    );
  }
}

async function assertCredentialAvailable(
  services: LocalAgentRuntimeServices,
  reference: CredentialReference,
): Promise<void> {
  const checked = await services.credentials.check(reference.id);
  if (checked.availability !== "available") {
    throw new CliPublicError(
      "credential_reference_unavailable",
      `Credential environment reference is unavailable: ${reference.providerId}`,
    );
  }
}
