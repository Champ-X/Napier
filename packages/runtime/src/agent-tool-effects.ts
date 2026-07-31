export function builtInToolEffect(
  toolName: string,
  args?: unknown,
): "read" | "write" | undefined {
  if (toolName === "research_source") {
    return "read";
  }
  if (toolName === "browser") {
    return record(args) &&
      (args["action"] === "snapshot" || args["action"] === "screenshot")
      ? "read"
      : "write";
  }
  if (toolName === "javascript_kernel" || toolName === "python_kernel") {
    return "write";
  }
  if (toolName === "node_debugger") {
    return record(args) &&
      (args["action"] === "stack_trace" ||
        args["action"] === "scopes" ||
        args["action"] === "variables" ||
        args["action"] === "evaluate")
      ? "read"
      : "write";
  }
  if (toolName === "workspace_process") {
    return record(args) && args["action"] === "poll" ? "read" : "write";
  }
  if (
    toolName === "list_files" ||
    toolName === "read_file" ||
    toolName === "search_files" ||
    toolName === "list_symbols" ||
    toolName === "inspect_data" ||
    toolName === "sqlite_query" ||
    toolName === "inspect_code" ||
    toolName === "read_symbol" ||
    toolName === "ast_query" ||
    toolName === "ast_edit_preview" ||
    toolName === "lsp_diagnostics" ||
    toolName === "lsp_symbols" ||
    toolName === "lsp_definition" ||
    toolName === "lsp_references" ||
    toolName === "lsp_rename" ||
    toolName === "lsp_code_actions" ||
    toolName === "workspace_file_preview" ||
    toolName === "run_command" ||
    toolName === "verify_workspace" ||
    toolName === "web_fetch" ||
    toolName === "web_search"
  ) {
    return "read";
  }
  if (
    toolName === "apply_patch" ||
    toolName === "workspace_file_apply" ||
    toolName === "bash" ||
    toolName === "create_plan" ||
    toolName === "update_plan_step" ||
    toolName === "update_plan_artifact" ||
    toolName === "delegate_task"
  ) {
    return "write";
  }
  return undefined;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
