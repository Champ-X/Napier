import { generateKeyPairSync } from "node:crypto";

import type { AgentProfile } from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { createAgentProfileRevision } from "../src/agents.js";
import {
  createExtensionPublisherTrustAnchor,
  revokeExtensionPublisherTrustAnchor,
} from "../src/extension-packages.js";
import {
  qualifyAgentPromptPackage,
  signPromptPackage,
  verifySignedPromptPackageEnvelope,
} from "../src/prompt-packages.js";

const SIGNING_KEY_ENV = "NAPIER_TEST_PROMPT_PACKAGE_KEY";
const PRIVATE_PROMPT =
  "Private prompt invariant: never copy this text into signed packages.";

afterEach(() => {
  delete process.env[SIGNING_KEY_ENV];
});

function createAnchor() {
  const { privateKey } = generateKeyPairSync("ed25519");
  process.env[SIGNING_KEY_ENV] = privateKey
    .export({ format: "pem", type: "pkcs8" })
    .toString();
  return createExtensionPublisherTrustAnchor({
    threadId: "thread_promptpkg",
    label: "Prompt publisher",
    source: { type: "environment", variable: SIGNING_KEY_ENV },
  });
}

function createProfile(
  overrides: Partial<Pick<AgentProfile, "systemPrompt" | "revision">> = {},
): AgentProfile {
  return {
    id: "agent_promptpkg",
    name: "Prompt Package Agent",
    description: "Agent used to verify signed Prompt package provenance.",
    systemPrompt: overrides.systemPrompt ?? PRIVATE_PROMPT,
    model: { provider: "napier", id: "demo" },
    thinkingLevel: "medium",
    toolPolicy: "observe",
    enabledTools: ["read_file"],
    enabledSkills: ["software-delivery"],
    revision: overrides.revision ?? 1,
    createdAt: "2026-07-25T00:00:00.000Z",
    updatedAt: "2026-07-25T00:00:00.000Z",
  };
}

describe("signed Prompt packages", () => {
  it("signs hash-only prompt provenance and qualifies local Agent state", () => {
    const anchor = createAnchor();
    const profile = createProfile();
    const revision = createAgentProfileRevision(profile, { source: "created" });

    const envelope = signPromptPackage(
      profile,
      revision,
      "Prompt Registry",
      anchor,
    );

    expect(envelope).toEqual(
      expect.objectContaining({
        kind: "napier.signed-prompt-package",
        manifest: expect.objectContaining({
          kind: "napier.prompt-package-manifest",
          publisher: "Prompt Registry",
          sourceAgentId: profile.id,
          agentName: profile.name,
          agentRevision: 1,
          agentRevisionSha256: revision.contentSha256,
          systemPromptSha256: revision.systemPromptSha256,
        }),
      }),
    );
    expect(JSON.stringify(envelope)).not.toContain(PRIVATE_PROMPT);
    expect(verifySignedPromptPackageEnvelope(envelope, [anchor])).toEqual(
      expect.objectContaining({
        status: "trusted",
        manifestSha256: envelope.manifest.contentSha256,
        envelopeSha256: envelope.contentSha256,
        keyId: anchor.keyId,
      }),
    );
    expect(verifySignedPromptPackageEnvelope(envelope, [])).toEqual(
      expect.objectContaining({
        status: "unknown_key",
        keyId: anchor.keyId,
      }),
    );
    expect(
      verifySignedPromptPackageEnvelope(envelope, [
        revokeExtensionPublisherTrustAnchor(anchor),
      ]),
    ).toEqual(
      expect.objectContaining({
        status: "revoked",
        keyId: anchor.keyId,
      }),
    );
    expect(qualifyAgentPromptPackage(envelope, [anchor], profile)).toEqual(
      expect.objectContaining({
        status: "qualified",
        verificationStatus: "trusted",
        systemPromptSha256: envelope.manifest.systemPromptSha256,
        observedSystemPromptSha256: envelope.manifest.systemPromptSha256,
        sourceAgentId: profile.id,
        observedAgentId: profile.id,
        observedAgentRevision: profile.revision,
      }),
    );

    const driftedProfile = createProfile({
      systemPrompt: "Changed prompt invariant.",
      revision: 2,
    });
    expect(
      qualifyAgentPromptPackage(envelope, [anchor], driftedProfile),
    ).toEqual(
      expect.objectContaining({
        status: "prompt_drift",
        verificationStatus: "trusted",
        systemPromptSha256: envelope.manifest.systemPromptSha256,
        observedSystemPromptSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        observedAgentId: profile.id,
        observedAgentRevision: 2,
      }),
    );
    expect(qualifyAgentPromptPackage(envelope, [anchor], undefined)).toEqual(
      expect.objectContaining({
        status: "agent_missing",
        verificationStatus: "trusted",
        systemPromptSha256: envelope.manifest.systemPromptSha256,
        sourceAgentId: profile.id,
      }),
    );

    const tampered = structuredClone(envelope);
    tampered.manifest.systemPromptSha256 = "0".repeat(64);
    expect(verifySignedPromptPackageEnvelope(tampered, [anchor])).toEqual(
      expect.objectContaining({
        status: "invalid",
      }),
    );
  });
});
