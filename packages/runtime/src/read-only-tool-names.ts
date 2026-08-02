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
] as const;

export const DEFAULT_AGENT_ENABLED_TOOLS = [
  ...WORKSPACE_STATELESS_READ_TOOL_NAMES,
  "git_inspect",
  "apply_patch",
  "verify_workspace",
] as const;
