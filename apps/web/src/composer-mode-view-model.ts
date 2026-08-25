import {
  AGENT_CAPABILITY_PRESETS,
  agentCapabilityPreset,
  type AgentCapabilityPresetId,
} from "@napier/contracts/agent-capabilities";
import type { AgentProfile } from "@napier/contracts";
import type { EffectiveAgentCapabilityProjectionV1 } from "@napier/contracts/agent-capability-contract";
import { composerCopy } from "./composer-copy";

export interface ComposerMode {
  id: AgentCapabilityPresetId;
  label: string;
  summary: string;
  active: boolean;
  temporary: boolean;
  requiresSandbox: boolean;
}

export type ComposerModeDependencyLevel = "ready" | "warn" | "blocked";

export interface ComposerModeDependency {
  level: ComposerModeDependencyLevel;
  message: string;
}

const SANDBOX_PRESETS = new Set<AgentCapabilityPresetId>([
  "coding",
  "safe_automation",
]);

/**
 * Task modes surfaced next to the Composer. Each entry reuses the existing
 * capability preset definition so selection only fills already-audited policy,
 * tool, skill, and delegation fields.
 */
export function composerModes(
  _profile:
    | Pick<
        AgentProfile,
        "toolPolicy" | "enabledTools" | "enabledSkills" | "enabledSubagents"
      >
    | undefined,
  selectedPreset?: AgentCapabilityPresetId,
): ComposerMode[] {
  return AGENT_CAPABILITY_PRESETS.map((preset) => ({
    id: preset.id,
    label: preset.label,
    summary: preset.summary,
    active: preset.id === selectedPreset,
    temporary: preset.id === selectedPreset,
    requiresSandbox: SANDBOX_PRESETS.has(preset.id),
  }));
}

/**
 * Checks whether the runtime dependencies a mode needs are actually available
 * before it is applied. Only claims that map to a truthful readiness signal are
 * surfaced; a missing sandbox blocks process-capable modes because those tasks
 * fail closed at execution time.
 */
export function composerModeDependency(
  modeId: AgentCapabilityPresetId,
  projection: EffectiveAgentCapabilityProjectionV1 | undefined,
): ComposerModeDependency {
  if (!SANDBOX_PRESETS.has(modeId)) {
    return { level: "ready", message: "" };
  }
  if (!projection) {
    return {
      level: "warn",
      message: composerCopy.mode.sandboxNotLoaded,
    };
  }
  const sandbox = projection.readiness.find((item) =>
    item.id.startsWith("sandbox:"),
  );
  if (sandbox && sandbox.status === "unavailable") {
    const invalid = sandbox.id === "sandbox:configured-sandbox-invalid";
    return {
      level: "warn",
      message: invalid
        ? composerCopy.mode.sandboxInvalid
        : composerCopy.mode.sandboxUnavailable,
    };
  }
  return { level: "ready", message: "" };
}

export function composerModeNeedsSandboxSetup(
  modeId: AgentCapabilityPresetId,
  dependency: ComposerModeDependency,
): boolean {
  return SANDBOX_PRESETS.has(modeId) && dependency.level !== "ready";
}

export function composerModePolicyLabel(
  modeId: AgentCapabilityPresetId,
): string {
  const preset = agentCapabilityPreset(modeId);
  return preset.toolPolicy === "observe"
    ? composerCopy.mode.policyReadOnly
    : preset.toolPolicy === "workspace"
      ? composerCopy.mode.policyWorkspace
      : composerCopy.mode.policyExternal;
}
