import { createHash } from "node:crypto";

import type { AgentProfile } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  compareRunConfigurations,
  createRunConfigurationFingerprint,
  fingerprintAutomaticRecovery,
  fingerprintExecutionMode,
  fingerprintModelAdvisor,
  fingerprintSkillCatalogSha256,
  validateRunConfigurationFingerprint,
} from "../src/run-config.js";
import { createPromptVariableCatalog } from "../src/prompt-variables.js";

const PROFILE: AgentProfile = {
  id: "agent_config",
  name: "Configuration Agent",
  description: "Configuration-bound replay fixture.",
  systemPrompt: "Never expose this exact historical instruction.",
  model: { provider: "napier", id: "demo" },
  thinkingLevel: "medium",
  toolPolicy: "workspace",
  enabledTools: ["verify_workspace", "read_file"],
  enabledSkills: ["software-delivery", "artifact-studio"],
  enabledSubagents: ["reviewer", "researcher"],
  subagentLimits: {
    maxConcurrent: 2,
    maxTotal: 6,
    maxTurns: 12,
    timeoutMs: 180_000,
  },
  runLimits: {
    maxTurns: 40,
    maxTotalTokens: 500_000,
    maxCostUsd: 15,
    timeoutMs: 1_200_000,
  },
  modelAdvisor: {
    mode: "observe",
    enabledRules: ["destructive_command_reference"],
    maxCorrectionAttempts: 2,
  },
  revision: 7,
  createdAt: "2026-07-25T00:00:00.000Z",
  updatedAt: "2026-07-25T00:10:00.000Z",
};

describe("Run configuration fingerprints", () => {
  it("binds effective runtime configuration without copying prompt content", () => {
    const first = createRunConfigurationFingerprint(PROFILE, {
      provider: "openrouter",
      id: "anthropic/claude-sonnet",
    });
    const reordered = createRunConfigurationFingerprint(
      {
        ...PROFILE,
        enabledTools: [...PROFILE.enabledTools].reverse(),
        enabledSkills: [...PROFILE.enabledSkills].reverse(),
        enabledSubagents: [...PROFILE.enabledSubagents!].reverse(),
      },
      {
        provider: "openrouter",
        id: "anthropic/claude-sonnet",
      },
    );

    expect(first.contentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.contentSha256).toBe(reordered.contentSha256);
    expect(first.schemaVersion).toBe(2);
    expect(first.model).toEqual({
      provider: "openrouter",
      id: "anthropic/claude-sonnet",
    });
    expect(JSON.stringify(first)).not.toContain(PROFILE.systemPrompt);
    expect(validateRunConfigurationFingerprint(first)).toEqual(first);
  });

  it("preserves schema-1 hashes while defaulting legacy recovery to manual", () => {
    const current = createRunConfigurationFingerprint(PROFILE);
    if (current.schemaVersion !== 2) {
      throw new Error("Expected a schema-2 fingerprint");
    }
    const {
      automaticRecovery: _automaticRecovery,
      executionMode: _executionMode,
      contentSha256: _contentSha256,
      schemaVersion: _schemaVersion,
      ...shared
    } = current;
    const content = {
      schemaVersion: 1 as const,
      ...shared,
    };
    const legacy = {
      ...content,
      contentSha256: createHash("sha256")
        .update(canonicalJson(content))
        .digest("hex"),
    };

    expect(validateRunConfigurationFingerprint(legacy)).toEqual(legacy);
    expect(fingerprintAutomaticRecovery(legacy)).toEqual({
      mode: "manual",
      maxAttempts: 2,
      backoffMs: 5_000,
    });
    expect(fingerprintExecutionMode(legacy)).toBe("standard");

    const safe = createRunConfigurationFingerprint(
      {
        ...PROFILE,
        automaticRecovery: {
          mode: "safe_read_only",
          maxAttempts: 3,
          backoffMs: 10_000,
        },
      },
      PROFILE.model,
      "safe_read_only_recovery",
    );
    expect(safe).toEqual(
      expect.objectContaining({
        schemaVersion: 2,
        toolPolicy: "observe",
        enabledTools: ["read_file"],
        enabledSubagents: [],
        executionMode: "safe_read_only_recovery",
      }),
    );
    const map = createRunConfigurationFingerprint(
      PROFILE,
      PROFILE.model,
      "workflow_map_read_only",
    );
    expect(validateRunConfigurationFingerprint(map)).toEqual(
      expect.objectContaining({
        toolPolicy: "observe",
        enabledTools: ["read_file"],
        enabledSubagents: [],
        executionMode: "workflow_map_read_only",
      }),
    );
  });

  it("binds Skill catalog hashes without copying Skill instructions", () => {
    const skillCatalogSha256 = "a".repeat(64);
    const fingerprint = createRunConfigurationFingerprint(
      PROFILE,
      PROFILE.model,
      "standard",
      { skillCatalogSha256 },
    );

    expect(fingerprint).toEqual(
      expect.objectContaining({
        schemaVersion: 5,
        skillCatalogSha256,
        modelAdvisor: {
          mode: "observe",
          enabledRules: ["destructive_command_reference"],
          maxCorrectionAttempts: 2,
        },
        executionMode: "standard",
      }),
    );
    expect(fingerprintSkillCatalogSha256(fingerprint)).toBe(skillCatalogSha256);
    expect(fingerprintModelAdvisor(fingerprint)).toEqual({
      mode: "observe",
      enabledRules: ["destructive_command_reference"],
      maxCorrectionAttempts: 2,
    });
    expect(JSON.stringify(fingerprint)).not.toContain(PROFILE.systemPrompt);
    expect(validateRunConfigurationFingerprint(fingerprint)).toEqual(
      fingerprint,
    );

    const drifted = structuredClone(fingerprint);
    drifted.skillCatalogSha256 = "b".repeat(64);
    expect(() => validateRunConfigurationFingerprint(drifted)).toThrow(
      "hash mismatch",
    );
  });

  it("binds an independent Advisor model in schema-6 fingerprints", () => {
    const fingerprint = createRunConfigurationFingerprint(
      {
        ...PROFILE,
        modelAdvisor: {
          ...PROFILE.modelAdvisor!,
          reviewModel: {
            provider: "openrouter",
            id: "anthropic/claude-sonnet",
          },
        },
      },
      PROFILE.model,
      "standard",
      { skillCatalogSha256: "a".repeat(64) },
    );

    expect(fingerprint).toEqual(
      expect.objectContaining({
        schemaVersion: 6,
        modelAdvisor: {
          mode: "observe",
          enabledRules: ["destructive_command_reference"],
          maxCorrectionAttempts: 2,
          reviewModel: {
            provider: "openrouter",
            id: "anthropic/claude-sonnet",
          },
        },
      }),
    );
    expect(validateRunConfigurationFingerprint(fingerprint)).toEqual(
      fingerprint,
    );
    expect(fingerprintModelAdvisor(fingerprint)).toEqual(
      fingerprint.modelAdvisor,
    );

    const missingReviewer = structuredClone(fingerprint);
    delete missingReviewer.modelAdvisor.reviewModel;
    const content = {
      ...missingReviewer,
      contentSha256: undefined,
    };
    missingReviewer.contentSha256 = createHash("sha256")
      .update(canonicalJson(content))
      .digest("hex");
    expect(() => validateRunConfigurationFingerprint(missingReviewer)).toThrow(
      "schema 6 requires a review model",
    );
  });

  it("binds Prompt Variables and Tool Loop Guard in schema-8 fingerprints", () => {
    const profile: AgentProfile = {
      ...PROFILE,
      promptVariables: [{ name: "project", type: "literal", value: "Napier" }],
    };
    const promptVariableCatalogSha256 = createPromptVariableCatalog(
      profile.promptVariables,
    ).contentSha256;
    const fingerprint = createRunConfigurationFingerprint(
      profile,
      PROFILE.model,
      "standard",
      {
        skillCatalogSha256: "a".repeat(64),
        promptVariables: {
          catalogSha256: promptVariableCatalogSha256,
          snapshotSha256: "c".repeat(64),
          renderedSystemPromptSha256: "d".repeat(64),
        },
      },
    );

    expect(fingerprint).toEqual(
      expect.objectContaining({
        schemaVersion: 8,
        skillCatalogSha256: "a".repeat(64),
        promptVariableCatalogSha256,
        promptVariableSnapshotSha256: "c".repeat(64),
        resolvedSystemPromptSha256: "d".repeat(64),
        toolLoopGuard: {
          enabled: true,
          threshold: 3,
          exemptTools: [],
        },
      }),
    );
    expect(JSON.stringify(fingerprint)).not.toContain("Napier");
    expect(validateRunConfigurationFingerprint(fingerprint)).toEqual(
      fingerprint,
    );
    if (fingerprint.schemaVersion !== 8) {
      throw new Error("Expected a schema-8 fingerprint");
    }
    const {
      schemaVersion: _schemaVersion,
      toolLoopGuard: _toolLoopGuard,
      contentSha256: _contentSha256,
      ...legacyShared
    } = fingerprint;
    const legacyContent = {
      ...legacyShared,
      schemaVersion: 7 as const,
    };
    const legacy = {
      ...legacyContent,
      contentSha256: createHash("sha256")
        .update(canonicalJson(legacyContent))
        .digest("hex"),
    };
    expect(validateRunConfigurationFingerprint(legacy)).toEqual(legacy);

    const receiptOnlyDrift = createRunConfigurationFingerprint(
      profile,
      PROFILE.model,
      "standard",
      {
        skillCatalogSha256: "a".repeat(64),
        promptVariables: {
          catalogSha256: promptVariableCatalogSha256,
          snapshotSha256: "e".repeat(64),
          renderedSystemPromptSha256: "d".repeat(64),
        },
      },
    );
    expect(compareRunConfigurations(fingerprint, receiptOnlyDrift)).toEqual(
      expect.objectContaining({ changedFields: [] }),
    );
    const promptDrift = createRunConfigurationFingerprint(
      profile,
      PROFILE.model,
      "standard",
      {
        skillCatalogSha256: "a".repeat(64),
        promptVariables: {
          catalogSha256: promptVariableCatalogSha256,
          snapshotSha256: "f".repeat(64),
          renderedSystemPromptSha256: "e".repeat(64),
        },
      },
    );
    expect(compareRunConfigurations(fingerprint, promptDrift)).toEqual(
      expect.objectContaining({
        changedFields: ["promptVariables"],
      }),
    );
    const loopGuardDrift = createRunConfigurationFingerprint(
      {
        ...profile,
        toolLoopGuard: {
          enabled: true,
          threshold: 4,
          exemptTools: ["read_file"],
        },
      },
      PROFILE.model,
      "standard",
      {
        skillCatalogSha256: "a".repeat(64),
        promptVariables: {
          catalogSha256: promptVariableCatalogSha256,
          snapshotSha256: "c".repeat(64),
          renderedSystemPromptSha256: "d".repeat(64),
        },
      },
    );
    expect(compareRunConfigurations(fingerprint, loopGuardDrift)).toEqual(
      expect.objectContaining({
        changedFields: ["toolLoopGuard"],
      }),
    );
    const canonicalExemptions = createRunConfigurationFingerprint(
      {
        ...profile,
        toolLoopGuard: {
          enabled: true,
          threshold: 4,
          exemptTools: ["read_file", "web_search"],
        },
      },
      PROFILE.model,
      "standard",
      {
        skillCatalogSha256: "a".repeat(64),
        promptVariables: {
          catalogSha256: promptVariableCatalogSha256,
          snapshotSha256: "c".repeat(64),
          renderedSystemPromptSha256: "d".repeat(64),
        },
      },
    );
    if (canonicalExemptions.schemaVersion !== 8) {
      throw new Error("Expected a schema-8 fingerprint");
    }
    const nonCanonicalExemptions = structuredClone(canonicalExemptions);
    nonCanonicalExemptions.toolLoopGuard.exemptTools.reverse();
    expect(() =>
      validateRunConfigurationFingerprint(nonCanonicalExemptions),
    ).toThrow("Tool Loop Guard policy is not canonical");

    expect(() =>
      createRunConfigurationFingerprint(profile, PROFILE.model, "standard", {
        promptVariables: {
          catalogSha256: promptVariableCatalogSha256,
          snapshotSha256: "c".repeat(64),
          renderedSystemPromptSha256: "d".repeat(64),
        },
      }),
    ).toThrow("require a Skill catalog hash");
    expect(() =>
      createRunConfigurationFingerprint(profile, PROFILE.model, "standard", {
        skillCatalogSha256: "a".repeat(64),
        promptVariables: {
          catalogSha256: "b".repeat(64),
          snapshotSha256: "c".repeat(64),
          renderedSystemPromptSha256: "d".repeat(64),
        },
      }),
    ).toThrow("does not match the Agent profile");
  });

  it("preserves schema-4 Advisor hashes with zero correction attempts", () => {
    const current = createRunConfigurationFingerprint(
      PROFILE,
      PROFILE.model,
      "standard",
      { skillCatalogSha256: "a".repeat(64) },
    );
    if (current.schemaVersion !== 5) {
      throw new Error("Expected a schema-5 fingerprint");
    }
    const {
      schemaVersion: _schemaVersion,
      contentSha256: _contentSha256,
      modelAdvisor,
      ...shared
    } = current;
    const {
      maxCorrectionAttempts: _maxCorrectionAttempts,
      ...legacyModelAdvisor
    } = modelAdvisor;
    const content = {
      schemaVersion: 4 as const,
      ...shared,
      modelAdvisor: legacyModelAdvisor,
    };
    const legacy = {
      ...content,
      contentSha256: createHash("sha256")
        .update(canonicalJson(content))
        .digest("hex"),
    };

    expect(validateRunConfigurationFingerprint(legacy)).toEqual(legacy);
    expect(fingerprintModelAdvisor(legacy)).toEqual({
      mode: "observe",
      enabledRules: ["destructive_command_reference"],
      maxCorrectionAttempts: 0,
    });
  });

  it("rejects hash drift, non-canonical sets, and unbound fields", () => {
    const fingerprint = createRunConfigurationFingerprint(PROFILE);
    const drifted = structuredClone(fingerprint);
    drifted.thinkingLevel = "high";
    expect(() => validateRunConfigurationFingerprint(drifted)).toThrow(
      "hash mismatch",
    );

    const reordered = structuredClone(fingerprint);
    reordered.enabledTools.reverse();
    expect(() => validateRunConfigurationFingerprint(reordered)).toThrow(
      "not canonical",
    );

    const extended = {
      ...structuredClone(fingerprint),
      rawSystemPrompt: PROFILE.systemPrompt,
    };
    expect(() => validateRunConfigurationFingerprint(extended)).toThrow(
      "unsupported field",
    );
  });

  it("reports structured drift and explicit legacy unavailability", () => {
    const left = createRunConfigurationFingerprint(PROFILE);
    const right = createRunConfigurationFingerprint({
      ...PROFILE,
      revision: 8,
      systemPrompt: "Use a revised instruction.",
      thinkingLevel: "high",
      enabledTools: ["read_file", "search_files"],
      enabledSkills: ["software-delivery"],
      enabledSubagents: ["reviewer"],
      runLimits: {
        ...PROFILE.runLimits!,
        maxTurns: 48,
      },
    });

    expect(compareRunConfigurations(left, right)).toEqual(
      expect.objectContaining({
        status: "comparable",
        leftSha256: left.contentSha256,
        rightSha256: right.contentSha256,
        changedFields: expect.arrayContaining([
          "agentRevision",
          "systemPrompt",
          "thinkingLevel",
          "enabledTools",
          "enabledSkills",
          "enabledSubagents",
          "runLimits",
        ]),
        addedTools: ["search_files"],
        removedTools: ["verify_workspace"],
        removedSkills: ["artifact-studio"],
        removedSubagents: ["researcher"],
      }),
    );
    expect(compareRunConfigurations(undefined, right)).toEqual(
      expect.objectContaining({
        status: "unavailable",
        rightSha256: right.contentSha256,
        changedFields: [],
      }),
    );
    const leftSkillCatalog = createRunConfigurationFingerprint(
      PROFILE,
      PROFILE.model,
      "standard",
      { skillCatalogSha256: "a".repeat(64) },
    );
    const rightSkillCatalog = createRunConfigurationFingerprint(
      PROFILE,
      PROFILE.model,
      "standard",
      { skillCatalogSha256: "b".repeat(64) },
    );
    expect(
      compareRunConfigurations(leftSkillCatalog, rightSkillCatalog),
    ).toEqual(
      expect.objectContaining({
        changedFields: expect.arrayContaining(["skillCatalog"]),
      }),
    );
    const rightAdvisor = createRunConfigurationFingerprint(
      {
        ...PROFILE,
        modelAdvisor: {
          mode: "off",
          enabledRules: ["destructive_command_reference"],
        },
      },
      PROFILE.model,
      "standard",
      { skillCatalogSha256: "a".repeat(64) },
    );
    expect(compareRunConfigurations(leftSkillCatalog, rightAdvisor)).toEqual(
      expect.objectContaining({
        changedFields: expect.arrayContaining(["modelAdvisor"]),
      }),
    );
  });
});

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
