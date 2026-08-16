import type { RunEvent, ThreadRecord } from "@napier/contracts";

import {
  activePlanEventWatermark,
  projectActivePlan,
  type ActivePlanProjection,
} from "./active-plan-projection.js";
import {
  applyConversationMessage,
  type ConversationMessage,
} from "./conversation-messages-projection.js";
import {
  applyConversationArtifactEvent,
  createConversationArtifactEventState,
  projectConversationArtifacts,
  type ConversationArtifact,
  type ConversationArtifactEventState,
} from "./conversation-artifacts-projection.js";
import { applyConversationActivityEvent } from "./conversation-activity-events-projection.js";
import {
  applyConversationCitation,
  type ConversationCitation,
} from "./conversation-citations-projection.js";
import type {
  KernelProjectionDefinition,
  KernelProjectionReceipt,
  KernelProjectionRegistry,
} from "./kernel-projections.js";
import {
  applyOperatorDecisionEvent,
  operatorDecisionProjectionView,
} from "./operator-decisions.js";

export const ACTIVE_PLAN_PROJECTION: KernelProjectionDefinition<
  undefined,
  number,
  number
> = {
  id: "plan.active",
  version: 1,
  init: () => 0,
  apply: activePlanEventWatermark,
  view: (state) => state,
};

export class ActivePlanProjectionService {
  constructor(
    private readonly registry: KernelProjectionRegistry,
    private readonly store: {
      getThread(threadId: string): ThreadRecord;
      listEvents(threadId: string, afterSeq?: number): Promise<RunEvent[]>;
      listPlans(threadId: string): import("@napier/contracts").ExecutionPlan[];
    },
  ) {
    registry.register(ACTIVE_PLAN_PROJECTION);
  }

  async project(
    threadId: string,
  ): Promise<KernelProjectionReceipt<ActivePlanProjection | undefined>> {
    const thread = this.store.getThread(threadId);
    const receipt = await this.registry.project({
      definition: ACTIVE_PLAN_PROJECTION,
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
      view: projectActivePlan(this.store.listPlans(threadId), receipt.view),
    };
  }
}

export const CONVERSATION_MESSAGES_PROJECTION: KernelProjectionDefinition<
  undefined,
  ConversationMessage[],
  ConversationMessage[]
> = {
  id: "conversation.messages",
  version: 1,
  init: () => [],
  apply: applyConversationMessage,
  view: (state) => structuredClone(state),
};

export class ConversationMessagesProjectionService {
  constructor(
    private readonly registry: KernelProjectionRegistry,
    private readonly store: {
      getThread(threadId: string): ThreadRecord;
      listEvents(threadId: string, afterSeq?: number): Promise<RunEvent[]>;
    },
  ) {
    registry.register(CONVERSATION_MESSAGES_PROJECTION);
  }

  async project(
    threadId: string,
  ): Promise<KernelProjectionReceipt<ConversationMessage[]>> {
    const thread = this.store.getThread(threadId);
    return this.registry.project({
      definition: CONVERSATION_MESSAGES_PROJECTION,
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

export const CONVERSATION_ARTIFACTS_PROJECTION: KernelProjectionDefinition<
  undefined,
  ConversationArtifactEventState,
  ConversationArtifactEventState
> = {
  id: "conversation.artifacts",
  version: 1,
  init: () => createConversationArtifactEventState(),
  apply: applyConversationArtifactEvent,
  view: (state) => structuredClone(state),
};

export class ConversationArtifactsProjectionService {
  constructor(
    private readonly registry: KernelProjectionRegistry,
    private readonly store: {
      getThread(threadId: string): ThreadRecord;
      listEvents(threadId: string, afterSeq?: number): Promise<RunEvent[]>;
      listPlans(threadId: string): import("@napier/contracts").ExecutionPlan[];
      listRuns(threadId: string): import("@napier/contracts").RunRecord[];
    },
    private readonly owner = "kernel",
  ) {
    registry.register(CONVERSATION_ARTIFACTS_PROJECTION, owner);
  }

  async project(
    threadId: string,
  ): Promise<KernelProjectionReceipt<ConversationArtifact[]>> {
    const thread = this.store.getThread(threadId);
    const receipt = await this.registry.project({
      definition: CONVERSATION_ARTIFACTS_PROJECTION,
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
      view: projectConversationArtifacts(
        this.store.listPlans(threadId),
        this.store.listRuns(threadId),
        receipt.view,
      ),
    };
  }

  dispose(): void {
    this.registry.disposeOwner(this.owner);
  }
}

export const OPERATOR_DECISIONS_PROJECTION: KernelProjectionDefinition<
  undefined,
  Map<string, import("@napier/contracts").OperatorDecision>,
  import("@napier/contracts").OperatorDecision[]
> = {
  id: "approval.current",
  version: 1,
  init: () => new Map(),
  apply: applyOperatorDecisionEvent,
  view: operatorDecisionProjectionView,
};

export class OperatorDecisionsProjectionService {
  constructor(
    private readonly registry: KernelProjectionRegistry,
    private readonly store: {
      getThread(threadId: string): ThreadRecord;
      listEvents(threadId: string, afterSeq?: number): Promise<RunEvent[]>;
    },
  ) {
    registry.register(OPERATOR_DECISIONS_PROJECTION);
  }

  async project(
    threadId: string,
  ): Promise<
    KernelProjectionReceipt<import("@napier/contracts").OperatorDecision[]>
  > {
    const thread = this.store.getThread(threadId);
    return this.registry.project({
      definition: OPERATOR_DECISIONS_PROJECTION,
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

export const CONVERSATION_ACTIVITY_EVENTS_PROJECTION: KernelProjectionDefinition<
  undefined,
  RunEvent[],
  RunEvent[]
> = {
  id: "conversation.activity-events",
  version: 1,
  init: () => [],
  apply: applyConversationActivityEvent,
  view: (state) => structuredClone(state),
};

export class ConversationActivityEventsProjectionService {
  constructor(
    private readonly registry: KernelProjectionRegistry,
    private readonly store: {
      getThread(threadId: string): ThreadRecord;
      listEvents(threadId: string, afterSeq?: number): Promise<RunEvent[]>;
    },
  ) {
    registry.register(CONVERSATION_ACTIVITY_EVENTS_PROJECTION);
  }

  async project(
    threadId: string,
  ): Promise<KernelProjectionReceipt<RunEvent[]>> {
    const thread = this.store.getThread(threadId);
    return this.registry.project({
      definition: CONVERSATION_ACTIVITY_EVENTS_PROJECTION,
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

export const CONVERSATION_CITATIONS_PROJECTION: KernelProjectionDefinition<
  undefined,
  ConversationCitation[],
  ConversationCitation[]
> = {
  id: "conversation.citations",
  version: 1,
  init: () => [],
  apply: applyConversationCitation,
  view: (state) => structuredClone(state),
};

export class ConversationCitationsProjectionService {
  constructor(
    private readonly registry: KernelProjectionRegistry,
    private readonly store: {
      getThread(threadId: string): ThreadRecord;
      listEvents(threadId: string, afterSeq?: number): Promise<RunEvent[]>;
    },
  ) {
    registry.register(CONVERSATION_CITATIONS_PROJECTION);
  }

  async project(
    threadId: string,
  ): Promise<KernelProjectionReceipt<ConversationCitation[]>> {
    const thread = this.store.getThread(threadId);
    return this.registry.project({
      definition: CONVERSATION_CITATIONS_PROJECTION,
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
