import type {
  Api,
  Context,
  Message,
  Model,
  SimpleStreamOptions,
  Tool,
} from "@earendil-works/pi-ai";

import { canonicalJson, sha256 } from "./ed25519.js";

export type ModelHarnessFamily = "anthropic" | "openai" | "google" | "generic";
export type ModelHarnessIntent =
  | "browser"
  | "coding"
  | "data"
  | "research"
  | "general";

export interface ModelHarnessProfile {
  id: `napier.model-harness.${ModelHarnessFamily}.v1`;
  family: ModelHarnessFamily;
  promptDialect: "xml-guided" | "instruction-led" | "compact";
  maxActiveTools: number;
  defaultMaxRetries: number;
  defaultMaxRetryDelayMs: number;
}

export interface ModelHarnessResolutionReceipt {
  kind: "napier.model-harness-resolution";
  schemaVersion: 1;
  harnessId: ModelHarnessProfile["id"];
  family: ModelHarnessFamily;
  promptDialect: ModelHarnessProfile["promptDialect"];
  provider: string;
  model: string;
  modelApi: string;
  attempt: number;
  intents: ModelHarnessIntent[];
  toolSurface: "full" | "focused";
  configuredToolCount: number;
  activeToolCount: number;
  activeToolNames: string[];
  omittedToolNames: string[];
  configuredToolDefinitionBytes: number;
  activeToolDefinitionBytes: number;
  savedToolDefinitionBytes: number;
  maxRetries: number;
  maxRetriesSource: "caller" | "harness";
  maxRetryDelayMs: number;
  maxRetryDelayMsSource: "caller" | "harness";
  contentSha256: string;
}

export interface PreparedModelHarnessCall {
  context: Context;
  options: SimpleStreamOptions;
  receipt: ModelHarnessResolutionReceipt;
}

const OPENAI_APIS = new Set([
  "openai-completions",
  "openai-responses",
  "azure-openai-responses",
  "openai-codex-responses",
]);
const GOOGLE_APIS = new Set(["google-generative-ai", "google-vertex"]);
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
const TOOL_PRIORITY: Record<ModelHarnessIntent, readonly string[]> = {
  coding: [
    "list_files", "read_file", "search_files", "inspect_code", "read_symbol",
    "list_symbols", "apply_patch", "verify_workspace", "run_command",
    "lsp_diagnostics", "lsp_symbols", "lsp_definition", "lsp_references",
    "ast_query", "ast_edit_preview", "lsp_rename", "lsp_rename_apply",
    "lsp_code_actions", "lsp_code_action_apply", "workspace_file_preview",
    "workspace_file_apply", "workspace_process", "node_debugger", "git_inspect",
    "git_stage_preview", "git_stage_apply", "git_review_preview", "git_review_apply",
    "git_commit_preview", "git_commit_apply", "git_branch_create_preview",
    "git_branch_create_apply", "git_branch_switch_preview", "git_branch_switch_apply",
  ],
  research: [
    "web_search", "web_fetch", "browser", "research_source", "web_fetch_save",
    "read_file", "search_files", "inspect_data", "data_frame",
  ],
  browser: [
    "browser", "web_search", "web_fetch", "research_source", "web_fetch_save",
  ],
  data: [
    "inspect_data", "data_frame", "sqlite_query", "read_file", "search_files",
    "python_kernel", "javascript_kernel", "verify_workspace",
  ],
  general: [
    "list_files", "read_file", "search_files", "inspect_code", "inspect_data",
    "web_search", "web_fetch", "browser", "apply_patch", "verify_workspace",
    "run_command",
  ],
};
const INTENT_PATTERNS: Array<[ModelHarnessIntent, RegExp]> = [
  ["browser", /\b(browser|click|form|navigate|page|site|website)\b|浏览器|点击|表单|页面|网站/iu],
  ["research", /\b(citation|latest|research|search|source|web)\b|引用|最新|调研|搜索|来源/iu],
  ["data", /\b(csv|data|dataset|dataframe|spreadsheet|sql|sqlite)\b|数据|表格|统计|分析/iu],
  ["coding", /\b(build|bug|code|file|fix|implement|refactor|repo|test)\b|代码|构建|仓库|实现|文件|测试|修复|重构/iu],
];

export function resolveModelHarnessProfile(
  model: Pick<Model<Api>, "api">,
): ModelHarnessProfile {
  const family = model.api === "anthropic-messages"
    ? "anthropic"
    : OPENAI_APIS.has(model.api)
      ? "openai"
      : GOOGLE_APIS.has(model.api)
        ? "google"
        : "generic";
  const settings = family === "anthropic"
    ? { promptDialect: "xml-guided" as const, maxActiveTools: 32, defaultMaxRetries: 2 }
    : family === "openai"
      ? { promptDialect: "instruction-led" as const, maxActiveTools: 28, defaultMaxRetries: 2 }
      : family === "google"
        ? { promptDialect: "instruction-led" as const, maxActiveTools: 24, defaultMaxRetries: 2 }
        : { promptDialect: "compact" as const, maxActiveTools: 20, defaultMaxRetries: 1 };
  return {
    id: `napier.model-harness.${family}.v1`,
    family,
    ...settings,
    defaultMaxRetryDelayMs: 30_000,
  };
}

export function formatModelHarnessPrompt(profile: ModelHarnessProfile): string {
  const guidance = profile.family === "anthropic"
    ? "Keep tool inputs minimal; parallelize only independent reads."
    : profile.family === "generic"
      ? "Use one tool at a time and verify each result before continuing."
      : "Parallelize independent reads; sequence writes and verify after mutation.";
  return [
    `<model_harness id="${profile.id}">`,
    `Provider prompt dialect: ${profile.promptDialect}. Model-visible tool definitions are authoritative for this turn.`,
    guidance,
    "</model_harness>",
  ].join("\n");
}

export function prepareModelHarnessCall(input: {
  model: Model<Api>;
  context: Context;
  options: SimpleStreamOptions;
  attempt: number;
}): PreparedModelHarnessCall {
  const profile = resolveModelHarnessProfile(input.model);
  const intents = inferIntents(input.context.messages);
  const tools = selectTools(input.context.tools ?? [], profile, intents, input.context.messages);
  const maxRetriesSource: ModelHarnessResolutionReceipt["maxRetriesSource"] =
    input.options.maxRetries === undefined ? "harness" : "caller";
  const maxRetryDelayMsSource: ModelHarnessResolutionReceipt["maxRetryDelayMsSource"] =
    input.options.maxRetryDelayMs === undefined ? "harness" : "caller";
  const maxRetries = input.options.maxRetries ?? profile.defaultMaxRetries;
  const maxRetryDelayMs = input.options.maxRetryDelayMs ?? profile.defaultMaxRetryDelayMs;
  const configuredBytes = toolDefinitionBytes(input.context.tools ?? []);
  const activeBytes = toolDefinitionBytes(tools.active);
  const content = {
    kind: "napier.model-harness-resolution" as const,
    schemaVersion: 1 as const,
    harnessId: profile.id,
    family: profile.family,
    promptDialect: profile.promptDialect,
    provider: input.model.provider,
    model: input.model.id,
    modelApi: input.model.api,
    attempt: input.attempt,
    intents,
    toolSurface: tools.omitted.length > 0 ? "focused" as const : "full" as const,
    configuredToolCount: input.context.tools?.length ?? 0,
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
  profile: ModelHarnessProfile,
  intents: ModelHarnessIntent[],
  messages: Message[],
): { active: Tool[]; omitted: Tool[] } {
  if (tools.length <= profile.maxActiveTools) return { active: tools, omitted: [] };
  const available = new Set(tools.map((tool) => tool.name));
  const ranked = unique([
    ...CONTROL_TOOLS,
    ...usedToolNames(messages),
    ...intents.flatMap((intent) => TOOL_PRIORITY[intent]),
    ...TOOL_PRIORITY.general,
    ...tools.map((tool) => tool.name).sort((left, right) => left.localeCompare(right)),
  ]).filter((name) => available.has(name)).slice(0, profile.maxActiveTools);
  const selected = new Set(ranked);
  return {
    active: tools.filter((tool) => selected.has(tool.name)),
    omitted: tools.filter((tool) => !selected.has(tool.name)),
  };
}

function inferIntents(messages: Message[]): ModelHarnessIntent[] {
  const text = messages.filter((message) => message.role === "user")
    .map((message) => typeof message.content === "string"
      ? message.content
      : message.content.filter((item) => item.type === "text").map((item) => item.text).join(" "))
    .join("\n");
  const matched = INTENT_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([intent]) => intent);
  return matched.length > 0 ? matched : ["general"];
}

function usedToolNames(messages: Message[]): string[] {
  return unique(messages.flatMap((message) => {
    if (message.role === "toolResult") return [message.toolName];
    if (message.role !== "assistant") return [];
    return message.content.filter((item) => item.type === "toolCall").map((item) => item.name);
  }));
}

function toolDefinitionBytes(tools: Tool[]): number {
  return Buffer.byteLength(JSON.stringify(tools.map(({ name, description, parameters }) => ({ name, description, parameters }))));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
