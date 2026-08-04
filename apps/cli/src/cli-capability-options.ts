import {
  AGENT_CAPABILITY_PRESET_IDS,
  type AgentCapabilityPresetId,
} from "@napier/contracts/agent-capabilities";

import { optionalResourceId, requiredValue } from "./cli-option-values.js";
import type { CliWorkspaceOptions } from "./cli-execution-options.js";

export interface CliCapabilityOptions extends CliWorkspaceOptions {
  agentId?: string;
  presetId?: AgentCapabilityPresetId;
  apply: boolean;
}

export const CAPABILITY_VALUE_OPTIONS = new Set([
  "--workspace",
  "--data-root",
  "--agent",
  "--preset",
]);
export const CAPABILITY_FLAG_OPTIONS = new Set(["--apply"]);

export function optionalCapabilityPreset(
  values: Map<string, string>,
): AgentCapabilityPresetId | undefined {
  if (!values.has("--preset")) return undefined;
  const preset = requiredValue(values, "--preset");
  if (
    !AGENT_CAPABILITY_PRESET_IDS.includes(preset as AgentCapabilityPresetId)
  ) {
    throw new Error(
      `--preset must be one of ${AGENT_CAPABILITY_PRESET_IDS.join(", ")}`,
    );
  }
  return preset as AgentCapabilityPresetId;
}

export function parseCapabilityOptions(
  values: Map<string, string>,
  flags: ReadonlySet<string>,
  jsonl: boolean,
): { kind: "capabilities"; options: CliCapabilityOptions } {
  const preset = optionalCapabilityPreset(values);
  if (flags.has("--apply") && !preset) {
    throw new Error("--apply requires --preset");
  }
  return {
    kind: "capabilities",
    options: {
      workspace: requiredValue(values, "--workspace"),
      jsonl,
      apply: flags.has("--apply"),
      ...(values.has("--data-root")
        ? { dataRoot: requiredValue(values, "--data-root") }
        : {}),
      ...(optionalResourceId(values, "--agent")
        ? { agentId: optionalResourceId(values, "--agent")! }
        : {}),
      ...(preset ? { presetId: preset } : {}),
    },
  };
}
