import type { EffectiveAgentCapabilityProjectionV1 } from "@napier/contracts/agent-capability-contract";
import { describe, expect, it } from "vitest";

import { agentCapabilityComposerSummary } from "../src/agent-capability-composer-summary";

describe("Composer Agent capability affordance", () => {
  it("makes drift, ownership, unavailable, catalog-only, and unverified states concise", () => {
    expect(
      agentCapabilityComposerSummary(projection(), false, undefined),
    ).toEqual({
      contract:
        "contract v1 · stale · unknown_legacy · overrides enabledSkills, enabledSubagents, enabledTools, toolPolicy",
      readiness: "2 unavailable · 1 catalog-only · 1 unverified",
    });
    expect(agentCapabilityComposerSummary(undefined, true, undefined)).toEqual({
      contract: "contract loading",
    });
    expect(agentCapabilityComposerSummary(undefined, false, "offline")).toEqual(
      {
        contract: "contract unavailable · retry in Context",
      },
    );
  });
});

function projection(): EffectiveAgentCapabilityProjectionV1 {
  return {
    kind: "napier.effective-agent-capabilities",
    schemaVersion: 1,
    agentId: "agent_napier",
    agentRevision: 1,
    contractId: "napier.default-agent.capabilities",
    contractVersion: 1,
    recommendationSha256: "a".repeat(64),
    driftState: "stale",
    ownership: "unknown_legacy",
    explicitOverrideFields: [
      "toolPolicy",
      "enabledTools",
      "enabledSkills",
      "enabledSubagents",
    ],
    legacySignatureSha256: "b".repeat(64),
    toolPolicy: "observe",
    configuredTools: ["browser", "future_tool"],
    runtimeExposedTools: ["browser"],
    configuredSkills: ["catalogued", "missing"],
    configuredSubagents: [],
    readiness: [
      readiness("tool:browser", "available_unverified"),
      readiness("tool:future_tool", "unknown_configured"),
      readiness("skill:catalogued", "catalog_only"),
      readiness("skill:missing", "missing"),
    ],
    restorePreview: {
      schemaVersion: 1,
      contractId: "napier.default-agent.capabilities",
      contractVersion: 1,
      recommendationSha256: "a".repeat(64),
      agentId: "agent_napier",
      agentRevision: 1,
      currentManagedStateSha256: "b".repeat(64),
      targetManagedStateSha256: "c".repeat(64),
      operations: [],
      diffSha256: "d".repeat(64),
    },
    projectionSha256: "e".repeat(64),
  };
}

function readiness(
  id: string,
  status: EffectiveAgentCapabilityProjectionV1["readiness"][number]["status"],
): EffectiveAgentCapabilityProjectionV1["readiness"][number] {
  return {
    id,
    status,
    configured: true,
    allowedByPolicy: false,
    exposed: false,
    detail: "fixture",
  };
}
