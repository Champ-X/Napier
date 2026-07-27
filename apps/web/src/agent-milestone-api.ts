import type { AgentMilestone, RunEvent } from "@napier/contracts";

import { requestJson } from "./api-client";

export function listAgentMilestones(
  threadId: string,
): Promise<AgentMilestone[]> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/agent-milestones`,
  );
}

export function latestAgentMilestoneEventSeq(events: RunEvent[]): number {
  return events.reduce(
    (latest, event) =>
      event.type === "agent.milestone.recorded"
        ? Math.max(latest, event.seq)
        : latest,
    0,
  );
}
