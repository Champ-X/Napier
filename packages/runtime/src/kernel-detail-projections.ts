import type { RunEvent } from "@napier/contracts";

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
  loadKernelProjectionEvents,
  type KernelProjectionEventStore,
} from "./kernel-projection-event-loader.js";
import {
  applyOperatorDecisionEvent,
  OPERATOR_DECISION_ANSWERED_EVENT,
  OPERATOR_DECISION_CANCELLED_EVENT,
  OPERATOR_DECISION_CONTINUED_EVENT,
  OPERATOR_DECISION_REQUESTED_EVENT,
  operatorDecisionProjectionView,
} from "./operator-decisions.js";

const ACTIVE_PLAN_EVENT_TYPES = [
  "plan.artifact.candidate",
  "plan.artifact.missing",
  "plan.artifact.produced",
  "plan.artifact.expected",
  "plan.artifact.superseded",
  "plan.artifact.verified",
  "plan.blueprint.reused",
  "plan.blueprint.saved",
  "plan.created",
  "plan.replanned",
  "plan.step.blocked",
  "plan.step.completed",
  "plan.step.partial",
  "plan.step.reopened",
  "plan.step.skipped",
  "plan.step.started",
] as const;

const CONVERSATION_ARTIFACT_EVENT_TYPES = [
  "run.started",
  ...ACTIVE_PLAN_EVENT_TYPES,
] as const;

const CONVERSATION_MESSAGE_EVENT_TYPES = [
  "message.user",
  "message.assistant",
] as const;

const CONVERSATION_ACTIVITY_EVENT_TYPES = [
  "tool.started",
  "tool.completed",
  "tool.failed",
  "tool.blocked",
] as const;

const OPERATOR_DECISION_EVENT_TYPES = [
  OPERATOR_DECISION_REQUESTED_EVENT,
  OPERATOR_DECISION_ANSWERED_EVENT,
  OPERATOR_DECISION_CONTINUED_EVENT,
  OPERATOR_DECISION_CANCELLED_EVENT,
] as const;

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
    private readonly store: KernelProjectionEventStore & {
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
      loadEvents: (afterSeq) =>
        loadKernelProjectionEvents(
          this.store,
          threadId,
          afterSeq,
          thread.eventCount,
          ACTIVE_PLAN_EVENT_TYPES,
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
    private readonly store: KernelProjectionEventStore,
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
      loadEvents: (afterSeq) =>
        loadKernelProjectionEvents(
          this.store,
          threadId,
          afterSeq,
          thread.eventCount,
          CONVERSATION_MESSAGE_EVENT_TYPES,
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
  version: 2,
  init: () => createConversationArtifactEventState(),
  apply: applyConversationArtifactEvent,
  view: (state) => structuredClone(state),
};

export class ConversationArtifactsProjectionService {
  constructor(
    private readonly registry: KernelProjectionRegistry,
    private readonly store: KernelProjectionEventStore & {
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
      loadEvents: (afterSeq) =>
        loadKernelProjectionEvents(
          this.store,
          threadId,
          afterSeq,
          thread.eventCount,
          CONVERSATION_ARTIFACT_EVENT_TYPES,
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
    private readonly store: KernelProjectionEventStore,
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
      loadEvents: (afterSeq) =>
        loadKernelProjectionEvents(
          this.store,
          threadId,
          afterSeq,
          thread.eventCount,
          OPERATOR_DECISION_EVENT_TYPES,
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
    private readonly store: KernelProjectionEventStore,
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
      loadEvents: (afterSeq) =>
        loadKernelProjectionEvents(
          this.store,
          threadId,
          afterSeq,
          thread.eventCount,
          CONVERSATION_ACTIVITY_EVENT_TYPES,
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
    private readonly store: KernelProjectionEventStore,
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
      loadEvents: (afterSeq) =>
        loadKernelProjectionEvents(
          this.store,
          threadId,
          afterSeq,
          thread.eventCount,
          ["tool.completed"],
        ),
    });
  }
}
