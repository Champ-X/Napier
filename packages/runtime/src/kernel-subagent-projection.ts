import type { RunEvent, SubagentTask, ThreadRecord } from "@napier/contracts";

import {
  applyConversationSubagentEvent,
  createConversationSubagentEventState,
  projectConversationSubagents,
  type ConversationSubagent,
  type ConversationSubagentEventState,
} from "./conversation-subagents-projection.js";
import type {
  KernelProjectionDefinition,
  KernelProjectionReceipt,
  KernelProjectionRegistry,
} from "./kernel-projections.js";

export const CONVERSATION_SUBAGENTS_PROJECTION: KernelProjectionDefinition<
  undefined,
  ConversationSubagentEventState,
  ConversationSubagentEventState
> = {
  id: "subagents.current",
  version: 1,
  init: () => createConversationSubagentEventState(),
  apply: applyConversationSubagentEvent,
  view: (state) => structuredClone(state),
};

export class ConversationSubagentsProjectionService {
  constructor(
    private readonly registry: KernelProjectionRegistry,
    private readonly store: {
      getThread(threadId: string): ThreadRecord;
      listEvents(threadId: string, afterSeq?: number): Promise<RunEvent[]>;
      listSubagentTasks(threadId: string): SubagentTask[];
    },
  ) {
    registry.register(CONVERSATION_SUBAGENTS_PROJECTION);
  }

  async project(
    threadId: string,
  ): Promise<KernelProjectionReceipt<ConversationSubagent[]>> {
    const thread = this.store.getThread(threadId);
    const receipt = await this.registry.project({
      definition: CONVERSATION_SUBAGENTS_PROJECTION,
      subjectId: threadId,
      seed: undefined,
      sourceIdentity: { id: thread.id, createdAt: thread.createdAt },
      sourceWatermark: thread.eventCount,
      loadEvents: async (afterSeq) =>
        (await this.store.listEvents(threadId, afterSeq)).filter(
          (event) => event.seq <= thread.eventCount,
        ),
    });
    return {
      ...receipt,
      view: projectConversationSubagents(
        this.store.listSubagentTasks(threadId),
        receipt.view,
      ),
    };
  }
}
