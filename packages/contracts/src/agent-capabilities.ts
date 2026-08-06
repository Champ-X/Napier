import type { AgentToolName } from "./agent-tool-names.js";
import type { SubagentRole, ToolPolicyMode } from "./execution-core.js";
import type { AgentProfile } from "./execution-runs.js";

export const AGENT_CAPABILITY_PRESET_IDS = [
  "coding",
  "research",
  "data",
  "browser",
  "safe_automation",
] as const;

export type AgentCapabilityPresetId =
  (typeof AGENT_CAPABILITY_PRESET_IDS)[number];

export interface AgentCapabilityPreset {
  id: AgentCapabilityPresetId;
  label: string;
  summary: string;
  toolPolicy: ToolPolicyMode;
  enabledTools: AgentToolName[];
  enabledSkills: string[];
  enabledSubagents: SubagentRole[];
}

export interface AgentCapabilityStatus {
  presetId: AgentCapabilityPresetId | "custom";
  label: string;
  policyLabel: string;
  toolPolicy: ToolPolicyMode;
  enabledToolCount: number;
  blockedEnabledToolCount: number;
  networkRead: boolean;
  browserRead: boolean;
  browserInteract: boolean;
  browserInteractWithConfirmation: boolean;
  workspaceRead: boolean;
  workspaceWrite: boolean;
  processExecution: boolean;
  codingIntelligence: boolean;
  dataAnalysis: boolean;
}

const WORKSPACE_READ_TOOLS: AgentToolName[] = [
  "list_files",
  "read_file",
  "search_files",
  "list_symbols",
  "inspect_data",
  "inspect_code",
  "read_symbol",
  "git_inspect",
];
const DATA_TOOLS: AgentToolName[] = ["data_frame", "sqlite_query"];
const RESEARCH_TOOLS: AgentToolName[] = [
  "web_search",
  "web_fetch",
  "browser",
  "research_source",
];
const RESEARCH_WRITE_TOOLS: AgentToolName[] = ["web_fetch_save"];
const CODE_INTELLIGENCE_TOOLS: AgentToolName[] = [
  "ast_query",
  "ast_edit_preview",
  "lsp_diagnostics",
  "lsp_symbols",
  "lsp_definition",
  "lsp_references",
  "lsp_rename",
  "lsp_code_actions",
];
const CODE_WRITE_TOOLS: AgentToolName[] = [
  "apply_patch",
  "lsp_rename_apply",
  "lsp_code_action_apply",
  "workspace_file_preview",
  "workspace_file_apply",
  "git_stage_preview",
  "git_stage_apply",
  "git_commit_preview",
  "git_commit_apply",
  "git_branch_create_preview",
  "git_branch_create_apply",
  "git_branch_switch_preview",
  "git_branch_switch_apply",
  "git_review_preview",
  "git_review_apply",
  "verify_workspace",
];
const PROCESS_TOOLS: AgentToolName[] = [
  "run_command",
  "javascript_kernel",
  "python_kernel",
  "node_debugger",
  "workspace_process",
];
const WRITE_TOOLS = new Set<AgentToolName>([
  "apply_patch",
  "web_fetch_save",
  "lsp_rename_apply",
  "lsp_code_action_apply",
  "workspace_file_apply",
  "git_stage_apply",
  "git_commit_apply",
  "git_branch_create_apply",
  "git_branch_switch_preview",
  "git_branch_switch_apply",
  "git_review_apply",
  ...PROCESS_TOOLS,
]);

export const AGENT_CAPABILITY_PRESETS: readonly AgentCapabilityPreset[] = [
  preset(
    "coding",
    "Coding",
    "Read, edit, diagnose, test, and commit workspace code through preview-bound tools.",
    "workspace",
    [
      ...WORKSPACE_READ_TOOLS,
      ...DATA_TOOLS,
      ...CODE_INTELLIGENCE_TOOLS,
      ...CODE_WRITE_TOOLS,
      ...PROCESS_TOOLS,
    ],
    ["software-delivery"],
    ["coder", "reviewer", "general"],
  ),
  preset(
    "research",
    "Research",
    "Search, fetch, render, capture, and cite public sources without workspace writes.",
    "observe",
    [...WORKSPACE_READ_TOOLS, ...DATA_TOOLS, ...RESEARCH_TOOLS],
    ["research-brief", "data-analysis"],
    ["researcher", "reviewer", "general"],
  ),
  preset(
    "data",
    "Data",
    "Inspect and transform local tabular or SQLite data without changing workspace files.",
    "observe",
    [...WORKSPACE_READ_TOOLS, ...DATA_TOOLS],
    ["data-analysis"],
    ["reviewer", "general"],
  ),
  preset(
    "browser",
    "Browser",
    "Read dynamic public pages and capture citations; form interaction remains blocked.",
    "observe",
    [...RESEARCH_TOOLS],
    ["research-brief"],
    ["researcher", "reviewer"],
  ),
  preset(
    "safe_automation",
    "Safe Automation",
    "Combine public research with preview-bound workspace changes and sandboxed execution.",
    "workspace",
    [
      ...WORKSPACE_READ_TOOLS,
      ...DATA_TOOLS,
      ...RESEARCH_TOOLS,
      ...RESEARCH_WRITE_TOOLS,
      ...CODE_INTELLIGENCE_TOOLS,
      ...CODE_WRITE_TOOLS,
      ...PROCESS_TOOLS,
    ],
    ["research-brief", "data-analysis", "software-delivery", "artifact-studio"],
    ["researcher", "reviewer", "general", "coder"],
  ),
];

export function agentCapabilityPreset(
  id: AgentCapabilityPresetId,
): AgentCapabilityPreset {
  const value = AGENT_CAPABILITY_PRESETS.find((preset) => preset.id === id);
  if (!value) throw new Error(`Unknown Agent capability preset: ${id}`);
  return structuredClone(value);
}

export function agentCapabilityPresetUpdate(
  id: AgentCapabilityPresetId,
): Pick<
  AgentProfile,
  "toolPolicy" | "enabledTools" | "enabledSkills" | "enabledSubagents"
> {
  const value = agentCapabilityPreset(id);
  return {
    toolPolicy: value.toolPolicy,
    enabledTools: [...value.enabledTools],
    enabledSkills: [...value.enabledSkills],
    enabledSubagents: [...value.enabledSubagents],
  };
}

export function agentCapabilityStatus(
  profile: Pick<
    AgentProfile,
    "toolPolicy" | "enabledTools" | "enabledSkills" | "enabledSubagents"
  >,
): AgentCapabilityStatus {
  const tools = new Set(
    profile.enabledTools.filter((tool): tool is AgentToolName =>
      isAgentToolName(tool),
    ),
  );
  const matched = AGENT_CAPABILITY_PRESETS.find(
    (preset) =>
      preset.toolPolicy === profile.toolPolicy &&
      sameSet(preset.enabledTools, profile.enabledTools) &&
      sameSet(preset.enabledSkills, profile.enabledSkills) &&
      sameSet(preset.enabledSubagents, profile.enabledSubagents ?? []),
  );
  const blockedEnabledToolCount =
    profile.toolPolicy === "observe"
      ? [...tools].filter((tool) => WRITE_TOOLS.has(tool)).length
      : 0;
  return {
    presetId: matched?.id ?? "custom",
    label: matched?.label ?? "Custom",
    policyLabel: policyLabel(profile.toolPolicy),
    toolPolicy: profile.toolPolicy,
    enabledToolCount: tools.size,
    blockedEnabledToolCount,
    networkRead: tools.has("web_search") || tools.has("web_fetch"),
    browserRead: tools.has("browser"),
    browserInteract: false,
    browserInteractWithConfirmation:
      tools.has("browser") && profile.toolPolicy !== "observe",
    workspaceRead: [...tools].some((tool) =>
      WORKSPACE_READ_TOOLS.includes(tool),
    ),
    workspaceWrite:
      profile.toolPolicy !== "observe" &&
      [...tools].some((tool) => WRITE_TOOLS.has(tool)),
    processExecution:
      profile.toolPolicy !== "observe" &&
      PROCESS_TOOLS.some((tool) => tools.has(tool)),
    codingIntelligence: CODE_INTELLIGENCE_TOOLS.some((tool) => tools.has(tool)),
    dataAnalysis: DATA_TOOLS.some((tool) => tools.has(tool)),
  };
}

function preset(
  id: AgentCapabilityPresetId,
  label: string,
  summary: string,
  toolPolicy: ToolPolicyMode,
  enabledTools: AgentToolName[],
  enabledSkills: string[],
  enabledSubagents: SubagentRole[],
): AgentCapabilityPreset {
  return {
    id,
    label,
    summary,
    toolPolicy,
    enabledTools: unique(enabledTools),
    enabledSkills: unique(enabledSkills),
    enabledSubagents: unique(enabledSubagents),
  };
}

function policyLabel(policy: ToolPolicyMode): string {
  return policy === "observe"
    ? "Read only"
    : policy === "workspace"
      ? "Workspace changes"
      : "External interaction";
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return (
    JSON.stringify([...new Set(left)].sort()) ===
    JSON.stringify([...new Set(right)].sort())
  );
}

function unique<Value extends string>(values: readonly Value[]): Value[] {
  return [...new Set(values)];
}

function isAgentToolName(value: string): value is AgentToolName {
  return [
    ...WORKSPACE_READ_TOOLS,
    ...DATA_TOOLS,
    ...RESEARCH_TOOLS,
    ...CODE_INTELLIGENCE_TOOLS,
    ...CODE_WRITE_TOOLS,
    ...PROCESS_TOOLS,
  ].includes(value as AgentToolName);
}
