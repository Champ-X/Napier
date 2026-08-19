export const WORKSPACE_STATELESS_READ_TOOL_NAMES = [
  "list_files",
  "read_file",
  "search_files",
  "list_symbols",
  "inspect_data",
  "data_frame",
  "sqlite_query",
  "inspect_code",
  "read_symbol",
] as const;

export const CORE_STATELESS_READ_TOOL_NAMES = [
  ...WORKSPACE_STATELESS_READ_TOOL_NAMES,
  "ast_query",
  "ast_edit_preview",
  "skill_load",
  "skill_resource",
] as const;

export const ENVIRONMENT_DEGRADED_READ_TOOL_NAMES = [
  ...CORE_STATELESS_READ_TOOL_NAMES,
  "web_search",
  "web_fetch",
  "browser",
  "research_source",
] as const;

export const DEFAULT_AGENT_ENABLED_TOOLS = [
  ...WORKSPACE_STATELESS_READ_TOOL_NAMES,
  "web_search",
  "web_fetch",
  "browser",
  "research_source",
  "git_inspect",
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
  "apply_patch",
  "verify_workspace",
] as const;
