import { RUN_EVENT_DOMAIN_DEFINITION_GROUPS_V1 } from "./run-event-domain-definitions-v1.js";
import { RUN_EVENT_TOOL_DEFINITION_GROUPS_V1 } from "./run-event-tool-definitions-v1.js";

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
export type RunEventAdmissionPolicyV1 =
  | "run_active"
  | "run_any"
  | "terminal_transition";

export interface RunEventDefinitionV1 {
  category: EventCategory;
  defaultVisibility: EventVisibility;
  allowedVisibilities: readonly EventVisibility[];
  owner: string;
  projectionOwner: string;
  /** Write-time lifecycle classification; never serialized into the event. */
  admission: RunEventAdmissionPolicyV1;
  schemaVersion: 1;
}

function defineEventGroup<
  const TActiveTypes extends readonly string[],
  const TRunAnyTypes extends readonly string[],
  const TTerminalTransitionTypes extends readonly string[],
  const TCategory extends EventCategory,
  const TVisibility extends EventVisibility,
>(definition: {
  activeRunTypes: TActiveTypes;
  runAnyTypes: TRunAnyTypes;
  terminalTransitionTypes: TTerminalTransitionTypes;
  category: TCategory;
  defaultVisibility: TVisibility;
  allowedVisibilities?: readonly EventVisibility[];
  owner: string;
  projectionOwner: string;
}) {
  return {
    ...definition,
    types: [
      ...definition.activeRunTypes,
      ...definition.runAnyTypes,
      ...definition.terminalTransitionTypes,
    ] as readonly [
      ...TActiveTypes,
      ...TRunAnyTypes,
      ...TTerminalTransitionTypes,
    ],
    allowedVisibilities: definition.allowedVisibilities ?? [
      definition.defaultVisibility,
    ],
    schemaVersion: 1 as const,
  };
}

export const RUN_EVENT_DEFINITION_GROUPS_V1 = [
  defineEventGroup({
    activeRunTypes: [],
    runAnyTypes: ["message.user", "message.assistant"],
    terminalTransitionTypes: [],
    category: "message",
    defaultVisibility: "user",
    allowedVisibilities: ["user", "hidden"],
    owner: "conversation",
    projectionOwner: "conversation-feed",
  }),
  defineEventGroup({
    activeRunTypes: [],
    runAnyTypes: ["run.control.cancelled"],
    terminalTransitionTypes: [],
    category: "message",
    defaultVisibility: "user",
    owner: "run-control",
    projectionOwner: "conversation-feed",
  }),
  defineEventGroup({
    activeRunTypes: ["run.control.queued", "run.control.delivered"],
    runAnyTypes: [],
    terminalTransitionTypes: [],
    category: "message",
    defaultVisibility: "user",
    owner: "run-control",
    projectionOwner: "conversation-feed",
  }),
  defineEventGroup({
    activeRunTypes: [],
    runAnyTypes: ["run.progress.message"],
    terminalTransitionTypes: [],
    category: "message",
    defaultVisibility: "user",
    owner: "run-progress",
    projectionOwner: "conversation-feed",
  }),
  defineEventGroup({
    activeRunTypes: [],
    runAnyTypes: ["turn.completed"],
    terminalTransitionTypes: ["run.completed"],
    category: "lifecycle",
    defaultVisibility: "debug",
    owner: "run-coordinator",
    projectionOwner: "task-summary",
  }),
  defineEventGroup({
    activeRunTypes: ["run.started", "turn.started"],
    runAnyTypes: [],
    terminalTransitionTypes: [],
    category: "lifecycle",
    defaultVisibility: "debug",
    owner: "run-coordinator",
    projectionOwner: "task-summary",
  }),
  defineEventGroup({
    activeRunTypes: ["run.finalization.reserved", "run.recovery.started"],
    runAnyTypes: [
      "branch.created",
      "run.budget.exhausted",
      "run.no_progress",
      "model.stream.watchdog_triggered",
      "model.thinking_loop.finalized",
      "run.recovery.completed",
      "run.recovery.failed",
      "run.research.budget_exhausted",
      "run.settlement.checkpoint",
      "run.settlement.recorded",
      "run.waiting_for_operator",
      "thread.restored",
      "thread.trashed",
      "workspace.process.interrupted",
      "workspace.process.settled",
    ],
    terminalTransitionTypes: [],
    category: "lifecycle",
    defaultVisibility: "user",
    owner: "run-coordinator",
    projectionOwner: "task-summary",
  }),
  defineEventGroup({
    activeRunTypes: ["workspace.process.started"],
    runAnyTypes: [],
    terminalTransitionTypes: [],
    category: "lifecycle",
    defaultVisibility: "user",
    owner: "run-coordinator",
    projectionOwner: "task-summary",
  }),
  defineEventGroup({
    activeRunTypes: [],
    runAnyTypes: [],
    terminalTransitionTypes: ["run.cancelled", "run.failed", "run.interrupted"],
    category: "lifecycle",
    defaultVisibility: "user",
    allowedVisibilities: ["user", "debug"],
    owner: "run-coordinator",
    projectionOwner: "task-summary",
  }),
  defineEventGroup({
    activeRunTypes: ["workspace.process.local_service_lease.granted"],
    runAnyTypes: ["workspace.process.local_service_lease.revoked"],
    terminalTransitionTypes: [],
    category: "lifecycle",
    defaultVisibility: "debug",
    owner: "workspace-process-runtime",
    projectionOwner: "trace-index",
    // A grant publishes future authority; revocation is retrospective audit.
  }),
  defineEventGroup({
    activeRunTypes: [
      "run.progress.convergence_activated",
      "run.progress.convergence_reopened",
      "run.progress.convergence_requested",
      "run.progress.directive.delivered",
      "run.progress.operator_epoch",
      "run.progress.rerouted",
      "run.progress.vector",
    ],
    runAnyTypes: [],
    terminalTransitionTypes: [],
    category: "lifecycle",
    defaultVisibility: "debug",
    allowedVisibilities: ["debug", "hidden"],
    owner: "run-progress",
    projectionOwner: "task-summary",
  }),
  defineEventGroup({
    activeRunTypes: [],
    runAnyTypes: ["run.recovery.prompt"],
    terminalTransitionTypes: [],
    category: "lifecycle",
    defaultVisibility: "hidden",
    owner: "run-recovery",
    projectionOwner: "conversation-feed",
  }),
  defineEventGroup({
    activeRunTypes: [],
    runAnyTypes: ["thread.imported"],
    terminalTransitionTypes: [],
    category: "lifecycle",
    defaultVisibility: "debug",
    owner: "thread-import",
    projectionOwner: "task-summary",
  }),
  ...RUN_EVENT_TOOL_DEFINITION_GROUPS_V1,
  ...RUN_EVENT_DOMAIN_DEFINITION_GROUPS_V1,
] as const;

type RunEventDefinitionGroup = (typeof RUN_EVENT_DEFINITION_GROUPS_V1)[number];

export const RUN_TERMINAL_EVENT_TYPES_V1 = Object.freeze(
  RUN_EVENT_DEFINITION_GROUPS_V1.reduce<
    Array<RunEventDefinitionGroup["terminalTransitionTypes"][number]>
  >((types, group) => {
    types.push(
      ...(group.terminalTransitionTypes as readonly RunEventDefinitionGroup["terminalTransitionTypes"][number][]),
    );
    return types;
  }, []),
);

export type RegisteredRunEventType =
  (typeof RUN_EVENT_DEFINITION_GROUPS_V1)[number]["types"][number];

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

export interface RunProgressMessagePayloadV1 extends JsonObject {
  sourceEventId: string;
  model: string;
  toolNames: string[];
  text?: string;
  contentRedacted?: true;
}

export interface ToolStartedPayloadV1 extends JsonObject {
  callId: string;
  toolName: string;
}

export interface ToolTerminalPayloadV1 extends JsonObject {
  callId: string;
  toolName: string;
}

export type ToolOperationFailureClassV1 =
  | "invalid_input"
  | "unavailable"
  | "unsupported"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "timeout"
  | "network"
  | "session_state"
  | "cancelled"
  | "policy"
  | "resource_limit"
  | "unknown";

export interface ToolOperationFailureV1 extends JsonObject {
  class: ToolOperationFailureClassV1;
  scope:
    | "invocation"
    | "target"
    | "origin"
    | "route"
    | "capability"
    | "session";
  disposition:
    | "correct_input"
    | "alternate_route"
    | "retry_after"
    | "recover_state"
    | "terminal";
  fatalToSession: boolean;
  diagnosticSha256: string;
}

export interface ToolOperationPayloadV1 extends JsonObject {
  kind: "napier.tool-operation";
  schemaVersion: 1;
  parentCallId: string;
  operationId: string;
  role?: "progress" | "execution_authority";
  /** Started executions are never replayable unless explicitly idempotent. */
  startedTakeover?: "never" | "idempotent";
  ordinal: number;
  mode: string;
  route: string;
  operation: string;
  scope: string;
  contribution: string;
  resourceKeySha256: string;
  failureBindings?: import("./tool-protocol.js").ToolFailureBindingsV1;
  failureDomainKeySha256: string;
  descriptorSha256: string;
  phaseStateSha256: string;
  failure?: ToolOperationFailureV1;
  stateSha256?: string;
  effectSha256?: string;
}

export type ToolOperationExecutionLeaseDispositionV1 =
  | "initial"
  | "renewal"
  | "unstarted_takeover"
  | "safe_started_takeover";

export interface ToolOperationExecutionLeaseFieldsV1 extends JsonObject {
  executionLeaseOwnerSha256: string;
  executionLeaseGeneration: number;
  executionLeaseAcquiredAtMs: number;
  executionLeaseExpiresAtMs: number;
  executionLeaseDisposition: ToolOperationExecutionLeaseDispositionV1;
  executionLeasePreviousGeneration?: number;
}

export interface ToolOperationAdmittedPayloadV1 extends ToolOperationPayloadV1 {
  admission: "admitted" | "rejected";
  admissionSource?: "caller" | "failure_circuit";
  circuitKeySha256?: string;
  circuitScope?: ToolOperationFailureV1["scope"];
  circuitStatus?: "open";
  circuitEpoch?: number;
  circuitPolicySha256?: string;
  circuitThroughSeq?: number;
  circuitAsOfMs?: number;
  circuitRetryAfterMs?: number;
  /** Durable exclusive lease for a half-open circuit probe. */
  circuitProbeKeySha256?: string;
  circuitProbeEpoch?: number;
  circuitProbeRecoveryEpoch?: number;
  /** Generation 1 is granted atomically with caller admission. */
  executionLeaseOwnerSha256?: string;
  executionLeaseGeneration?: number;
  executionLeaseAcquiredAtMs?: number;
  executionLeaseExpiresAtMs?: number;
  executionLeaseDisposition?: ToolOperationExecutionLeaseDispositionV1;
  executionLeasePreviousGeneration?: number;
}

export interface ToolOperationExecutionLeasePayloadV1
  extends ToolOperationPayloadV1, ToolOperationExecutionLeaseFieldsV1 {}

export interface ToolOperationExecutionLeaseRenewedPayloadV1 extends ToolOperationExecutionLeasePayloadV1 {
  /**
   * The current generation crossed its final durable fence immediately before
   * entering caller code that may produce externally visible effects.
   */
  executionEffectBoundary?: true;
}

export interface ToolOperationStartedPayloadV1 extends ToolOperationPayloadV1 {
  executionLeaseOwnerSha256: string;
  executionLeaseGeneration: number;
}

export interface ToolOperationSettledPayloadV1 extends ToolOperationPayloadV1 {
  outcome: "succeeded" | "failed" | "skipped";
  effectSha256: string;
  /** Immutable result receipt used to repair an expired started generation. */
  resultEvidenceSha256?: string;
  resultEvidenceEventSeq?: number;
  executionLeaseOwnerSha256?: string;
  executionLeaseGeneration?: number;
}

export interface ToolOperationEffectIndeterminatePayloadV1 extends ToolOperationPayloadV1 {
  disposition: "effect_indeterminate";
  effectBoundaryEventSeq: number;
  executionLeaseOwnerSha256: string;
  executionLeaseGeneration: number;
  recoveryRunLeaseBindingSha256: string;
  recoveryDisposition:
    | "run_lease_expired"
    | "run_owner_unavailable"
    | "run_lease_missing";
  recoveredAtMs: number;
}

interface CoreRunEventMap {
  "message.user": MessageUserPayloadV1;
  "message.assistant": MessageAssistantPayloadV1;
  "run.progress.message": RunProgressMessagePayloadV1;
  "tool.started": ToolStartedPayloadV1;
  "tool.admitted": ToolStartedPayloadV1;
  "tool.completed": ToolTerminalPayloadV1;
  "tool.failed": ToolTerminalPayloadV1;
  "tool.operation.proposed": ToolOperationPayloadV1;
  "tool.operation.admitted": ToolOperationAdmittedPayloadV1;
  "tool.operation.lease.granted": ToolOperationExecutionLeasePayloadV1;
  "tool.operation.lease.renewed": ToolOperationExecutionLeaseRenewedPayloadV1;
  "tool.operation.started": ToolOperationStartedPayloadV1;
  "tool.operation.effect_indeterminate": ToolOperationEffectIndeterminatePayloadV1;
  "tool.operation.settled": ToolOperationSettledPayloadV1;
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
