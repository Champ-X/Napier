import type {
  Api,
  Context,
  Model,
  SimpleStreamOptions,
  Tool,
} from "@earendil-works/pi-ai";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  resolveModelHarnessResolution,
  type ModelHarnessResolution,
  type ModelHarnessTaskPhase,
} from "./model-harness-resolution.js";
import type { ModelHarnessResolutionReceipt } from "./model-harness-receipt.js";
export { parseModelHarnessResolutionReceipt } from "./model-harness-receipt.js";
export type {
  ModelHarnessIntent,
  ModelHarnessResolutionReceipt,
} from "./model-harness-receipt.js";
export {
  formatModelHarnessPrompt,
  resolveModelHarnessProfile,
  resolveModelHarnessResolution,
} from "./model-harness-resolution.js";
export type {
  ModelHarnessEnvironmentCapability,
  ModelHarnessFamily,
  ModelHarnessProfile,
  ModelHarnessResolution,
  ModelHarnessRule,
  ModelHarnessTaskPhase,
} from "./model-harness-resolution.js";

export interface PreparedModelHarnessCall {
  context: Context;
  options: SimpleStreamOptions;
  receipt: ModelHarnessResolutionReceipt;
}

const CONTROL_TOOLS = [
  "request_operator_decision",
  "create_plan",
  "update_plan_step",
  "replan_plan",
  "update_plan_artifact",
  "record_run_milestone",
  "skill_load",
  "skill_resource",
  "mcp_schema_search",
  "delegate_task",
  "candidate_file",
  "subagent_worktree_apply",
];
const TOOL_PRIORITY: Record<ModelHarnessTaskPhase, readonly string[]> = {
  coding: [
    "list_files",
    "read_file",
    "search_files",
    "inspect_code",
    "read_symbol",
    "list_symbols",
    "apply_patch",
    "verify_workspace",
    "run_command",
    "lsp_diagnostics",
    "lsp_symbols",
    "lsp_definition",
    "lsp_references",
    "ast_query",
    "ast_edit_preview",
    "lsp_rename",
    "lsp_rename_apply",
    "lsp_code_actions",
    "lsp_code_action_apply",
    "workspace_file_preview",
    "workspace_file_apply",
    "workspace_process",
    "node_debugger",
    "git_inspect",
    "git_stage_preview",
    "git_stage_apply",
    "git_review_preview",
    "git_review_apply",
    "git_commit_preview",
    "git_commit_apply",
    "git_branch_create_preview",
    "git_branch_create_apply",
    "git_branch_switch_preview",
    "git_branch_switch_apply",
  ],
  research: [
    "web_search",
    "web_fetch",
    "browser",
    "research_source",
    "web_fetch_save",
    "read_file",
    "search_files",
    "inspect_data",
    "data_frame",
  ],
  browser: [
    "browser",
    "web_search",
    "web_fetch",
    "research_source",
    "web_fetch_save",
  ],
  data: [
    "inspect_data",
    "data_frame",
    "sqlite_query",
    "read_file",
    "search_files",
    "python_kernel",
    "javascript_kernel",
    "verify_workspace",
  ],
  general: [
    "list_files",
    "read_file",
    "search_files",
    "inspect_code",
    "inspect_data",
    "web_search",
    "web_fetch",
    "browser",
    "apply_patch",
    "verify_workspace",
    "run_command",
  ],
};
const PHASE_REQUIRED_TOOLS: Record<ModelHarnessTaskPhase, readonly string[]> = {
  browser: ["browser"],
  research: ["web_search", "web_fetch"],
  data: ["inspect_data"],
  coding: ["read_file", "apply_patch", "verify_workspace"],
  general: ["read_file"],
};

export function prepareModelHarnessCall(input: {
  model: Model<Api>;
  context: Context;
  options: SimpleStreamOptions;
  attempt: number;
}): PreparedModelHarnessCall {
  const configuredTools = input.context.tools ?? [];
  const initialResolution = resolveModelHarnessResolution({
    model: input.model,
    messages: input.context.messages,
    tools: configuredTools,
  });
  const tools = selectTools(
    configuredTools,
    initialResolution,
    input.context.messages,
  );
  const resolution = resolveModelHarnessResolution({
    model: input.model,
    messages: input.context.messages,
    tools: tools.active,
  });
  const maxRetriesSource: ModelHarnessResolutionReceipt["maxRetriesSource"] =
    input.options.maxRetries === undefined ? "harness" : "caller";
  const maxRetryDelayMsSource: ModelHarnessResolutionReceipt["maxRetryDelayMsSource"] =
    input.options.maxRetryDelayMs === undefined ? "harness" : "caller";
  const maxRetries = input.options.maxRetries ?? resolution.defaultMaxRetries;
  const maxRetryDelayMs =
    input.options.maxRetryDelayMs ?? resolution.defaultMaxRetryDelayMs;
  const configuredBytes = toolDefinitionBytes(configuredTools);
  const activeBytes = toolDefinitionBytes(tools.active);
  const content = {
    kind: "napier.model-harness-resolution" as const,
    schemaVersion: 2 as const,
    harnessId: resolution.resolutionId,
    baseHarnessId: resolution.id,
    ruleSetVersion: resolution.ruleSetVersion,
    matchedRuleId: resolution.matchedRuleId,
    policySource: resolution.policySource,
    family: resolution.family,
    promptDialect: resolution.promptDialect,
    provider: input.model.provider,
    model: input.model.id,
    modelApi: input.model.api,
    attempt: input.attempt,
    intents: [resolution.taskPhase],
    taskPhase: resolution.taskPhase,
    environmentCapabilities: resolution.environmentCapabilities,
    guidanceSha256: sha256(resolution.guidance),
    toolSurface:
      tools.omitted.length > 0 ? ("focused" as const) : ("full" as const),
    configuredToolCount: configuredTools.length,
    activeToolCount: tools.active.length,
    activeToolNames: tools.active.map((tool) => tool.name),
    omittedToolNames: tools.omitted.map((tool) => tool.name),
    configuredToolDefinitionBytes: configuredBytes,
    activeToolDefinitionBytes: activeBytes,
    savedToolDefinitionBytes: configuredBytes - activeBytes,
    maxRetries,
    maxRetriesSource,
    maxRetryDelayMs,
    maxRetryDelayMsSource,
  };
  const receipt = {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
  return {
    context: {
      ...input.context,
      tools: tools.active,
    },
    options: { ...input.options, maxRetries, maxRetryDelayMs },
    receipt,
  };
}

function selectTools(
  tools: Tool[],
  resolution: ModelHarnessResolution,
  messages: Context["messages"],
): { active: Tool[]; omitted: Tool[] } {
  const names = tools.map((tool) => tool.name);
  if (new Set(names).size !== names.length) {
    throw new Error("Model Harness tool definitions contain duplicate names");
  }
  if (tools.length <= resolution.maxActiveTools)
    return { active: tools, omitted: [] };
  const available = new Set(tools.map((tool) => tool.name));
  const protectedNames = unique([
    ...CONTROL_TOOLS,
    ...names.filter((name) => name.startsWith("mcp__")).sort(),
    ...usedToolNames(messages),
    ...PHASE_REQUIRED_TOOLS[resolution.taskPhase],
  ]).filter((name) => available.has(name));
  if (protectedNames.length > resolution.maxActiveTools) {
    throw new Error(
      `Model Harness protected tools exceed the active-tool limit: ${protectedNames.length}/${resolution.maxActiveTools}`,
    );
  }
  const ranked = unique([
    ...protectedNames,
    ...TOOL_PRIORITY[resolution.taskPhase],
    ...TOOL_PRIORITY.general,
    ...names.slice().sort((left, right) => left.localeCompare(right)),
  ])
    .filter((name) => available.has(name))
    .slice(0, resolution.maxActiveTools);
  const selected = new Set(ranked);
  return {
    active: tools.filter((tool) => selected.has(tool.name)),
    omitted: tools.filter((tool) => !selected.has(tool.name)),
  };
}

function usedToolNames(messages: Context["messages"]): string[] {
  return unique(
    messages.flatMap((message) => {
      if (message.role === "toolResult") return [message.toolName];
      if (message.role !== "assistant") return [];
      return message.content
        .filter((item) => item.type === "toolCall")
        .map((item) => item.name);
    }),
  );
}

function toolDefinitionBytes(tools: Tool[]): number {
  return Buffer.byteLength(
    JSON.stringify(
      tools.map(({ name, description, parameters }) => ({
        name,
        description,
        parameters,
      })),
    ),
  );
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
