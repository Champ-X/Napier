import type {
  AutomaticRecoveryAssessment,
  AutomaticRecoveryAttempt,
  RunEvent,
  ThreadRecord,
} from "@napier/contracts";

import {
  applyConversationRecoveryEvent,
  createConversationRecoveryEventState,
  projectConversationRecoveries,
  type ConversationRecovery,
  type ConversationRecoveryEventState,
} from "./conversation-recoveries-projection.js";
import type {
  KernelProjectionDefinition,
  KernelProjectionReceipt,
  KernelProjectionRegistry,
} from "./kernel-projections.js";

export const CONVERSATION_RECOVERIES_PROJECTION: KernelProjectionDefinition<
  undefined,
  ConversationRecoveryEventState,
  ConversationRecoveryEventState
> = {
  id: "recovery.current",
  version: 1,
  init: () => createConversationRecoveryEventState(),
  apply: applyConversationRecoveryEvent,
  view: (state) => structuredClone(state),
};

export class ConversationRecoveriesProjectionService {
  constructor(
    private readonly registry: KernelProjectionRegistry,
    private readonly store: {
      getThread(threadId: string): ThreadRecord;
      listAutomaticRecoveryAssessments(
        threadId: string,
      ): AutomaticRecoveryAssessment[];
      listAutomaticRecoveryAttempts(
        threadId: string,
      ): AutomaticRecoveryAttempt[];
      listEvents(threadId: string, afterSeq?: number): Promise<RunEvent[]>;
    },
  ) {
    registry.register(CONVERSATION_RECOVERIES_PROJECTION);
  }

  async project(
    threadId: string,
  ): Promise<KernelProjectionReceipt<ConversationRecovery[]>> {
    const thread = this.store.getThread(threadId);
    const receipt = await this.registry.project({
      definition: CONVERSATION_RECOVERIES_PROJECTION,
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
      view: projectConversationRecoveries(
        this.store.listAutomaticRecoveryAssessments(threadId),
        this.store.listAutomaticRecoveryAttempts(threadId),
        receipt.view,
      ),
    };
  }
}
