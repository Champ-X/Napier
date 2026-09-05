import { describe, expect, it } from "vitest";

import type { ModelRoutePolicyV2 } from "@napier/contracts/model-route";

import { resolveModelRouteSelection } from "../src/model-route-resolution.js";

const policy: ModelRoutePolicyV2 = {
  schemaVersion: 2,
  roles: {
    reasoning: {
      model: { provider: "route-primary", id: "reasoning" },
      endpointProfileId: "primary_gateway",
      credentialPoolId: "primary_pool",
      fallbackTargets: [
        {
          model: { provider: "route-fallback", id: "fallback" },
          endpointProfileId: "fallback_gateway",
        },
      ],
    },
  },
  endpointProfiles: [
    {
      id: "primary_gateway",
      providerId: "route-primary",
      kind: "gateway",
      baseUrl: "https://primary.example.test/v1",
      modelId: "served-reasoning",
      dialect: "openai_responses",
    },
    {
      id: "fallback_gateway",
      providerId: "route-fallback",
      kind: "gateway",
      baseUrl: "https://fallback.example.test/v1",
      dialect: "openai_responses",
    },
  ],
  credentialPools: [
    {
      id: "primary_pool",
      providerId: "route-primary",
      strategy: "round_robin",
      credentialReferenceIds: [
        "credential_primary_one",
        "credential_primary_two",
      ],
    },
  ],
  retryPolicy: { jitterRatio: 0.2, maxBackoffMs: 120_000 },
};

describe("Model route explicit-primary resolution", () => {
  it("preserves the configured endpoint, credential pool, and fallbacks when the explicit model matches", () => {
    const selection = resolveModelRouteSelection({
      agentDefault: { provider: "route-default", id: "default" },
      policy,
      request: { role: "reasoning" },
      source: "user",
      explicitPrimary: { provider: "route-primary", id: "reasoning" },
    });

    expect(selection).toEqual({
      role: "reasoning",
      path: "interactive",
      source: "explicit",
      targets: [
        {
          model: { provider: "route-primary", id: "reasoning" },
          endpointProfileId: "primary_gateway",
          credentialPoolId: "primary_pool",
        },
        {
          model: { provider: "route-fallback", id: "fallback" },
          endpointProfileId: "fallback_gateway",
        },
      ],
    });
  });

  it("does not inherit target metadata or profile fallbacks for a different explicit model", () => {
    const selection = resolveModelRouteSelection({
      agentDefault: { provider: "route-default", id: "default" },
      policy,
      request: { role: "reasoning" },
      source: "user",
      explicitPrimary: { provider: "route-primary", id: "override" },
    });

    expect(selection).toEqual({
      role: "reasoning",
      path: "interactive",
      source: "explicit",
      targets: [{ model: { provider: "route-primary", id: "override" } }],
    });
  });

  it("keeps request-explicit fallbacks for a different explicit model", () => {
    const selection = resolveModelRouteSelection({
      agentDefault: { provider: "route-default", id: "default" },
      policy,
      request: {
        role: "reasoning",
        fallbackModels: [{ provider: "request-fallback", id: "fallback" }],
      },
      source: "user",
      explicitPrimary: { provider: "route-primary", id: "override" },
    });

    expect(selection).toEqual({
      role: "reasoning",
      path: "interactive",
      source: "explicit",
      targets: [
        { model: { provider: "route-primary", id: "override" } },
        { model: { provider: "request-fallback", id: "fallback" } },
      ],
    });
  });

  it("matches the configured source model even when its endpoint serves a different model ID", () => {
    const selection = resolveModelRouteSelection({
      agentDefault: { provider: "route-default", id: "default" },
      policy,
      request: { role: "reasoning" },
      source: "user",
      explicitPrimary: { provider: "route-primary", id: "reasoning" },
    });

    expect(selection.targets[0]).toEqual(
      expect.objectContaining({
        model: { provider: "route-primary", id: "reasoning" },
        endpointProfileId: "primary_gateway",
      }),
    );
  });
});
