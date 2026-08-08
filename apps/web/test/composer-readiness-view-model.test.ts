import type { AgentProfile } from "@napier/contracts";
import { agentCapabilityPresetUpdate } from "@napier/contracts/agent-capabilities";
import type {
  CapabilityReadinessRecord,
  EffectiveAgentCapabilityProjectionV1,
} from "@napier/contracts/agent-capability-contract";
import { describe, expect, it } from "vitest";

import { composerRunReadiness } from "../src/composer-readiness-view-model";

describe("Composer run readiness", () => {
  it("shows explicit Research readiness without gating on Sandbox", () => {
    const readiness = composerRunReadiness(
      profile("research"),
      projection({
        policy: "observe",
        tools: [
          tool("web_search", "available_unverified"),
          tool("web_fetch", "available_unverified"),
          tool("browser", "available_unverified"),
        ],
        sandbox: sandbox("unavailable"),
      }),
      false,
      undefined,
    );

    expect(readiness.canRun).toBe(true);
    expect(readiness.level).toBe("warn");
    expect(readiness.items).toEqual([
      expect.objectContaining({
        id: "network",
        value: "Search + Fetch · unverified",
        state: "warn",
      }),
      expect.objectContaining({
        id: "sandbox",
        value: "Not needed",
        state: "inactive",
      }),
      expect.objectContaining({
        id: "browser",
        value: "Available · unverified",
        state: "warn",
      }),
      expect.objectContaining({
        id: "permission",
        value: "Read only",
        state: "ready",
      }),
    ]);
  });

  it("blocks Browser mode when Browser is not exposed", () => {
    const readiness = composerRunReadiness(
      profile("browser"),
      projection({
        policy: "observe",
        tools: [
          tool("web_search", "ready"),
          tool("web_fetch", "ready"),
          tool("browser", "blocked_by_policy"),
        ],
        sandbox: sandbox("unavailable"),
      }),
      false,
      undefined,
    );

    expect(readiness.canRun).toBe(false);
    expect(readiness.message).toContain("Browser unavailable");
    expect(readiness.items.find((item) => item.id === "browser")).toEqual(
      expect.objectContaining({ state: "blocked", value: "Unavailable" }),
    );
  });

  it("blocks Coding when Sandbox is unavailable and warns for host-direct", () => {
    const unavailable = composerRunReadiness(
      profile("coding"),
      projection({
        policy: "workspace",
        tools: [],
        sandbox: sandbox("unavailable"),
      }),
      false,
      undefined,
    );
    expect(unavailable.canRun).toBe(false);
    expect(unavailable.message).toContain("Sandbox unavailable");
    expect(
      unavailable.items.find((item) => item.id === "permission")?.value,
    ).toBe("Workspace changes");

    const hostDirect = composerRunReadiness(
      profile("coding"),
      projection({
        policy: "workspace",
        tools: [],
        sandbox: sandbox("available_unverified", "host-direct"),
      }),
      false,
      undefined,
    );
    expect(hostDirect.canRun).toBe(true);
    expect(hostDirect.level).toBe("warn");
    expect(hostDirect.message).toContain("without OS isolation");
  });

  it("blocks sending while effective readiness is loading or unavailable", () => {
    expect(
      composerRunReadiness(profile("research"), undefined, true, undefined),
    ).toEqual(
      expect.objectContaining({
        canRun: false,
        level: "blocked",
        message: expect.stringContaining("Checking effective"),
      }),
    );
    expect(
      composerRunReadiness(profile("research"), undefined, false, "offline"),
    ).toEqual(
      expect.objectContaining({
        canRun: false,
        message: expect.stringContaining("review the capability contract"),
      }),
    );
  });

  it("blocks stale readiness after a task mode revision changes", () => {
    const current = projection({
      policy: "observe",
      tools: [
        tool("web_search", "ready"),
        tool("web_fetch", "ready"),
        tool("browser", "ready"),
      ],
      sandbox: sandbox("unavailable"),
    });
    const revised = { ...profile("research"), revision: 2 };

    expect(
      composerRunReadiness(revised, current, false, undefined),
    ).toEqual(
      expect.objectContaining({
        canRun: false,
        message: expect.stringContaining("Refreshing effective readiness"),
      }),
    );
  });
});

function profile(
  mode: "coding" | "research" | "browser",
): AgentProfile {
  const preset = agentCapabilityPresetUpdate(mode);
  return {
    id: "agent_napier",
    name: "Napier",
    description: "Fixture",
    systemPrompt: "Stay bounded.",
    model: { provider: "deepseek", id: "deepseek-v4-flash" },
    thinkingLevel: "medium",
    ...preset,
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
    revision: 1,
    runLimits: {
      maxTurns: 24,
      maxTotalTokens: 250_000,
      maxCostUsd: 10,
      timeoutMs: 900_000,
    },
    subagentLimits: {
      maxConcurrent: 2,
      maxTotal: 4,
      maxTurns: 8,
      timeoutMs: 120_000,
    },
  };
}

function projection({
  policy,
  tools,
  sandbox: sandboxRecord,
}: {
  policy: EffectiveAgentCapabilityProjectionV1["toolPolicy"];
  tools: CapabilityReadinessRecord[];
  sandbox: CapabilityReadinessRecord;
}): EffectiveAgentCapabilityProjectionV1 {
  return {
    kind: "napier.effective-agent-capabilities",
    schemaVersion: 1,
    agentId: "agent_napier",
    agentRevision: 1,
    contractId: "napier.default-agent.capabilities",
    contractVersion: 1,
    recommendationSha256: "a".repeat(64),
    driftState: "current",
    ownership: "recommended",
    explicitOverrideFields: [],
    toolPolicy: policy,
    configuredTools: tools.map((item) => item.id.slice("tool:".length)),
    runtimeExposedTools: tools
      .filter((item) => item.exposed)
      .map((item) => item.id.slice("tool:".length)),
    configuredSkills: [],
    configuredSubagents: [],
    readiness: [...tools, sandboxRecord],
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

function tool(
  name: string,
  status: CapabilityReadinessRecord["status"],
): CapabilityReadinessRecord {
  const ready =
    status === "ready" || status === "available_unverified";
  return {
    id: `tool:${name}`,
    status,
    configured: true,
    allowedByPolicy: ready,
    exposed: ready,
    detail: `${name} ${status}`,
  };
}

function sandbox(
  status: CapabilityReadinessRecord["status"],
  id = "oci-container",
): CapabilityReadinessRecord {
  return {
    id: `sandbox:${id}`,
    status,
    configured: true,
    allowedByPolicy: false,
    exposed: false,
    detail: `sandbox ${status}`,
  };
}
