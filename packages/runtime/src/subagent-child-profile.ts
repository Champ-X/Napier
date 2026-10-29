import type { AgentProfile, SubagentRole } from "@napier/contracts";
import { ENVIRONMENT_DEGRADED_READ_TOOL_NAMES } from "./read-only-tool-names.js";

export const INHERITED_SUBAGENT_TOOL_NAMES: ReadonlySet<string> = new Set([
  ...ENVIRONMENT_DEGRADED_READ_TOOL_NAMES,
  "git_inspect", "workspace_file_preview", "lsp_diagnostics", "lsp_symbols",
  "lsp_definition", "lsp_references", "lsp_rename", "lsp_code_actions",
]);
const CODER_TOOL_NAMES = new Set([
  "apply_patch", "node_debugger", "run_command", "verify_workspace",
  "lsp_rename_apply", "lsp_code_action_apply",
]);

export function projectSubagentToolNames(parentTools: readonly string[], role: SubagentRole): string[] {
  return parentTools.filter((name) => INHERITED_SUBAGENT_TOOL_NAMES.has(name) ||
    (role === "coder" && CODER_TOOL_NAMES.has(name)));
}

/** A configuration projection, never a grant to use parent-owned resources. */
export function deriveSubagentProfile(
  parent: AgentProfile,
  role: SubagentRole,
): AgentProfile {
  if (role === "coder" && (parent.toolPolicy === "observe" ||
      !parent.enabledTools.includes("apply_patch") ||
      !parent.enabledTools.includes("lsp_diagnostics"))) {
    throw new Error("Coder child Run requires the parent's isolated-write prerequisites");
  }
  return {
    ...structuredClone(parent),
    // Read subprocess tools also require the parent's policy; the tool-name
    // projection and child-owned factories impose the role boundary.
    toolPolicy: parent.toolPolicy,
    enabledTools: projectSubagentToolNames(parent.enabledTools, role),
    enabledSubagents: [],
    automaticRecovery: { mode: "manual", maxAttempts: 1, backoffMs: 5_000 },
  };
}
