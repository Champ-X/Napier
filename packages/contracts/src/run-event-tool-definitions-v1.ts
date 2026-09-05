type ToolEventCategory = "model" | "tool";
type ToolEventVisibility = "user" | "debug" | "hidden";

function defineEventGroup<
  const TActiveTypes extends readonly string[],
  const TRunAnyTypes extends readonly string[],
  const TTerminalTransitionTypes extends readonly string[],
  const TCategory extends ToolEventCategory,
  const TVisibility extends ToolEventVisibility,
>(definition: {
  activeRunTypes: TActiveTypes;
  runAnyTypes: TRunAnyTypes;
  terminalTransitionTypes: TTerminalTransitionTypes;
  category: TCategory;
  defaultVisibility: TVisibility;
  allowedVisibilities?: readonly ToolEventVisibility[];
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

/** Model and Tool event definitions, including active-Run authority phases. */
export const RUN_EVENT_TOOL_DEFINITION_GROUPS_V1 = [
  defineEventGroup({
    activeRunTypes: [
      "agent.experiment.started",
      "context.compaction.forked",
      "model.experiment.started",
    ],
    runAnyTypes: [
      "agent.experiment.compared",
      "agent.experiment.failed",
      "context.compaction.completed",
      "context.compaction.failed",
      "context.compaction.previewed",
      "model.experiment.compared",
      "model.experiment.failed",
    ],
    terminalTransitionTypes: [],
    category: "model",
    defaultVisibility: "user",
    owner: "model-runtime",
    projectionOwner: "trace-index",
  }),
  defineEventGroup({
    activeRunTypes: [
      "context.compaction.started",
      "context.model_invocation",
      "route_attempt_started",
      "route_plan_created",
    ],
    runAnyTypes: [
      "context.conversation_surface",
      "context.conversation_surface_unavailable",
      "context.delegation.updated",
      "context.milestones.updated",
      "context.model_adapter",
      "context.model_envelope",
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
    ],
    terminalTransitionTypes: [],
    category: "model",
    defaultVisibility: "debug",
    allowedVisibilities: ["debug", "user"],
    owner: "model-runtime",
    projectionOwner: "trace-index",
  }),
  defineEventGroup({
    activeRunTypes: ["model.text.delta", "model.thinking.delta"],
    runAnyTypes: [],
    terminalTransitionTypes: [],
    category: "model",
    defaultVisibility: "hidden",
    owner: "model-stream",
    projectionOwner: "trace-index",
  }),
  defineEventGroup({
    activeRunTypes: [],
    runAnyTypes: [
      "context.research_sources",
      "context.tool_result",
      "context.tool_result_unavailable",
      "context.web_fetch_sources",
    ],
    terminalTransitionTypes: [],
    category: "tool",
    defaultVisibility: "debug",
    owner: "tool-runtime",
    projectionOwner: "trace-index",
  }),
  defineEventGroup({
    activeRunTypes: [
      "context.tool_invocation",
      "context.tool_invocation_unavailable",
    ],
    runAnyTypes: [],
    terminalTransitionTypes: [],
    category: "tool",
    defaultVisibility: "debug",
    owner: "tool-runtime",
    projectionOwner: "trace-index",
  }),
  defineEventGroup({
    activeRunTypes: [
      "browser.interaction_confirmation.approved",
      "browser.interaction_confirmation.pending",
      "browser.session_pause.requested",
      "browser.session_pause.resumed",
      "browser.takeover.requested",
      "workspace.file.mutated",
      "workspace.process.input",
      "workspace.process.rollback_started",
      "workspace.process.resized",
    ],
    runAnyTypes: [
      "browser.interaction_confirmation.cancelled",
      "browser.interaction_confirmation.expired",
      "browser.interaction_confirmation.rejected",
      "browser.session_pause.cancelled",
      "browser.takeover.completed",
      "browser.takeover.failed",
      "tool.blocked",
      "tool.completed",
      "tool.failed",
      "tool.result_reuse.blocked",
      "tool.result_reused",
      "workspace.file.recovered",
      "workspace.process.rolled_back",
    ],
    terminalTransitionTypes: [],
    category: "tool",
    defaultVisibility: "user",
    allowedVisibilities: ["user", "debug"],
    owner: "tool-runtime",
    projectionOwner: "trace-index",
  }),
  defineEventGroup({
    activeRunTypes: ["code_bridge.authorized", "tool.admitted", "tool.started"],
    runAnyTypes: [],
    terminalTransitionTypes: [],
    category: "tool",
    defaultVisibility: "user",
    allowedVisibilities: ["user", "debug"],
    owner: "tool-runtime",
    projectionOwner: "trace-index",
  }),
  defineEventGroup({
    activeRunTypes: [],
    runAnyTypes: [
      "tool.cancellation.settled",
      "tool.deadline.exceeded",
      "tool.effect.journaled",
      "tool.operation.settled",
    ],
    terminalTransitionTypes: [],
    category: "tool",
    defaultVisibility: "debug",
    allowedVisibilities: ["debug", "user"],
    owner: "tool-runtime",
    projectionOwner: "trace-index",
  }),
  defineEventGroup({
    activeRunTypes: [
      "tool.operation.admitted",
      "tool.operation.effect_indeterminate",
      "tool.operation.lease.granted",
      "tool.operation.lease.renewed",
      "tool.operation.proposed",
      "tool.operation.started",
      "tool.retry.started",
    ],
    runAnyTypes: [],
    terminalTransitionTypes: [],
    category: "tool",
    defaultVisibility: "debug",
    allowedVisibilities: ["debug", "user"],
    owner: "tool-runtime",
    projectionOwner: "trace-index",
  }),
  defineEventGroup({
    activeRunTypes: [],
    runAnyTypes: ["tool.experiment.compared"],
    terminalTransitionTypes: [],
    category: "tool",
    defaultVisibility: "user",
    owner: "tool-experiment",
    projectionOwner: "trace-index",
  }),
  defineEventGroup({
    activeRunTypes: ["tool.experiment.started"],
    runAnyTypes: [],
    terminalTransitionTypes: [],
    category: "tool",
    defaultVisibility: "user",
    owner: "tool-experiment",
    projectionOwner: "trace-index",
  }),
] as const;
