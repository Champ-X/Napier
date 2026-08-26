import type {
  AgentProfile,
  CredentialReference,
  ModelSummary,
} from "@napier/contracts";
import type { ModelRoutePolicyV2 } from "@napier/contracts/model-route";
import { describe, expect, it } from "vitest";

import {
  createModelRouteDraft,
  modelRouteDraftError,
  modelRouteSavePatch,
  parseEndpointHeaders,
  removeModelRouteReference,
  replaceRouteTargetModel,
  updateRouteBinding,
} from "../src/model-route-editor";

describe("Model route editor", () => {
  it("starts from the Agent default and uses an explicit clear command", () => {
    const draft = createModelRouteDraft(agent());
    expect(draft).toEqual({
      schemaVersion: 2,
      roles: { default: { model: { provider: "openai", id: "gpt-5.4" } } },
      retryPolicy: { jitterRatio: 0.2, maxBackoffMs: 120_000 },
    });
    expect(modelRouteSavePatch(false, false, draft)).toEqual({});
    expect(modelRouteSavePatch(true, false, draft)).toEqual({
      clearModelRoute: true,
    });
    expect(modelRouteSavePatch(false, true, draft)).toEqual({
      modelRoute: draft,
    });
  });

  it("preserves unknown provider models and removes dependent registry references", () => {
    const policy = routePolicy();
    const switched = replaceRouteTargetModel(
      policy.roles.reasoning!,
      { provider: "anthropic", id: "claude-sonnet-4-6" },
      policy,
    );
    expect(switched).toEqual({
      model: { provider: "anthropic", id: "claude-sonnet-4-6" },
    });

    const withoutEndpoint = removeModelRouteReference(
      policy,
      "endpointProfileId",
      "corp_gateway",
    );
    expect(withoutEndpoint.roles.reasoning).not.toHaveProperty(
      "endpointProfileId",
    );
    expect(
      withoutEndpoint.roles.reasoning?.fallbackTargets?.[0],
    ).not.toHaveProperty("endpointProfileId");
    expect(policy.roles.reasoning).toHaveProperty("endpointProfileId");
  });

  it("updates binding groups without mutating the frozen draft", () => {
    const policy = routePolicy();
    const updated = updateRouteBinding(policy, "paths", "workflow", {
      model: { provider: "openai", id: "gpt-5.4" },
    });
    expect(updated.paths?.workflow?.model.id).toBe("gpt-5.4");
    expect(policy.paths).toBeUndefined();
  });

  it("fails closed on secret headers, mismatched pools, and incomplete explicit pools", () => {
    expect(
      modelRouteDraftError(
        {
          ...routePolicy(),
          endpointProfiles: [
            {
              id: "corp_gateway",
              providerId: "openai",
              kind: "gateway",
              baseUrl: "https://gateway.example.test/v1",
              dialect: "openai_responses",
              headers: parseEndpointHeaders("Authorization: TOP_SECRET"),
            },
          ],
        },
        models(),
        credentials(),
      ),
    ).toBe("endpoint");

    const policy = routePolicy();
    policy.credentialPools![0]!.credentialReferenceIds = [
      "credential_0123456789abcdef",
    ];
    expect(modelRouteDraftError(policy, models(), credentials())).toBe("pool");

    policy.credentialPools![0]!.credentialReferenceIds = [
      "credential_0123456789abcdef",
      "credential_fedcba9876543210",
    ];
    policy.roles.reasoning!.model.provider = "anthropic";
    expect(modelRouteDraftError(policy, models(), credentials())).toBe(
      "binding",
    );
  });

  it("accepts a complete endpoint, pool, and fallback chain", () => {
    expect(
      modelRouteDraftError(routePolicy(), models(), credentials()),
    ).toBeUndefined();
  });
});

function routePolicy(): ModelRoutePolicyV2 {
  return {
    schemaVersion: 2,
    roles: {
      reasoning: {
        model: { provider: "openai", id: "gpt-5.4" },
        endpointProfileId: "corp_gateway",
        credentialPoolId: "openai_pool",
        fallbackTargets: [
          {
            model: { provider: "openai", id: "gpt-5.4-mini" },
            endpointProfileId: "corp_gateway",
            credentialPoolId: "openai_pool",
          },
        ],
      },
    },
    endpointProfiles: [
      {
        id: "corp_gateway",
        providerId: "openai",
        kind: "gateway",
        baseUrl: "https://gateway.example.test/v1",
        modelId: "served-reasoning",
        dialect: "openai_responses",
        headers: { "x-tenant": "delivery" },
      },
    ],
    credentialPools: [
      { id: "openai_pool", providerId: "openai", strategy: "round_robin" },
    ],
    retryPolicy: { jitterRatio: 0.2, maxBackoffMs: 120_000 },
  };
}

function agent(): AgentProfile {
  return {
    id: "agent_route",
    name: "Napier",
    description: "Route",
    systemPrompt: "Route safely.",
    model: { provider: "openai", id: "gpt-5.4" },
    thinkingLevel: "medium",
    toolPolicy: "workspace",
    enabledTools: [],
    enabledSkills: [],
    revision: 1,
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
  };
}

function models(): ModelSummary[] {
  return ["gpt-5.4", "gpt-5.4-mini"].map((id) => ({
    provider: "openai",
    providerName: "OpenAI",
    id,
    name: id,
    contextWindow: 100_000,
    reasoning: true,
    vision: false,
    configured: true,
  }));
}

function credentials(): CredentialReference[] {
  return ["0123456789abcdef", "fedcba9876543210"].map((id) => ({
    id: `credential_${id}`,
    providerId: "openai",
    label: id,
    source: { type: "environment", variable: `KEY_${id}` },
    status: "active",
    availability: "available",
    revision: 1,
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
  }));
}
