import type {
  ExecutionPlan,
  RunEvent,
  RunRecord,
  ThreadRecord,
} from "@napier/contracts";

import {
  applyConversationPlanEvent,
  createConversationPlanEventState,
  projectConversationPlans,
  type ConversationPlan,
  type ConversationPlanEventState,
} from "./conversation-plans-projection.js";
import { projectActivePlan } from "./active-plan-projection.js";
import type {
  KernelProjectionDefinition,
  KernelProjectionReceipt,
  KernelProjectionRegistry,
} from "./kernel-projections.js";

export const CONVERSATION_PLANS_PROJECTION: KernelProjectionDefinition<
  undefined,
  ConversationPlanEventState,
  ConversationPlanEventState
> = {
  id: "conversation.plans",
  version: 1,
  init: () => createConversationPlanEventState(),
  apply: applyConversationPlanEvent,
  view: (state) => structuredClone(state),
};

export class ConversationPlansProjectionService {
  constructor(
    private readonly registry: KernelProjectionRegistry,
    private readonly store: {
      getThread(threadId: string): ThreadRecord;
      listEvents(threadId: string, afterSeq?: number): Promise<RunEvent[]>;
      listPlans(threadId: string): ExecutionPlan[];
      listRuns(threadId: string): RunRecord[];
    },
  ) {
    registry.register(CONVERSATION_PLANS_PROJECTION);
  }

  async project(
    threadId: string,
  ): Promise<KernelProjectionReceipt<ConversationPlan[]>> {
    const thread = this.store.getThread(threadId);
    const plans = this.store.listPlans(threadId);
    const runs = this.store.listRuns(threadId);
    const receipt = await this.registry.project({
      definition: CONVERSATION_PLANS_PROJECTION,
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
      view: projectConversationPlans(
        plans,
        runs,
        receipt.view,
        projectActivePlan(plans, receipt.eventWatermark),
      ),
    };
  }
}
