import type {
  AgentProfile,
  RunExecutionMode,
  SubagentRole,
  ToolPolicyMode,
} from "@napier/contracts";

import {
  CORE_STATELESS_READ_TOOL_NAMES,
  ENVIRONMENT_DEGRADED_READ_TOOL_NAMES,
} from "./read-only-tool-names.js";

const CORE_READ_TOOLS = new Set<string>(CORE_STATELESS_READ_TOOL_NAMES);
const ENVIRONMENT_DEGRADED_READ_TOOLS = new Set<string>(
  ENVIRONMENT_DEGRADED_READ_TOOL_NAMES,
);

export interface RunExecutionCapabilitySurface {
  toolPolicy: ToolPolicyMode;
  enabledTools: string[];
  enabledSubagents: SubagentRole[];
}

export function environmentDegradedExecution(mode: RunExecutionMode): boolean {
  return mode === "environment_degraded_read_only";
}

export function restrictedReadOnlyExecution(mode: RunExecutionMode): boolean {
  return mode !== "standard" && !environmentDegradedExecution(mode);
}

export function readOnlyExecutionToolsFor(
  mode: RunExecutionMode,
): ReadonlySet<string> {
  return mode === "environment_degraded_read_only"
    ? ENVIRONMENT_DEGRADED_READ_TOOLS
    : CORE_READ_TOOLS;
}

export function projectRunExecutionCapabilitySurface(
  profile: Pick<
    AgentProfile,
    "toolPolicy" | "enabledTools" | "enabledSubagents"
  >,
  mode: RunExecutionMode,
): RunExecutionCapabilitySurface {
  const restricted = restrictedReadOnlyExecution(mode);
  const degraded = environmentDegradedExecution(mode);
  const allowedTools = readOnlyExecutionToolsFor(mode);
  return {
    toolPolicy: restricted || degraded ? "observe" : profile.toolPolicy,
    enabledTools:
      mode === "model_experiment_single_call" ||
      mode === "context_compaction_single_call"
        ? []
        : restricted || degraded
          ? profile.enabledTools.filter((tool) => allowedTools.has(tool))
          : [...profile.enabledTools],
    enabledSubagents:
      restricted || degraded ? [] : [...(profile.enabledSubagents ?? [])],
  };
}

export function validRunExecutionCapabilitySurface(input: {
  mode: RunExecutionMode;
  toolPolicy: ToolPolicyMode;
  enabledTools: readonly string[];
  enabledSubagents: readonly SubagentRole[];
}): boolean {
  if (input.mode === "standard") return true;
  if (
    (restrictedReadOnlyExecution(input.mode) ||
      environmentDegradedExecution(input.mode)) &&
    input.toolPolicy !== "observe"
  ) {
    return false;
  }
  const allowedTools = readOnlyExecutionToolsFor(input.mode);
  return (
    input.enabledSubagents.length === 0 &&
    input.enabledTools.every((tool) => allowedTools.has(tool))
  );
}
