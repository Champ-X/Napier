import type { AgentProfile } from "@napier/contracts";
import { agentCapabilityStatus } from "@napier/contracts/agent-capabilities";

export function agentCapabilityBadgeText(
  agent: Pick<
    AgentProfile,
    "toolPolicy" | "enabledTools" | "enabledSkills" | "enabledSubagents"
  >,
): string {
  const status = agentCapabilityStatus(agent);
  return `${status.label} · ${status.policyLabel} · interact ${status.browserInteract ? "yes" : "no"}`;
}

export function agentCapabilityDetailText(
  agent: Pick<
    AgentProfile,
    "toolPolicy" | "enabledTools" | "enabledSkills" | "enabledSubagents"
  >,
): string {
  const status = agentCapabilityStatus(agent);
  return `${status.policyLabel} · ${String(status.enabledToolCount)} tools · Browser read ${yesNo(status.browserRead)} · Browser interact ${yesNo(status.browserInteract)}`;
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}
