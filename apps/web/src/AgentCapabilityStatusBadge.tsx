import type { AgentProfile } from "@napier/contracts";
import { ShieldCheck } from "lucide-react";

import { agentCapabilityBadgeText } from "./agent-capability-view-model";

export function AgentCapabilityStatusBadge({
  agent,
}: {
  agent: AgentProfile | undefined;
}) {
  return (
    <span>
      <ShieldCheck size={13} aria-hidden="true" />
      {agent ? agentCapabilityBadgeText(agent) : "Read only"}
    </span>
  );
}
