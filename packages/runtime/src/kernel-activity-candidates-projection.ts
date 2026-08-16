import type { RunEvent, ThreadRecord } from "@napier/contracts";

import {
  applyConversationActivityCandidate,
  type ConversationActivityCandidate,
} from "./conversation-activity-candidates-projection.js";
import type {
  KernelProjectionDefinition,
  KernelProjectionReceipt,
  KernelProjectionRegistry,
} from "./kernel-projections.js";

export const CONVERSATION_ACTIVITY_CANDIDATES_PROJECTION: KernelProjectionDefinition<
  undefined,
  ConversationActivityCandidate[],
  ConversationActivityCandidate[]
> = {
  id: "conversation.activity-candidates",
  version: 1,
  init: () => [],
  apply: applyConversationActivityCandidate,
  view: (state) => structuredClone(state),
};

export class ConversationActivityCandidatesProjectionService {
  constructor(
    private readonly registry: KernelProjectionRegistry,
    private readonly store: {
      getThread(threadId: string): ThreadRecord;
      listEvents(threadId: string, afterSeq?: number): Promise<RunEvent[]>;
    },
  ) {
    registry.register(CONVERSATION_ACTIVITY_CANDIDATES_PROJECTION);
  }

  async project(
    threadId: string,
  ): Promise<KernelProjectionReceipt<ConversationActivityCandidate[]>> {
    const thread = this.store.getThread(threadId);
    return this.registry.project({
      definition: CONVERSATION_ACTIVITY_CANDIDATES_PROJECTION,
      subjectId: threadId,
      seed: undefined,
      sourceIdentity: { id: thread.id, createdAt: thread.createdAt },
      sourceWatermark: thread.eventCount,
      loadEvents: async (afterSeq) =>
        (await this.store.listEvents(threadId, afterSeq)).filter(
          (event) => event.seq <= thread.eventCount,
        ),
    });
  }
}
