import { STANDARD_PROVIDER_SETUP_DEFINITIONS } from "@napier/contracts/provider-setup";

export interface CredentialReferenceDraft {
  providerId: string;
  label: string;
  environmentVariable: string;
  keychainService: string;
  keychainAccount: string;
}

export interface CredentialReferenceDraftInput {
  previousProviderId: string;
  nextProviderId: string;
  label: string;
  environmentVariable: string;
  keychainService: string;
  keychainAccount: string;
}

const PROVIDER_DEFAULTS: Record<
  string,
  Omit<CredentialReferenceDraft, "providerId" | "keychainAccount">
> = Object.fromEntries(
  STANDARD_PROVIDER_SETUP_DEFINITIONS.map((definition) => [
    definition.providerId,
    {
      label: definition.credentialLabel,
      environmentVariable: definition.environmentVariable,
      keychainService: `napier.${definition.providerId}`,
    },
  ]),
);

export function credentialReferenceDraft(
  providerId: string,
): CredentialReferenceDraft {
  const normalized = normalizeProviderId(providerId);
  const defaults = PROVIDER_DEFAULTS[normalized] ?? {
    label: `${titleCaseProvider(normalized)} key`,
    environmentVariable: `${environmentProviderName(normalized)}_API_KEY`,
    keychainService: `napier.${normalized}`,
  };
  return {
    providerId: normalized,
    ...defaults,
    keychainAccount: "workspace",
  };
}

export function applyCredentialProviderDraft(
  input: CredentialReferenceDraftInput,
): CredentialReferenceDraft {
  const previous = credentialReferenceDraft(input.previousProviderId);
  const next = credentialReferenceDraft(input.nextProviderId);
  return {
    providerId: next.providerId,
    label: keepCustom(input.label, previous.label, next.label),
    environmentVariable: keepCustom(
      input.environmentVariable,
      previous.environmentVariable,
      next.environmentVariable,
    ),
    keychainService: keepCustom(
      input.keychainService,
      previous.keychainService,
      next.keychainService,
    ),
    keychainAccount: keepCustom(
      input.keychainAccount,
      previous.keychainAccount,
      next.keychainAccount,
    ),
  };
}

function keepCustom(
  currentValue: string,
  previousDefault: string,
  nextDefault: string,
): string {
  const trimmed = currentValue.trim();
  return trimmed.length === 0 || trimmed === previousDefault
    ? nextDefault
    : currentValue;
}

function normalizeProviderId(providerId: string): string {
  return providerId.trim().toLowerCase();
}

function environmentProviderName(providerId: string): string {
  return providerId.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

function titleCaseProvider(providerId: string): string {
  return providerId
    .split(/[^a-z0-9]+/u)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
