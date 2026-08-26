import { describe, expect, it } from "vitest";

import {
  parseRollbackAgentProfileRequest,
  parseUpdateAgentProfileRequest,
} from "../src/agent-profile-http-validation.js";

const THREAD_ID = "thread_0123456789abcdef";

describe("Agent profile HTTP validation", () => {
  it("normalizes the complete profile update surface", () => {
    expect(
      parseUpdateAgentProfileRequest({
        name: "  Delivery   Agent ",
        description: "  Evidence-first   delivery ",
        systemPrompt: "  Preserve evidence.\r\nNever claim side effects.  ",
        model: { provider: " DeepSeek ", id: " deepseek-v4-flash " },
        thinkingLevel: "high",
        toolPolicy: "workspace",
        enabledTools: ["search_files", "read_file"],
        enabledSkills: [" Artifact-Studio ", "software-delivery"],
        enabledSubagents: ["reviewer", "coder"],
        subagentLimits: {
          maxConcurrent: 2,
          maxTotal: 6,
          maxTurns: 12,
          timeoutMs: 120_000,
        },
        runLimits: {
          maxTurns: 48,
          maxTotalTokens: 500_000,
          maxCostUsd: 15.5,
          timeoutMs: 1_800_000,
        },
        automaticRecovery: {
          mode: "safe_read_only",
          maxAttempts: 2,
          backoffMs: 5_000,
        },
        modelAdvisor: {
          mode: "enforce",
          enabledRules: ["destructive_command_reference"],
          maxCorrectionAttempts: 2,
          reviewModel: {
            provider: " DeepSeek ",
            id: " deepseek-v4-pro ",
          },
        },
        promptVariables: [
          { name: "skills", type: "skill_catalog" },
          { name: "release", type: "literal", value: "candidate" },
        ],
        toolLoopGuard: {
          enabled: true,
          threshold: 4,
          exemptTools: ["search_files", "read_file"],
        },
        threadId: THREAD_ID,
      }),
    ).toEqual({
      name: "Delivery Agent",
      description: "Evidence-first delivery",
      systemPrompt: "Preserve evidence.\nNever claim side effects.",
      model: { provider: "deepseek", id: "deepseek-v4-flash" },
      thinkingLevel: "high",
      toolPolicy: "workspace",
      enabledTools: ["read_file", "search_files"],
      enabledSkills: ["artifact-studio", "software-delivery"],
      enabledSubagents: ["coder", "reviewer"],
      subagentLimits: {
        maxConcurrent: 2,
        maxTotal: 6,
        maxTurns: 12,
        timeoutMs: 120_000,
      },
      runLimits: {
        maxTurns: 48,
        maxTotalTokens: 500_000,
        maxCostUsd: 15.5,
        timeoutMs: 1_800_000,
      },
      automaticRecovery: {
        mode: "safe_read_only",
        maxAttempts: 2,
        backoffMs: 5_000,
      },
      modelAdvisor: {
        mode: "enforce",
        enabledRules: ["destructive_command_reference"],
        maxCorrectionAttempts: 2,
        reviewModel: {
          provider: "deepseek",
          id: "deepseek-v4-pro",
        },
      },
      promptVariables: [
        { name: "release", type: "literal", value: "candidate" },
        { name: "skills", type: "skill_catalog" },
      ],
      toolLoopGuard: {
        enabled: true,
        threshold: 4,
        exemptTools: ["read_file", "search_files"],
      },
      threadId: THREAD_ID,
    });
  });

  it("preserves explicit empty capability lists", () => {
    expect(
      parseUpdateAgentProfileRequest({
        enabledTools: [],
        enabledSkills: [],
        enabledSubagents: [],
        promptVariables: [],
      }),
    ).toEqual({
      enabledTools: [],
      enabledSkills: [],
      enabledSubagents: [],
      promptVariables: [],
    });
  });

  it("preserves an explicit request to clear Model route policy", () => {
    expect(parseUpdateAgentProfileRequest({ clearModelRoute: true })).toEqual({
      clearModelRoute: true,
    });
    expect(
      parseUpdateAgentProfileRequest({
        clearModelRoute: true,
        modelRoute: { schemaVersion: 2, roles: {} },
      }),
    ).toBeUndefined();
  });

  it("normalizes Model route endpoint and credential-pool configuration", () => {
    expect(
      parseUpdateAgentProfileRequest({
        modelRoute: {
          schemaVersion: 2,
          roles: {
            reasoning: {
              model: { provider: " DeepSeek ", id: " deepseek-reasoner " },
              endpointProfileId: "corp_gateway",
              credentialPoolId: "reasoning_pool",
            },
          },
          endpointProfiles: [
            {
              id: "corp_gateway",
              providerId: "deepseek",
              kind: "gateway",
              baseUrl: "https://gateway.example.test/v1/",
              dialect: "openai_completions",
              headers: { "X-Napier-Tenant": " delivery " },
            },
          ],
          credentialPools: [
            {
              id: "reasoning_pool",
              providerId: "deepseek",
              strategy: "round_robin",
              credentialReferenceIds: [
                "credential_0123456789abcdef",
                "credential_fedcba9876543210",
              ],
            },
          ],
        },
      }),
    ).toEqual({
      modelRoute: {
        schemaVersion: 2,
        roles: {
          reasoning: {
            model: { provider: "deepseek", id: "deepseek-reasoner" },
            endpointProfileId: "corp_gateway",
            credentialPoolId: "reasoning_pool",
          },
        },
        endpointProfiles: [
          {
            id: "corp_gateway",
            providerId: "deepseek",
            kind: "gateway",
            baseUrl: "https://gateway.example.test/v1",
            dialect: "openai_completions",
            headers: { "x-napier-tenant": "delivery" },
          },
        ],
        credentialPools: [
          {
            id: "reasoning_pool",
            providerId: "deepseek",
            strategy: "round_robin",
            credentialReferenceIds: [
              "credential_0123456789abcdef",
              "credential_fedcba9876543210",
            ],
          },
        ],
        retryPolicy: { jitterRatio: 0.2, maxBackoffMs: 120_000 },
      },
    });
  });

  it("fails closed on unknown, duplicate, or out-of-range fields", () => {
    const invalidUpdates = [
      { name: "Agent", unexpected: true },
      { enabledTools: ["read_file", "read_file"] },
      { enabledTools: ["host_shell"] },
      { enabledSkills: ["Valid", "valid"] },
      { enabledSubagents: ["operator"] },
      {
        subagentLimits: {
          maxConcurrent: 9,
          maxTotal: 10,
          maxTurns: 10,
          timeoutMs: 10_000,
        },
      },
      {
        runLimits: {
          maxTurns: 10,
          maxTotalTokens: 999,
          maxCostUsd: 1,
          timeoutMs: 10_000,
        },
      },
      {
        automaticRecovery: {
          mode: "unrestricted",
          maxAttempts: 1,
          backoffMs: 1_000,
        },
      },
      {
        modelAdvisor: {
          mode: "observe",
          enabledRules: ["unknown_rule"],
        },
      },
      {
        promptVariables: [
          {
            name: "release",
            type: "literal",
            value: "candidate",
            unexpected: true,
          },
        ],
      },
      {
        toolLoopGuard: {
          enabled: true,
          threshold: 1,
          exemptTools: [],
        },
      },
      {
        modelRoute: {
          schemaVersion: 2,
          roles: {},
          endpointProfiles: [
            {
              id: "corp_gateway",
              providerId: "deepseek",
              kind: "gateway",
              baseUrl: "https://gateway.example.test",
              dialect: "openai_completions",
              headers: { "x-api-key": "must-not-be-persisted" },
            },
          ],
        },
      },
      { modelRoute: { schemaVersion: 2, roles: {}, unexpected: true } },
      { threadId: "thread_invalid" },
    ];
    for (const input of invalidUpdates) {
      expect(parseUpdateAgentProfileRequest(input)).toBeUndefined();
    }
  });

  it("accepts only exact rollback requests", () => {
    expect(
      parseRollbackAgentProfileRequest({
        revision: 2,
        threadId: THREAD_ID,
      }),
    ).toEqual({ revision: 2, threadId: THREAD_ID });
    expect(
      parseRollbackAgentProfileRequest({
        revision: 2,
        threadId: THREAD_ID,
        unexpected: true,
      }),
    ).toBeUndefined();
    expect(
      parseRollbackAgentProfileRequest({
        revision: 0,
        threadId: THREAD_ID,
      }),
    ).toBeUndefined();
  });
});
