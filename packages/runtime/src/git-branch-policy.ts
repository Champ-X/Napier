import type { JsonValue, ToolPolicyMode } from "@napier/contracts";

interface GitBranchPolicyDecision {
  allowed: boolean;
  risk: "low" | "medium" | "high" | "critical";
  reason: string;
}

const GIT_BRANCH_TOOLS = new Set([
  "git_branch_create_preview",
  "git_branch_create_apply",
]);

export function assessGitBranchCall(
  mode: ToolPolicyMode,
  toolName: string,
  input: JsonValue,
): GitBranchPolicyDecision | undefined {
  if (!GIT_BRANCH_TOOLS.has(toolName)) return undefined;
  if (
    toolName === "git_branch_create_preview" &&
    (!input ||
      Array.isArray(input) ||
      typeof input !== "object" ||
      typeof input["branchName"] !== "string" ||
      input["branchName"].length < 1)
  ) {
    return {
      allowed: false,
      risk: "high",
      reason: "Git branch preview requires a bounded local name",
    };
  }
  if (mode === "observe") {
    return {
      allowed: false,
      risk: toolName === "git_branch_create_apply" ? "high" : "medium",
      reason: "the active agent policy does not allow Git branch execution",
    };
  }
  return {
    allowed: true,
    risk: toolName === "git_branch_create_apply" ? "high" : "medium",
    reason:
      toolName === "git_branch_create_preview"
        ? "current-HEAD-bound Git branch preview"
        : "fresh preview-bound Git branch ref creation",
  };
}
