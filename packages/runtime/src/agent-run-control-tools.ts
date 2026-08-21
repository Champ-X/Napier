import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { RunRecord } from "@napier/contracts";

import { createAgentMilestoneTool } from "./agent-milestone-tool.js";
import type { EventSink } from "./event-sink.js";
import { createOperatorDecisionTool } from "./operator-decision-tool.js";
import { createPlanTools } from "./plan-tools.js";
import type { LocalStore } from "./store.js";

export function createAgentRunControlTools(input: {
  store: LocalStore;
  run: RunRecord;
  onOperatorDecision(id: string): void;
  onEvent?: EventSink;
}): AgentTool[] {
  return [
    ...createPlanTools(input.store, input.run),
    createAgentMilestoneTool({
      store: input.store,
      threadId: input.run.threadId,
      runId: input.run.id,
      onRecorded: (mutation) => emitEvents(mutation.events, input.onEvent),
    }),
    createOperatorDecisionTool({
      store: input.store,
      threadId: input.run.threadId,
      runId: input.run.id,
      onRequested: async (mutation) => {
        input.onOperatorDecision(mutation.decision.id);
        await emitEvents(mutation.events, input.onEvent);
      },
    }),
  ];
}

async function emitEvents(
  events: Parameters<NonNullable<EventSink>>[0][],
  onEvent: EventSink | undefined,
): Promise<void> {
  if (!onEvent) return;
  for (const event of events) await onEvent(event);
}
