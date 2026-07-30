import type { AgentProfile } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  changedAgentFields,
  createAgentProfileRevision,
  rollbackAgentProfile,
  updateAgentProfile,
  validateAgentProfileRevision,
} from "../src/agents.js";

const PROFILE: AgentProfile = {
  id: "agent-test",
  name: "Napier",
  description: "Durable agent",
  systemPrompt: "Preserve evidence.",
  model: { provider: "napier", id: "demo" },
  thinkingLevel: "medium",
  toolPolicy: "observe",
  enabledTools: ["list_files", "read_file"],
  enabledSkills: ["software-delivery"],
  enabledSubagents: ["reviewer"],
  subagentLimits: {
    maxConcurrent: 1,
    maxTotal: 4,
    maxTurns: 8,
    timeoutMs: 120_000,
  },
  runLimits: {
    maxTurns: 24,
    maxTotalTokens: 250_000,
    maxCostUsd: 10,
    timeoutMs: 900_000,
  },
  revision: 1,
  createdAt: "2026-07-25T00:00:00.000Z",
  updatedAt: "2026-07-25T00:00:00.000Z",
};

describe("Agent profile updates", () => {
  it("updates typed configuration and preserves multiline prompts", () => {
    const updated = updateAgentProfile(PROFILE, {
      name: "Delivery Agent",
      systemPrompt: "First invariant.\n\nSecond invariant.",
      model: {
        provider: "OpenRouter",
        id: "anthropic/claude-sonnet",
      },
      thinkingLevel: "high",
      toolPolicy: "workspace",
      enabledTools: [
        "search_files",
        "list_symbols",
        "inspect_data",
        "inspect_code",
        "read_symbol",
        "read_file",
        "apply_patch",
        "verify_workspace",
      ],
      enabledSkills: ["artifact-studio", "software-delivery"],
      enabledSubagents: ["researcher", "reviewer"],
      subagentLimits: {
        maxConcurrent: 2,
        maxTotal: 6,
        maxTurns: 12,
        timeoutMs: 180_000,
      },
      runLimits: {
        maxTurns: 40,
        maxTotalTokens: 500_000,
        maxCostUsd: 15.5,
        timeoutMs: 1_200_000,
      },
      automaticRecovery: {
        mode: "safe_read_only",
        maxAttempts: 3,
        backoffMs: 15_000,
      },
      modelAdvisor: {
        mode: "observe",
        enabledRules: ["destructive_command_reference"],
        maxCorrectionAttempts: 2,
        reviewModel: { provider: "google", id: "gemini-2.5-pro" },
      },
      toolLoopGuard: {
        enabled: true,
        threshold: 4,
        exemptTools: ["web_search", "read_file"],
      },
    });

    expect(updated).toEqual(
      expect.objectContaining({
        name: "Delivery Agent",
        systemPrompt: "First invariant.\n\nSecond invariant.",
        model: {
          provider: "openrouter",
          id: "anthropic/claude-sonnet",
        },
        thinkingLevel: "high",
        toolPolicy: "workspace",
        enabledTools: [
          "apply_patch",
          "inspect_code",
          "inspect_data",
          "list_symbols",
          "read_file",
          "read_symbol",
          "search_files",
          "verify_workspace",
        ],
        enabledSkills: ["artifact-studio", "software-delivery"],
        enabledSubagents: ["researcher", "reviewer"],
        automaticRecovery: {
          mode: "safe_read_only",
          maxAttempts: 3,
          backoffMs: 15_000,
        },
        modelAdvisor: {
          mode: "observe",
          enabledRules: ["destructive_command_reference"],
          maxCorrectionAttempts: 2,
          reviewModel: { provider: "google", id: "gemini-2.5-pro" },
        },
        toolLoopGuard: {
          enabled: true,
          threshold: 4,
          exemptTools: ["read_file", "web_search"],
        },
        revision: 2,
      }),
    );
    expect(changedAgentFields(PROFILE, updated)).toEqual(
      expect.arrayContaining([
        "name",
        "systemPrompt",
        "model",
        "thinkingLevel",
        "toolPolicy",
        "enabledTools",
        "enabledSkills",
        "enabledSubagents",
        "subagentLimits",
        "runLimits",
        "automaticRecovery",
        "modelAdvisor",
        "toolLoopGuard",
      ]),
    );
  });

  it("does not revise a semantic no-op", () => {
    expect(
      updateAgentProfile(PROFILE, {
        name: " Napier ",
        enabledTools: ["read_file", "list_files"],
      }),
    ).toEqual(PROFILE);
  });

  it("does not audit equivalent capability-set reordering", () => {
    const unsorted: AgentProfile = {
      ...PROFILE,
      enabledSkills: ["research-brief", "software-delivery", "artifact-studio"],
      enabledSubagents: ["researcher", "reviewer", "general"],
    };
    const updated = updateAgentProfile(unsorted, {
      name: "Napier Ledger",
      enabledSkills: ["artifact-studio", "research-brief", "software-delivery"],
      enabledSubagents: ["general", "researcher", "reviewer"],
    });

    expect(updated.enabledSkills).toEqual(unsorted.enabledSkills);
    expect(updated.enabledSubagents).toEqual(unsorted.enabledSubagents);
    expect(changedAgentFields(unsorted, updated)).toEqual(["name"]);
  });

  it("preserves an omitted optional role set while changing another field", () => {
    const { enabledSubagents: _enabledSubagents, ...legacy }: AgentProfile =
      PROFILE;
    const updated = updateAgentProfile(legacy, {
      description: "Updated durable agent",
      enabledSubagents: [],
    });

    expect(updated).not.toHaveProperty("enabledSubagents");
    expect(changedAgentFields(legacy, updated)).toEqual(["description"]);
  });

  it("revisions canonical Prompt Variable catalogs without order churn", () => {
    const updated = updateAgentProfile(PROFILE, {
      promptVariables: [
        { name: "today", type: "current_date", format: "iso-date" },
        { name: "context", type: "literal", value: "  Napier\r\nledger  " },
      ],
    });

    expect(updated.promptVariables).toEqual([
      { name: "context", type: "literal", value: "Napier\nledger" },
      { name: "today", type: "current_date", format: "iso-date" },
    ]);
    expect(changedAgentFields(PROFILE, updated)).toContain("promptVariables");
    expect(
      updateAgentProfile(updated, {
        promptVariables: [...updated.promptVariables!].reverse(),
      }),
    ).toEqual(updated);

    const cleared = updateAgentProfile(updated, { promptVariables: [] });
    expect(cleared.promptVariables).toEqual([]);
    expect(cleared.revision).toBe(updated.revision + 1);
  });

  it("normalizes Tool Loop Guard policy without exempt-set order churn", () => {
    const updated = updateAgentProfile(PROFILE, {
      toolLoopGuard: {
        enabled: true,
        threshold: 4,
        exemptTools: ["search_files", "read_file"],
      },
    });
    expect(updated.toolLoopGuard).toEqual({
      enabled: true,
      threshold: 4,
      exemptTools: ["read_file", "search_files"],
    });
    expect(changedAgentFields(PROFILE, updated)).toContain("toolLoopGuard");
    expect(
      updateAgentProfile(updated, {
        toolLoopGuard: {
          enabled: true,
          threshold: 4,
          exemptTools: ["search_files", "read_file"],
        },
      }),
    ).toEqual(updated);
  });

  it("rejects unsupported tools, malformed models, and unsafe budgets", () => {
    expect(() =>
      updateAgentProfile(PROFILE, { enabledTools: ["bash"] }),
    ).toThrow("Unsupported Agent tool");
    expect(
      updateAgentProfile(PROFILE, {
        enabledTools: [
          "read_file",
          "lsp_diagnostics",
          "lsp_symbols",
          "lsp_definition",
          "lsp_references",
          "lsp_rename",
          "lsp_code_actions",
          "run_command",
          "javascript_kernel",
          "workspace_process",
        ],
      }).enabledTools,
    ).toEqual([
      "javascript_kernel",
      "lsp_code_actions",
      "lsp_definition",
      "lsp_diagnostics",
      "lsp_references",
      "lsp_rename",
      "lsp_symbols",
      "read_file",
      "run_command",
      "workspace_process",
    ]);
    expect(() =>
      updateAgentProfile(PROFILE, {
        model: { provider: "openrouter", id: "bad model" },
      }),
    ).toThrow("Invalid model ID");
    expect(() =>
      updateAgentProfile(PROFILE, {
        subagentLimits: {
          maxConcurrent: 0,
          maxTotal: 4,
          maxTurns: 8,
          timeoutMs: 120_000,
        },
      }),
    ).toThrow("maxConcurrent");
    expect(() =>
      updateAgentProfile(PROFILE, {
        runLimits: {
          maxTurns: 0,
          maxTotalTokens: 250_000,
          maxCostUsd: 10,
          timeoutMs: 900_000,
        },
      }),
    ).toThrow("run maxTurns");
    expect(() =>
      updateAgentProfile(PROFILE, {
        runLimits: {
          maxTurns: 24,
          maxTotalTokens: 250_000,
          maxCostUsd: Number.NaN,
          timeoutMs: 900_000,
        },
      }),
    ).toThrow("run maxCostUsd");
    expect(() =>
      updateAgentProfile(PROFILE, {
        automaticRecovery: {
          mode: "safe_read_only",
          maxAttempts: 4,
          backoffMs: 5_000,
        },
      }),
    ).toThrow("Automatic recovery maxAttempts");
    expect(() =>
      updateAgentProfile(PROFILE, {
        modelAdvisor: {
          mode: "observe",
          enabledRules: ["unknown_rule" as "unverified_verification_claim"],
        },
      }),
    ).toThrow("Unsupported Model Advisor rule");
    expect(() =>
      updateAgentProfile(PROFILE, {
        modelAdvisor: {
          mode: "enforce",
          enabledRules: ["destructive_command_reference"],
          maxCorrectionAttempts: 4,
        },
      }),
    ).toThrow("Model Advisor policy is invalid");
    expect(() =>
      updateAgentProfile(PROFILE, {
        modelAdvisor: {
          mode: "enforce",
          enabledRules: [],
          maxCorrectionAttempts: 1,
          reviewModel: PROFILE.model,
        },
      }),
    ).toThrow("must differ from the primary model");
    expect(() =>
      updateAgentProfile(
        {
          ...PROFILE,
          model: { provider: "openrouter", id: "anthropic/claude-sonnet" },
        },
        {
          modelAdvisor: {
            mode: "observe",
            enabledRules: [],
            maxCorrectionAttempts: 0,
            reviewModel: { provider: "napier", id: "demo" },
          },
        },
      ),
    ).toThrow("must use a live model");
    expect(() =>
      updateAgentProfile(PROFILE, {
        toolLoopGuard: {
          enabled: true,
          threshold: 1,
          exemptTools: [],
        },
      }),
    ).toThrow("Tool loop guard policy is invalid");
  });

  it("hashes immutable revisions and restores history as a new revision", () => {
    const baseline = createAgentProfileRevision(PROFILE, {
      source: "created",
    });
    expect(baseline).toEqual(
      expect.objectContaining({
        agentId: PROFILE.id,
        revision: 1,
        source: "created",
        changedFields: expect.arrayContaining([
          "systemPrompt",
          "model",
          "runLimits",
        ]),
        systemPromptSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(validateAgentProfileRevision(baseline)).toEqual(baseline);

    const current = updateAgentProfile(PROFILE, {
      name: "Changed Agent",
      systemPrompt: "Changed prompt.",
      toolPolicy: "workspace",
    });
    const restored = rollbackAgentProfile(current, baseline);
    expect(restored).toEqual(
      expect.objectContaining({
        name: PROFILE.name,
        systemPrompt: PROFILE.systemPrompt,
        toolPolicy: PROFILE.toolPolicy,
        revision: 3,
      }),
    );

    const rollback = createAgentProfileRevision(restored, {
      source: "rollback",
      changedFields: changedAgentFields(current, restored),
      restoredFromRevision: baseline.revision,
    });
    expect(rollback).toEqual(
      expect.objectContaining({
        revision: 3,
        source: "rollback",
        restoredFromRevision: 1,
      }),
    );
    expect(validateAgentProfileRevision(rollback)).toEqual(rollback);

    const tampered = structuredClone(rollback);
    tampered.profile.systemPrompt = "Tampered prompt.";
    expect(() => validateAgentProfileRevision(tampered)).toThrow(
      "evidence is invalid",
    );
    expect(() => rollbackAgentProfile(restored, baseline)).toThrow(
      "already matches",
    );
  });
});
