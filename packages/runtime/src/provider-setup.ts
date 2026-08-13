import type {
  ApplyProviderSetupRequest,
  ProviderSetupCandidate,
  ProviderSetupPreview,
  ProviderSetupResult,
} from "@napier/contracts/provider-setup";
import { STANDARD_PROVIDER_SETUP_DEFINITIONS } from "@napier/contracts/provider-setup";

import { canonicalJson, sha256 } from "./ed25519.js";
import type { CredentialReferenceStore } from "./credentials.js";
import type { ModelRegistry } from "./models.js";
import type { LocalStore } from "./store.js";

type ProviderSetupStore = Pick<
  LocalStore,
  | "createCredentialReference"
  | "getActiveCredentialReference"
  | "listCredentialReferences"
  | "setCredentialReferenceStatus"
>;

export class ProviderSetupService {
  constructor(
    private readonly store: ProviderSetupStore,
    private readonly credentials: Pick<CredentialReferenceStore, "check">,
    private readonly models: Pick<
      ModelRegistry,
      "isConfigured" | "models" | "resolve"
    >,
    private readonly env: Readonly<Record<string, string | undefined>>,
  ) {}

  async preview(): Promise<ProviderSetupPreview> {
    const candidates = await Promise.all(
      STANDARD_PROVIDER_SETUP_DEFINITIONS.map((candidate) =>
        this.candidate(candidate.providerId),
      ),
    );
    const recommended =
      candidates.find((candidate) => candidate.status === "ready") ??
      candidates.find((candidate) => candidate.status === "available");
    const candidateSetSha256 = sha256(
      canonicalJson(
        candidates.map((candidate) => ({
          providerId: candidate.providerId,
          environmentVariable: candidate.environmentVariable,
          model: candidate.model,
          status: candidate.status,
          referenceIdSha256: candidate.referenceIdSha256 ?? "",
        })),
      ),
    );
    const content = {
      kind: "napier.provider-setup-preview" as const,
      schemaVersion: 1 as const,
      candidates,
      ...(recommended ? { recommendedProviderId: recommended.providerId } : {}),
      candidateCount: candidates.length,
      readyCount: candidates.filter((candidate) => candidate.status === "ready")
        .length,
      availableCount: candidates.filter(
        (candidate) => candidate.status === "available",
      ).length,
      candidateSetSha256,
    };
    return { ...content, contentSha256: sha256(canonicalJson(content)) };
  }

  async apply(
    request: ApplyProviderSetupRequest,
  ): Promise<ProviderSetupResult> {
    const preview = await this.preview();
    if (request.expectedPreviewSha256 !== preview.contentSha256) {
      throw new Error("Provider setup preview changed");
    }
    const candidate = preview.candidates.find(
      (entry) => entry.providerId === request.providerId,
    );
    if (!candidate) throw new Error("Provider setup candidate is invalid");
    if (
      candidate.status === "missing" ||
      candidate.status === "conflict" ||
      candidate.status === "unavailable"
    ) {
      throw new Error(`Provider setup candidate is ${candidate.status}`);
    }

    const active = this.store.getActiveCredentialReference(
      candidate.providerId,
    );
    let action: ProviderSetupResult["action"] = "existing";
    let reference = active;
    if (!reference) {
      const reusable = this.store
        .listCredentialReferences()
        .find(
          (entry) =>
            entry.providerId === candidate.providerId &&
            entry.source.type === "environment" &&
            entry.source.variable === candidate.environmentVariable,
        );
      if (reusable) {
        reference = await this.store.setCredentialReferenceStatus(
          reusable.id,
          "active",
        );
        action = "enabled";
      } else {
        const definition = providerDefinition(candidate.providerId);
        reference = await this.store.createCredentialReference({
          providerId: definition.providerId,
          label: definition.credentialLabel,
          source: {
            type: "environment",
            variable: definition.environmentVariable,
          },
        });
        action = "created";
      }
    }
    const checked = await this.credentials.check(reference.id);
    if (checked.availability !== "available") {
      if (action !== "existing") {
        await this.store.setCredentialReferenceStatus(reference.id, "disabled");
      }
      throw new Error("Provider setup credential is unavailable");
    }
    if (!(await this.models.isConfigured(candidate.model))) {
      if (action !== "existing") {
        await this.store.setCredentialReferenceStatus(reference.id, "disabled");
      }
      throw new Error("Provider setup model is unavailable");
    }
    const content = {
      kind: "napier.provider-setup-result" as const,
      schemaVersion: 1 as const,
      providerId: candidate.providerId,
      model: candidate.model,
      status: "ready" as const,
      action,
      referenceIdSha256: sha256(reference.id),
      previewSha256: preview.contentSha256,
    };
    return { ...content, contentSha256: sha256(canonicalJson(content)) };
  }

  private async candidate(providerId: string): Promise<ProviderSetupCandidate> {
    const definition = providerDefinition(providerId);
    const provider = this.models.models.getProvider(providerId);
    const model = this.models.resolve({
      provider: providerId,
      id: definition.model.id,
    });
    const reference = this.store.getActiveCredentialReference(providerId);
    const environmentAvailable = Boolean(
      this.env[definition.environmentVariable]?.trim(),
    );
    const referenceMatches =
      reference?.source.type === "environment" &&
      reference.source.variable === definition.environmentVariable;
    const modelRef = model
      ? { provider: model.provider, id: model.id }
      : { provider: providerId, id: "unavailable" };
    let status: ProviderSetupCandidate["status"];
    if (!provider || !model) status = "unavailable";
    else if (reference && !referenceMatches) status = "conflict";
    else if (reference && (await this.models.isConfigured(modelRef))) {
      status = "ready";
    } else if (environmentAvailable) status = "available";
    else status = "missing";
    return {
      providerId,
      providerName: provider?.name ?? providerId,
      environmentVariable: definition.environmentVariable,
      model: modelRef,
      status,
      ...(reference ? { referenceIdSha256: sha256(reference.id) } : {}),
    };
  }
}

function providerDefinition(providerId: string) {
  const definition = STANDARD_PROVIDER_SETUP_DEFINITIONS.find(
    (candidate) => candidate.providerId === providerId,
  );
  if (!definition) throw new Error("Provider setup candidate is invalid");
  return definition;
}
