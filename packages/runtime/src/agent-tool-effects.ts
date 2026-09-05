import type { AgentTool } from "@earendil-works/pi-agent-core";
import type {
  ToolConcurrency,
  ToolRetryPolicyV2,
} from "@napier/contracts/tool-protocol";

import { registerAgentToolMetadataTransfer } from "./agent-tool-metadata.js";
import { CORE_STATELESS_READ_TOOL_NAMES } from "./read-only-tool-names.js";
export { AgentToolDisplayStore } from "./agent-tool-display-store.js";

export type HarnessAction = "read" | "write" | "verify";
export type BuiltInToolSideEffect =
  | "none"
  | "reversible"
  | "irreversible"
  | "unknown";
export type BuiltInToolSideEffectMode = "static" | "input_dependent";

export interface BuiltInToolCompatibilityPolicy {
  sideEffect: BuiltInToolSideEffect;
  sideEffectMode: BuiltInToolSideEffectMode;
  retry: ToolRetryPolicyV2;
  concurrency?: ToolConcurrency;
}

const toolCompatibilityPolicies = new WeakMap<
  object,
  BuiltInToolCompatibilityPolicy
>();

registerAgentToolMetadataTransfer((source, target) => {
  const policy = toolCompatibilityPolicies.get(source);
  if (!policy) return;
  const existing = toolCompatibilityPolicies.get(target);
  if (existing && existing !== policy) {
    throw new Error(
      "Agent tool compatibility metadata conflicts with its source",
    );
  }
  toolCompatibilityPolicies.set(target, policy);
});

/** Binds reviewed host metadata to a dynamically-created legacy AgentTool. */
export function bindAgentToolCompatibilityPolicy<T extends object>(
  tool: T,
  policy: BuiltInToolCompatibilityPolicy,
): T {
  toolCompatibilityPolicies.set(tool, freezeCompatibilityPolicy(policy));
  return tool;
}

/** True only when host code bound compatibility semantics to this instance. */
export function hasBoundAgentToolCompatibilityPolicy(tool: object): boolean {
  return toolCompatibilityPolicies.has(tool);
}

export function agentToolCompatibilityPolicy(
  tool: AgentTool,
): BuiltInToolCompatibilityPolicy {
  return toolCompatibilityPolicies.get(tool) ?? UNKNOWN_COMPATIBILITY_POLICY;
}

/** Host-only bridge for reviewed built-ins which still use the v1 adapter. */
export function bindBuiltInToolCompatibilityPolicy<T extends AgentTool>(
  tool: T,
): T {
  return bindAgentToolCompatibilityPolicy(
    tool,
    builtInToolCompatibilityPolicy(tool.name),
  );
}

/** Historical adapter reconstruction for an already host-attested native tool. */
export function trustedAgentToolCompatibilityPolicy(
  tool: AgentTool,
): BuiltInToolCompatibilityPolicy {
  return (
    toolCompatibilityPolicies.get(tool) ??
    builtInToolCompatibilityPolicy(tool.name)
  );
}

type ToolEffect = "read" | "write";

interface BuiltInToolCompatibilityDeclaration {
  readonly effect: ToolEffect | ((args: unknown) => ToolEffect);
  readonly sideEffectMode?: "input_dependent";
  readonly reversible?: boolean;
  readonly concurrency?: "exclusive";
  readonly harnessAction?: HarnessAction;
}

const READ: BuiltInToolCompatibilityDeclaration = Object.freeze({
  effect: "read",
});
const VERIFY: BuiltInToolCompatibilityDeclaration = Object.freeze({
  effect: "read",
  harnessAction: "verify",
});
const WRITE: BuiltInToolCompatibilityDeclaration = Object.freeze({
  effect: "write",
});
const REVERSIBLE_WRITE: BuiltInToolCompatibilityDeclaration = Object.freeze({
  effect: "write",
  reversible: true,
});
const COMPATIBILITY_RETRY_ATTEMPTS = 2;
const UNKNOWN_COMPATIBILITY_POLICY = Object.freeze({
  sideEffect: "unknown" as const,
  sideEffectMode: "static" as const,
  retry: Object.freeze({
    strategy: "not_started" as const,
    maxAttempts: COMPATIBILITY_RETRY_ATTEMPTS,
  }),
});

/**
 * Single compatibility declaration source for legacy AgentTool instances.
 *
 * Native Tool Protocol definitions remain authoritative when present. This
 * table exists only for v1 tools which cannot carry protocol metadata, and it
 * deliberately owns every name-based compatibility decision in one place.
 */
const TOOL_COMPATIBILITY_DECLARATIONS = new Map<
  string,
  BuiltInToolCompatibilityDeclaration
>([
  ...CORE_STATELESS_READ_TOOL_NAMES.map((name) => [name, READ] as const),
  ...[
    "capability",
    "lsp_symbols",
    "lsp_definition",
    "lsp_references",
    "lsp_rename",
    "lsp_code_actions",
    "workspace_file_preview",
    "git_inspect",
    "git_stage_preview",
    "git_commit_preview",
    "git_branch_create_preview",
    "run_command",
    "web_fetch",
    "web_search",
    "research_source",
    "subagent_inspect",
    "subagent_collect",
  ].map((name) => [name, READ] as const),
  ...["lsp_diagnostics", "verify_workspace", "git_review_preview"].map(
    (name) => [name, VERIFY] as const,
  ),
  ...[
    "bash",
    "create_plan",
    "update_plan_step",
    "update_plan_artifact",
    "delegate_task",
    "subagent_start",
    "subagent_send",
    "subagent_cancel",
    "subagent_worktree_apply",
    "git_stage_apply",
    "git_commit_apply",
    "git_branch_create_apply",
    "git_branch_switch_preview",
    "git_branch_switch_apply",
    "git_review_apply",
    "javascript_kernel",
    "python_kernel",
  ].map((name) => [name, WRITE] as const),
  ...[
    "apply_patch",
    "web_fetch_save",
    "lsp_rename_apply",
    "lsp_code_action_apply",
  ].map((name) => [name, REVERSIBLE_WRITE] as const),
  [
    "workspace_file_apply",
    Object.freeze({
      ...REVERSIBLE_WRITE,
      concurrency: "exclusive" as const,
    }),
  ],
  ["browser", inputDependent(browserEffect)],
  ["node_debugger", inputDependent(nodeDebuggerEffect)],
  ["workspace_process", inputDependent(workspaceProcessEffect)],
]);

export function builtInToolHarnessAction(
  toolName: string,
  args?: unknown,
): HarnessAction | undefined {
  const declaration = TOOL_COMPATIBILITY_DECLARATIONS.get(toolName);
  return declaration?.harnessAction ?? resolveEffect(declaration, args);
}

export function builtInToolHarnessProjection(
  toolName: string,
  args?: unknown,
): { effect: "read" | "write"; harnessAction: HarnessAction } | object {
  const harnessAction = builtInToolHarnessAction(toolName, args);
  const effect = builtInToolEffect(toolName, args);
  return harnessAction && effect ? { effect, harnessAction } : {};
}

export function builtInToolEffect(
  toolName: string,
  args?: unknown,
): "read" | "write" | undefined {
  return resolveEffect(TOOL_COMPATIBILITY_DECLARATIONS.get(toolName), args);
}

export function builtInToolCompatibilityPolicy(
  toolName: string,
  args?: unknown,
): BuiltInToolCompatibilityPolicy {
  const declaration = TOOL_COMPATIBILITY_DECLARATIONS.get(toolName);
  const effect = resolveEffect(declaration, args);
  const sideEffectMode = declaration?.sideEffectMode ?? "static";
  const sideEffect =
    effect === "read"
      ? "none"
      : effect === "write" && declaration?.reversible
        ? "reversible"
        : "unknown";
  return Object.freeze({
    sideEffect,
    sideEffectMode,
    retry:
      sideEffect === "none" && sideEffectMode === "static"
        ? {
            strategy: "terminal_failure" as const,
            maxAttempts: COMPATIBILITY_RETRY_ATTEMPTS,
          }
        : {
            strategy: "not_started" as const,
            maxAttempts: COMPATIBILITY_RETRY_ATTEMPTS,
          },
    ...(declaration?.concurrency
      ? { concurrency: declaration.concurrency }
      : {}),
  });
}

function freezeCompatibilityPolicy(
  policy: BuiltInToolCompatibilityPolicy,
): BuiltInToolCompatibilityPolicy {
  return Object.freeze({
    ...policy,
    retry: Object.freeze({ ...policy.retry }),
  });
}

function inputDependent(
  effect: (args: unknown) => ToolEffect,
): BuiltInToolCompatibilityDeclaration {
  return Object.freeze({ effect, sideEffectMode: "input_dependent" });
}

function resolveEffect(
  declaration: BuiltInToolCompatibilityDeclaration | undefined,
  args: unknown,
): ToolEffect | undefined {
  if (!declaration) return undefined;
  return typeof declaration.effect === "function"
    ? declaration.effect(args)
    : declaration.effect;
}

function browserEffect(args: unknown): ToolEffect {
  return record(args) &&
    [
      "start",
      "preview_workspace",
      "navigate",
      "back",
      "forward",
      "tab_new",
      "tab_list",
      "tab_switch",
      "tab_close",
      "wait",
      "find",
      "scroll",
      "snapshot",
      "screenshot",
      "console",
      "close",
    ].includes(String(args["action"]))
    ? "read"
    : "write";
}

function nodeDebuggerEffect(args: unknown): ToolEffect {
  return record(args) &&
    (args["action"] === "stack_trace" ||
      args["action"] === "scopes" ||
      args["action"] === "variables" ||
      args["action"] === "evaluate")
    ? "read"
    : "write";
}

function workspaceProcessEffect(args: unknown): ToolEffect {
  return record(args) &&
    (args["action"] === "poll" || args["action"] === "preview_write")
    ? "read"
    : "write";
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
