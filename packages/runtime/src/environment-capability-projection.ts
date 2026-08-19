import type { AgentProfile } from "@napier/contracts";
import { agentCapabilityStatus } from "@napier/contracts/agent-capabilities";
import type { CapabilityReadinessRecord } from "@napier/contracts/agent-capability-contract";

import { ENVIRONMENT_DEGRADED_READ_TOOL_NAMES } from "./read-only-tool-names.js";

const ENVIRONMENT_DEGRADED_TOOLS = new Set<string>(
  ENVIRONMENT_DEGRADED_READ_TOOL_NAMES,
);

export function projectEnvironmentToolSurface(input: {
  profile: Pick<
    AgentProfile,
    "toolPolicy" | "enabledTools" | "enabledSkills" | "enabledSubagents"
  >;
  constructedTools: readonly string[];
  sandboxReadiness: CapabilityReadinessRecord;
}): { environmentDegraded: boolean; runtimeExposedTools: string[] } {
  const environmentDegraded =
    agentCapabilityStatus(input.profile).processExecution &&
    input.sandboxReadiness.status !== "ready";
  return {
    environmentDegraded,
    runtimeExposedTools: input.constructedTools.filter(
      (tool) => !environmentDegraded || ENVIRONMENT_DEGRADED_TOOLS.has(tool),
    ),
  };
}

export function environmentDegradedToolAllowed(tool: string): boolean {
  return ENVIRONMENT_DEGRADED_TOOLS.has(tool);
}
