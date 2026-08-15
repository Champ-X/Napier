import type { AgentProfile } from "@napier/contracts";
import { agentCapabilityPreset } from "@napier/contracts/agent-capabilities";
import type { EffectiveAgentCapabilityProjectionV1 } from "@napier/contracts/agent-capability-contract";
import { describe, expect, it } from "vitest";

import {
  composerModeDependency,
  composerModeNeedsSandboxSetup,
  composerModePolicyLabel,
  composerModes,
} from "../src/composer-mode-view-model";

describe("Composer task modes", () => {
  it("lists the five one-use task modes and marks only an explicit selection active", () => {
    const research = agentCapabilityPreset("research");
    const modes = composerModes(research, "research");
    expect(modes.map((mode) => mode.id)).toEqual([
      "coding",
      "research",
      "data",
      "browser",
      "safe_automation",
    ]);
    expect(modes.find((mode) => mode.active)?.id).toBe("research");
    expect(
      modes.filter((mode) => mode.requiresSandbox).map((m) => m.id),
    ).toEqual(["coding", "safe_automation"]);
  });

  it("treats a custom profile as no active mode", () => {
    const custom: Pick<
      AgentProfile,
      "toolPolicy" | "enabledTools" | "enabledSkills" | "enabledSubagents"
    > = {
      toolPolicy: "observe",
      enabledTools: ["read_file"],
      enabledSkills: [],
      enabledSubagents: [],
    };
    expect(composerModes(custom).some((mode) => mode.active)).toBe(false);
  });

  it("does not treat the persistent full default as an explicit one-use mode", () => {
    expect(
      composerModes(agentCapabilityPreset("safe_automation")).some(
        (mode) => mode.active,
      ),
    ).toBe(false);
  });

  it("does not gate read-only modes on the sandbox", () => {
    expect(
      composerModeDependency("research", projection("unavailable")),
    ).toEqual({ level: "ready", message: "" });
    expect(
      composerModeDependency("browser", projection("unavailable")),
    ).toEqual({ level: "ready", message: "" });
  });

  it("blocks process-capable modes when the sandbox is unavailable", () => {
    const coding = composerModeDependency("coding", projection("unavailable"));
    expect(coding.level).toBe("blocked");
    expect(coding.message).toContain("Sandbox is unavailable");
    expect(composerModeNeedsSandboxSetup("coding", coding)).toBe(true);
    expect(
      composerModeDependency("safe_automation", projection("unavailable"))
        .level,
    ).toBe("blocked");
  });

  it("does not offer Sandbox setup for unrelated blocked dependencies", () => {
    expect(
      composerModeNeedsSandboxSetup("browser", {
        level: "blocked",
        message: "Browser unavailable",
      }),
    ).toBe(false);
  });

  it("allows process-capable modes when the sandbox is available", () => {
    expect(
      composerModeDependency("coding", projection("available_unverified"))
        .level,
    ).toBe("ready");
  });

  it("warns before projection loads for process-capable modes", () => {
    expect(composerModeDependency("coding", undefined).level).toBe("warn");
    expect(composerModeDependency("research", undefined).level).toBe("ready");
  });

  it("labels mode policy from the shared preset definition", () => {
    expect(composerModePolicyLabel("coding")).toBe("Workspace changes");
    expect(composerModePolicyLabel("research")).toBe("Read only");
  });
});

function projection(
  sandboxStatus: EffectiveAgentCapabilityProjectionV1["readiness"][number]["status"],
): EffectiveAgentCapabilityProjectionV1 {
  return {
    kind: "napier.effective-agent-capabilities",
    schemaVersion: 1,
    agentId: "agent_napier",
    agentRevision: 3,
    contractId: "napier.default-agent.capabilities",
    contractVersion: 1,
    recommendationSha256: "a".repeat(64),
    driftState: "current",
    ownership: "recommended",
    explicitOverrideFields: [],
    toolPolicy: "observe",
    configuredTools: [],
    runtimeExposedTools: [],
    configuredSkills: [],
    configuredSubagents: [],
    readiness: [
      {
        id: "sandbox:macos-sandbox-exec",
        status: sandboxStatus,
        configured: true,
        allowedByPolicy: false,
        exposed: false,
        detail: "fixture",
      },
    ],
    restorePreview: {
      schemaVersion: 1,
      contractId: "napier.default-agent.capabilities",
      contractVersion: 1,
      recommendationSha256: "a".repeat(64),
      agentId: "agent_napier",
      agentRevision: 3,
      currentManagedStateSha256: "b".repeat(64),
      targetManagedStateSha256: "c".repeat(64),
      operations: [],
      diffSha256: "d".repeat(64),
    },
    projectionSha256: "e".repeat(64),
  };
}
