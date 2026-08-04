import type { ProviderSetupPreview } from "@napier/contracts/provider-setup";
import { describe, expect, it } from "vitest";

import {
  providerSetupEnableCandidate,
  providerSetupReadyCandidate,
  providerSetupStatusCopy,
} from "../src/provider-setup-view-model";
import { shouldShowWelcomePanel } from "../src/WelcomePanel";

describe("Provider setup view model", () => {
  it("selects only an explicitly available candidate for Enable", () => {
    const preview = fixture();

    expect(providerSetupEnableCandidate(preview)?.providerId).toBe("deepseek");
    expect(providerSetupReadyCandidate(preview)).toBeUndefined();
    expect(providerSetupStatusCopy("available")).toEqual({
      label: "Found",
      detail:
        "The environment locator exists. Enable it explicitly for Napier.",
    });
  });

  it("never offers ready, missing, conflicting, or unavailable candidates", () => {
    const preview = fixture();
    preview.candidates[0]!.status = "ready";
    preview.candidates[1]!.status = "conflict";

    expect(providerSetupEnableCandidate(preview)).toBeUndefined();
    expect(providerSetupReadyCandidate(preview)?.providerId).toBe("deepseek");
  });

  it("keeps first-use setup visible through the onboarding assistant message", () => {
    expect(
      shouldShowWelcomePanel([{ role: "assistant" }, { role: "system" }]),
    ).toBe(true);
    expect(
      shouldShowWelcomePanel([{ role: "assistant" }, { role: "user" }]),
    ).toBe(false);
  });
});

function fixture(): ProviderSetupPreview {
  return {
    kind: "napier.provider-setup-preview",
    schemaVersion: 1,
    candidates: [
      {
        providerId: "deepseek",
        providerName: "DeepSeek",
        environmentVariable: "DEEPSEEK_API_KEY",
        model: { provider: "deepseek", id: "deepseek-v4-flash" },
        status: "available",
      },
      {
        providerId: "openai",
        providerName: "OpenAI",
        environmentVariable: "OPENAI_API_KEY",
        model: { provider: "openai", id: "gpt-4.1" },
        status: "missing",
      },
    ],
    recommendedProviderId: "deepseek",
    candidateCount: 2,
    readyCount: 0,
    availableCount: 1,
    candidateSetSha256: "a".repeat(64),
    contentSha256: "b".repeat(64),
  };
}
