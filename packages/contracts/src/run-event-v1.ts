import { RUN_EVENT_DOMAIN_DEFINITION_GROUPS_V1 } from "./run-event-domain-definitions-v1.js";

export type JsonPrimitive = boolean | number | string | null;

export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

export type EventCategory =
  | "lifecycle"
  | "message"
  | "model"
  | "tool"
  | "artifact"
  | "goal"
  | "plan"
  | "memory"
  | "subagent"
  | "extension"
  | "credential"
  | "evaluation"
  | "automation"
  | "channel"
  | "system";

export type EventVisibility = "user" | "debug" | "hidden";

export interface RunEventDefinitionV1 {
  category: EventCategory;
  defaultVisibility: EventVisibility;
  allowedVisibilities: readonly EventVisibility[];
  owner: string;
  projectionOwner: string;
  schemaVersion: 1;
}

function defineEventGroup<
  const TTypes extends readonly string[],
  const TCategory extends EventCategory,
  const TVisibility extends EventVisibility,
>(definition: {
  types: TTypes;
  category: TCategory;
  defaultVisibility: TVisibility;
  allowedVisibilities?: readonly EventVisibility[];
  owner: string;
  projectionOwner: string;
}) {
  return {
    ...definition,
    allowedVisibilities: definition.allowedVisibilities ?? [
      definition.defaultVisibility,
    ],
    schemaVersion: 1 as const,
  };
}

export const RUN_EVENT_DEFINITION_GROUPS_V1 = [
  defineEventGroup({
    types: ["message.user", "message.assistant"],
    category: "message",
    defaultVisibility: "user",
    allowedVisibilities: ["user", "hidden"],
    owner: "conversation",
    projectionOwner: "conversation-feed",
  }),
  defineEventGroup({
    types: [
      "run.control.queued",
      "run.control.delivered",
      "run.control.cancelled",
    ],
    category: "message",
    defaultVisibility: "user",
    owner: "run-control",
    projectionOwner: "conversation-feed",
  }),
  defineEventGroup({
    types: ["run.started", "run.completed", "turn.started", "turn.completed"],
    category: "lifecycle",
    defaultVisibility: "debug",
    owner: "run-coordinator",
    projectionOwner: "task-summary",
  }),
  defineEventGroup({
    types: [
      "branch.created",
      "run.budget.exhausted",
      "run.finalization.reserved",
      "run.no_progress",
      "model.stream.watchdog_triggered",
      "model.thinking_loop.finalized",
      "run.recovery.completed",
      "run.recovery.failed",
      "run.recovery.started",
      "run.research.budget_exhausted",
      "run.settlement.checkpoint",
      "run.settlement.recorded",
      "run.waiting_for_operator",
      "thread.restored",
      "thread.trashed",
      "workspace.process.interrupted",
      "workspace.process.settled",
      "workspace.process.started",
    ],
    category: "lifecycle",
    defaultVisibility: "user",
    owner: "run-coordinator",
    projectionOwner: "task-summary",
  }),
  defineEventGroup({
    types: ["run.cancelled", "run.failed", "run.interrupted"],
    category: "lifecycle",
    defaultVisibility: "user",
    allowedVisibilities: ["user", "debug"],
    owner: "run-coordinator",
    projectionOwner: "task-summary",
  }),
  defineEventGroup({
    types: [
      "workspace.process.local_service_lease.granted",
      "workspace.process.local_service_lease.revoked",
    ],
    category: "lifecycle",
    defaultVisibility: "debug",
    owner: "workspace-process-runtime",
    projectionOwner: "trace-index",
  }),
  defineEventGroup({
    types: ["run.progress.rerouted", "run.progress.vector"],
    category: "lifecycle",
    defaultVisibility: "debug",
    owner: "run-progress",
    projectionOwner: "task-summary",
  }),
  defineEventGroup({
    types: ["run.recovery.prompt"],
    category: "lifecycle",
    defaultVisibility: "hidden",
    owner: "run-recovery",
    projectionOwner: "conversation-feed",
  }),
  defineEventGroup({
    types: ["thread.imported"],
    category: "lifecycle",
    defaultVisibility: "debug",
    owner: "thread-import",
    projectionOwner: "task-summary",
  }),
  defineEventGroup({
    types: [
      "agent.experiment.compared",
      "agent.experiment.failed",
      "agent.experiment.started",
      "context.compaction.completed",
      "context.compaction.failed",
      "model.experiment.compared",
      "model.experiment.failed",
      "model.experiment.started",
    ],
    category: "model",
    defaultVisibility: "user",
    owner: "model-runtime",
    projectionOwner: "trace-index",
  }),
  defineEventGroup({
    types: [
      "context.compaction.started",
      "context.conversation_surface",
      "context.conversation_surface_unavailable",
      "context.delegation.updated",
      "context.milestones.updated",
      "context.model_adapter",
      "context.model_envelope",
      "context.model_invocation",
      "context.model_invocation_unavailable",
      "context.projected",
      "context.prepared",
      "context.prompt_package",
      "harness.experiment.profile.applied",
      "model.context.overflow",
      "model.context.token_calibration",
      "model.context.token_pressure",
      "model.context.tool-results.pruned",
      "model.harness.resolved",
      "model.response",
      "model.stream.cancellation_failed",
      "model.thinking_loop.detected",
      "route_attempt_ended",
      "route_attempt_started",
      "route_plan_created",
    ],
    category: "model",
    defaultVisibility: "debug",
    allowedVisibilities: ["debug", "user"],
    owner: "model-runtime",
    projectionOwner: "trace-index",
  }),
  defineEventGroup({
    types: ["model.text.delta", "model.thinking.delta"],
    category: "model",
    defaultVisibility: "hidden",
    owner: "model-stream",
    projectionOwner: "trace-index",
  }),
  defineEventGroup({
    types: [
      "context.research_sources",
      "context.tool_invocation",
      "context.tool_invocation_unavailable",
      "context.tool_result",
      "context.tool_result_unavailable",
      "context.web_fetch_sources",
    ],
    category: "tool",
    defaultVisibility: "debug",
    owner: "tool-runtime",
    projectionOwner: "trace-index",
  }),
  defineEventGroup({
    types: [
      "browser.interaction_confirmation.approved",
      "browser.interaction_confirmation.cancelled",
      "browser.interaction_confirmation.expired",
      "browser.interaction_confirmation.pending",
      "browser.interaction_confirmation.rejected",
      "browser.session_pause.cancelled",
      "browser.session_pause.requested",
      "browser.session_pause.resumed",
      "browser.takeover.completed",
      "browser.takeover.failed",
      "browser.takeover.requested",
      "code_bridge.authorized",
      "tool.blocked",
      "tool.completed",
      "tool.failed",
      "tool.result_reuse.blocked",
      "tool.result_reused",
      "tool.started",
      "workspace.file.mutated",
      "workspace.process.input",
      "workspace.process.rollback_started",
      "workspace.process.rolled_back",
      "workspace.process.resized",
    ],
    category: "tool",
    defaultVisibility: "user",
    allowedVisibilities: ["user", "debug"],
    owner: "tool-runtime",
    projectionOwner: "trace-index",
  }),
  defineEventGroup({
    types: [
      "tool.cancellation.settled",
      "tool.deadline.exceeded",
      "tool.effect.journaled",
      "tool.retry.started",
    ],
    category: "tool",
    defaultVisibility: "debug",
    allowedVisibilities: ["debug", "user"],
    owner: "tool-runtime",
    projectionOwner: "trace-index",
  }),
  defineEventGroup({
    types: ["tool.experiment.compared", "tool.experiment.started"],
    category: "tool",
    defaultVisibility: "user",
    owner: "tool-experiment",
    projectionOwner: "trace-index",
  }),
  ...RUN_EVENT_DOMAIN_DEFINITION_GROUPS_V1,
] as const;

export type RegisteredRunEventType =
  (typeof RUN_EVENT_DEFINITION_GROUPS_V1)[number]["types"][number];

type RunEventDefinitionGroup = (typeof RUN_EVENT_DEFINITION_GROUPS_V1)[number];

type DefinitionFor<TType extends RegisteredRunEventType> =
  RunEventDefinitionGroup extends infer TDefinition
    ? TDefinition extends RunEventDefinitionGroup
      ? TType extends TDefinition["types"][number]
        ? TDefinition
        : never
      : never
    : never;

export interface MessageUserPayloadV1 extends JsonObject {
  role: "user";
  text: string;
}

export interface MessageAssistantPayloadV1 extends JsonObject {
  role: "assistant";
  text: string;
}

export interface ToolStartedPayloadV1 extends JsonObject {
  callId: string;
  toolName: string;
}

export interface ToolTerminalPayloadV1 extends JsonObject {
  callId: string;
  toolName: string;
}

interface CoreRunEventMap {
  "message.user": MessageUserPayloadV1;
  "message.assistant": MessageAssistantPayloadV1;
  "tool.started": ToolStartedPayloadV1;
  "tool.completed": ToolTerminalPayloadV1;
  "tool.failed": ToolTerminalPayloadV1;
}

export type RunEventMap = {
  [K in RegisteredRunEventType]: K extends keyof CoreRunEventMap
    ? CoreRunEventMap[K]
    : JsonObject;
};

export type RegisteredRunEventInputFor<K extends RegisteredRunEventType> =
  K extends RegisteredRunEventType
    ? {
        type: K;
        category: DefinitionFor<K>["category"];
        visibility?: DefinitionFor<K>["allowedVisibilities"][number];
        payload: RunEventMap[K];
        schemaVersion?: 1;
      }
    : never;

export type RegisteredRunEventInput = {
  [K in RegisteredRunEventType]: RegisteredRunEventInputFor<K>;
}[RegisteredRunEventType];

export type RegisteredRunEventTypeForCategory<TCategory extends EventCategory> =
  Extract<RegisteredRunEventInput, { category: TCategory }>["type"];

export interface RunEvent<TPayload extends JsonValue = JsonValue> {
  id: string;
  threadId: string;
  runId: string;
  seq: number;
  type: string;
  category: EventCategory;
  visibility: EventVisibility;
  createdAt: string;
  payload: TPayload;
  schemaVersion?: number;
}

export interface VersionedRunEvent<
  TType extends RegisteredRunEventType = RegisteredRunEventType,
> extends RunEvent<RunEventMap[TType]> {
  type: TType;
  schemaVersion: 1;
}
