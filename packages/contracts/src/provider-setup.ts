import type { ModelRef } from "./index.js";

export const STANDARD_PROVIDER_SETUP_DEFINITIONS = [
  {
    providerId: "deepseek",
    environmentVariable: "DEEPSEEK_API_KEY",
    credentialLabel: "DeepSeek key",
    model: { provider: "deepseek", id: "deepseek-v4-flash" },
  },
  {
    providerId: "openrouter",
    environmentVariable: "OPENROUTER_API_KEY",
    credentialLabel: "OpenRouter key",
    model: { provider: "openrouter", id: "anthropic/claude-haiku-4.5" },
  },
  {
    providerId: "anthropic",
    environmentVariable: "ANTHROPIC_API_KEY",
    credentialLabel: "Anthropic key",
    model: { provider: "anthropic", id: "claude-haiku-4-5" },
  },
  {
    providerId: "openai",
    environmentVariable: "OPENAI_API_KEY",
    credentialLabel: "OpenAI key",
    model: { provider: "openai", id: "gpt-4.1" },
  },
  {
    providerId: "google",
    environmentVariable: "GEMINI_API_KEY",
    credentialLabel: "Google Gemini key",
    model: { provider: "google", id: "gemini-2.5-flash" },
  },
] as const satisfies readonly {
  providerId: string;
  environmentVariable: string;
  credentialLabel: string;
  model: ModelRef;
}[];

export type ProviderSetupCandidateStatus =
  | "ready"
  | "available"
  | "missing"
  | "conflict"
  | "unavailable";

export interface ProviderSetupCandidate {
  providerId: string;
  providerName: string;
  environmentVariable: string;
  model: ModelRef;
  status: ProviderSetupCandidateStatus;
  referenceIdSha256?: string;
}

export interface ProviderSetupPreview {
  kind: "napier.provider-setup-preview";
  schemaVersion: 1;
  candidates: ProviderSetupCandidate[];
  recommendedProviderId?: string;
  candidateCount: number;
  readyCount: number;
  availableCount: number;
  candidateSetSha256: string;
  contentSha256: string;
}

export interface ApplyProviderSetupRequest {
  providerId: string;
  expectedPreviewSha256: string;
}

export interface ProviderSetupResult {
  kind: "napier.provider-setup-result";
  schemaVersion: 1;
  providerId: string;
  model: ModelRef;
  status: "ready";
  action: "existing" | "created" | "enabled";
  referenceIdSha256: string;
  previewSha256: string;
  contentSha256: string;
}
