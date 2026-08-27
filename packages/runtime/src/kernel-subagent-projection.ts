import type { RunEvent, SubagentTask, ThreadRecord } from "@napier/contracts";
import type {
  SubagentHubControlAvailabilityV1,
  SubagentHubProjectionV1,
} from "@napier/contracts/subagent-hub";

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
import {
  applySubagentHubEvent,
  createSubagentHubEventState,
  projectSubagentHub,
  type SubagentHubEventState,
} from "./subagent-hub-projection.js";

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

export const SUBAGENT_HUB_PROJECTION: KernelProjectionDefinition<
  undefined,
  SubagentHubEventState,
  SubagentHubEventState
> = {
  id: "subagents.hub",
  version: 1,
  init: () => createSubagentHubEventState(),
  apply: applySubagentHubEvent,
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
    registry.register(SUBAGENT_HUB_PROJECTION);
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

  async projectHub(
    threadId: string,
    availability?: (
      task: SubagentTask,
    ) => SubagentHubControlAvailabilityV1,
  ): Promise<KernelProjectionReceipt<SubagentHubProjectionV1>> {
    const thread = this.store.getThread(threadId);
    const receipt = await this.registry.project({
      definition: SUBAGENT_HUB_PROJECTION,
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
      view: projectSubagentHub(
        threadId,
        this.store.listSubagentTasks(threadId),
        receipt.view,
        receipt.eventWatermark,
        availability,
      ),
    };
  }
}
