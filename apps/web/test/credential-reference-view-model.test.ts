import { describe, expect, it } from "vitest";

import {
  applyCredentialProviderDraft,
  credentialReferenceDraft,
} from "../src/credential-reference-view-model";

describe("credential reference view model", () => {
  it("suggests provider-specific environment variable references", () => {
    expect(credentialReferenceDraft("deepseek")).toEqual({
      providerId: "deepseek",
      label: "DeepSeek key",
      environmentVariable: "DEEPSEEK_API_KEY",
      keychainService: "napier.deepseek",
      keychainAccount: "workspace",
    });
  });

  it("updates untouched defaults when switching providers", () => {
    expect(
      applyCredentialProviderDraft({
        previousProviderId: "openai",
        nextProviderId: "deepseek",
        label: "OpenAI key",
        environmentVariable: "OPENAI_API_KEY",
        keychainService: "napier.openai",
        keychainAccount: "workspace",
      }),
    ).toEqual({
      providerId: "deepseek",
      label: "DeepSeek key",
      environmentVariable: "DEEPSEEK_API_KEY",
      keychainService: "napier.deepseek",
      keychainAccount: "workspace",
    });
  });

  it("preserves custom locator fields when switching providers", () => {
    expect(
      applyCredentialProviderDraft({
        previousProviderId: "openai",
        nextProviderId: "deepseek",
        label: "Shared production key",
        environmentVariable: "NAPIER_SHARED_MODEL_KEY",
        keychainService: "napier.shared",
        keychainAccount: "production",
      }),
    ).toEqual({
      providerId: "deepseek",
      label: "Shared production key",
      environmentVariable: "NAPIER_SHARED_MODEL_KEY",
      keychainService: "napier.shared",
      keychainAccount: "production",
    });
  });

  it("derives safe defaults for catalog providers without overrides", () => {
    expect(credentialReferenceDraft("moonshotai-cn")).toEqual({
      providerId: "moonshotai-cn",
      label: "Moonshotai Cn key",
      environmentVariable: "MOONSHOTAI_CN_API_KEY",
      keychainService: "napier.moonshotai-cn",
      keychainAccount: "workspace",
    });
  });
});
