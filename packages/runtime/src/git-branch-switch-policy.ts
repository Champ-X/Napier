import type { JsonValue, ToolPolicyMode } from "@napier/contracts";

interface GitBranchSwitchPolicyDecision {
  allowed: boolean;
  risk: "low" | "medium" | "high" | "critical";
  reason: string;
}

const GIT_BRANCH_SWITCH_TOOLS = new Set([
  "git_branch_switch_preview",
  "git_branch_switch_apply",
]);

export function assessGitBranchSwitchCall(
  mode: ToolPolicyMode,
  toolName: string,
  input: JsonValue,
): GitBranchSwitchPolicyDecision | undefined {
  if (!GIT_BRANCH_SWITCH_TOOLS.has(toolName)) return undefined;
  if (
    toolName === "git_branch_switch_preview" &&
    (!input ||
      Array.isArray(input) ||
      typeof input !== "object" ||
      typeof input["targetBranchName"] !== "string" ||
      input["targetBranchName"].length < 1)
  ) {
    return {
      allowed: false,
      risk: "high",
      reason: "Git branch switch preview requires a bounded local name",
    };
  }
  if (mode === "observe") {
    return {
      allowed: false,
      risk: toolName === "git_branch_switch_apply" ? "high" : "medium",
      reason: "the active agent policy does not allow Git branch switching",
    };
  }
  return {
    allowed: true,
    risk: toolName === "git_branch_switch_apply" ? "high" : "medium",
    reason:
      toolName === "git_branch_switch_preview"
        ? "same-commit Git branch switch preview"
        : "fresh preview-bound HEAD symref transaction",
  };
}
