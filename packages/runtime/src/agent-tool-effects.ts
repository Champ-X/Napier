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
  "git_inspect",
  "git_stage_preview",
  "git_commit_preview",
  "git_branch_create_preview",
  "git_review_preview",
  "run_command",
  "verify_workspace",
  "web_fetch",
  "web_search",
]);
const WRITE_TOOLS = new Set([
  "apply_patch",
  "lsp_rename_apply",
  "lsp_code_action_apply",
  "workspace_file_apply",
  "git_stage_apply",
  "git_commit_apply",
  "git_branch_create_apply",
  "git_branch_switch_preview",
  "git_branch_switch_apply",
  "git_review_apply",
  "bash",
  "create_plan",
  "update_plan_step",
  "update_plan_artifact",
  "delegate_task",
  "subagent_worktree_apply",
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
      [
        "start",
        "navigate",
        "back",
        "wait",
        "snapshot",
        "screenshot",
        "close",
      ].includes(String(args["action"]))
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
  if (WRITE_TOOLS.has(toolName)) {
    return "write";
  }
  return undefined;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
