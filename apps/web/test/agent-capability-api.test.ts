import { createHash } from "node:crypto";

import type {
  EffectiveAgentCapabilityProjectionV1,
  RestoreRecommendedCapabilitiesResultV1,
} from "@napier/contracts/agent-capability-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getAgentCapabilities,
  restoreRecommendedAgentCapabilities,
} from "../src/agent-capability-api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Agent capability Web API", () => {
  it("verifies projections and submits only the exact restore CAS inputs", async () => {
    const projection = fixtureProjection();
    const restored: RestoreRecommendedCapabilitiesResultV1 = {
      schemaVersion: 1,
      previousRevision: projection.agentRevision,
      projection: { ...projection, agentRevision: 3 },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(bodyResponse(projection))
      .mockResolvedValueOnce(bodyResponse(restored));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getAgentCapabilities("agent_napier")).resolves.toEqual(
      projection,
    );
    await expect(
      restoreRecommendedAgentCapabilities("agent_napier", {
        schemaVersion: 1,
        expectedRevision: projection.agentRevision,
        diffSha256: projection.restorePreview.diffSha256,
      }),
    ).resolves.toEqual(restored);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/agents/agent_napier/capabilities",
    );
    expect(fetchMock.mock.calls[1]).toEqual([
      "/api/agents/agent_napier/capabilities/restore",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          schemaVersion: 1,
          expectedRevision: 2,
          diffSha256: "d".repeat(64),
        }),
      }),
    ]);
  });

  it("requests and verifies a hash-bound temporary preset projection", async () => {
    const projection = {
      ...fixtureProjection(),
      capabilityPreset: "browser" as const,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        bodyResponse(projection, {
          "X-Napier-Capability-Preset": "browser",
        }),
      ),
    );

    await expect(
      getAgentCapabilities("agent_napier", "browser"),
    ).resolves.toEqual(projection);
    expect(fetch).toHaveBeenCalledWith(
      "/api/agents/agent_napier/capabilities?preset=browser",
      expect.any(Object),
    );
  });

  it("fails closed when preset projection evidence drifts", async () => {
    const projection = {
      ...fixtureProjection(),
      capabilityPreset: "browser" as const,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        bodyResponse(projection, {
          "X-Napier-Capability-Preset": "coding",
        }),
      ),
    );
    await expect(
      getAgentCapabilities("agent_napier", "browser"),
    ).rejects.toThrow("preset evidence does not match");
  });

  it("rejects a projection whose body evidence was tampered", async () => {
    const projection = fixtureProjection();
    const response = bodyResponse(projection);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ ...projection, ownership: "recommended" }),
            { status: 200, headers: response.headers },
          ),
      ),
    );
    await expect(getAgentCapabilities("agent_napier")).rejects.toThrow(
      "hash mismatch",
    );
  });
});

function fixtureProjection(): EffectiveAgentCapabilityProjectionV1 {
  return {
    kind: "napier.effective-agent-capabilities",
    schemaVersion: 1,
    agentId: "agent_napier",
    agentRevision: 2,
    contractId: "napier.default-agent.capabilities",
    contractVersion: 1,
    recommendationSha256: "a".repeat(64),
    driftState: "current",
    ownership: "explicit_overrides",
    explicitOverrideFields: ["enabledTools"],
    toolPolicy: "observe",
    configuredTools: ["browser"],
    runtimeExposedTools: ["browser"],
    configuredSkills: [],
    configuredSubagents: [],
    readiness: [
      {
        id: "tool:browser",
        status: "available_unverified",
        configured: true,
        allowedByPolicy: true,
        exposed: true,
        detail: "External dependency health is not claimed",
      },
    ],
    restorePreview: {
      schemaVersion: 1,
      contractId: "napier.default-agent.capabilities",
      contractVersion: 1,
      recommendationSha256: "a".repeat(64),
      agentId: "agent_napier",
      agentRevision: 2,
      currentManagedStateSha256: "b".repeat(64),
      targetManagedStateSha256: "c".repeat(64),
      operations: [
        {
          field: "enabledTools",
          operation: "add",
          value: "read_file",
          effect: "read",
          risk: "low",
        },
      ],
      diffSha256: "d".repeat(64),
    },
    projectionSha256: "e".repeat(64),
  };
}

function bodyResponse(
  value: unknown,
  additionalHeaders: Record<string, string> = {},
): Response {
  const text = JSON.stringify(value);
  const sha256 = createHash("sha256").update(text).digest("hex");
  return new Response(text, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Napier-Content-SHA256": sha256,
      "X-Napier-Content-SHA256-Mode": "body",
      ...additionalHeaders,
    },
  });
}
