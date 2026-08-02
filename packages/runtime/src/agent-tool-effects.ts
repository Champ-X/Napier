import { CORE_STATELESS_READ_TOOL_NAMES } from "./read-only-tool-names.js";

const READ_ONLY_TOOLS = new Set([
  ...CORE_STATELESS_READ_TOOL_NAMES,
  "lsp_diagnostics",
  "lsp_symbols",
  "lsp_definition",
  "lsp_references",
  "lsp_rename",
  "lsp_code_actions",
  "workspace_file_preview",
  "run_command",
  "verify_workspace",
  "web_fetch",
  "web_search",
]);

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
    return record(args) &&
      (args["action"] === "poll" || args["action"] === "preview_write")
      ? "read"
      : "write";
  }
  if (READ_ONLY_TOOLS.has(toolName)) {
    return "read";
  }
  if (
    toolName === "apply_patch" ||
    toolName === "lsp_rename_apply" ||
    toolName === "lsp_code_action_apply" ||
    toolName === "workspace_file_apply" ||
    toolName === "bash" ||
    toolName === "create_plan" ||
    toolName === "update_plan_step" ||
    toolName === "update_plan_artifact" ||
    toolName === "delegate_task" ||
    toolName === "subagent_worktree_apply"
  ) {
    return "write";
  }
  return undefined;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
