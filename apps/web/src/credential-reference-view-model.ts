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
> = {
  anthropic: {
    label: "Anthropic key",
    environmentVariable: "ANTHROPIC_API_KEY",
    keychainService: "napier.anthropic",
  },
  deepseek: {
    label: "DeepSeek key",
    environmentVariable: "DEEPSEEK_API_KEY",
    keychainService: "napier.deepseek",
  },
  google: {
    label: "Google Gemini key",
    environmentVariable: "GEMINI_API_KEY",
    keychainService: "napier.google",
  },
  openai: {
    label: "OpenAI key",
    environmentVariable: "OPENAI_API_KEY",
    keychainService: "napier.openai",
  },
  openrouter: {
    label: "OpenRouter key",
    environmentVariable: "OPENROUTER_API_KEY",
    keychainService: "napier.openrouter",
  },
};

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
