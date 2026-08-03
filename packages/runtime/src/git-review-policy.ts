import type { JsonValue, ToolPolicyMode } from "@napier/contracts";

interface GitReviewPolicyDecision {
  allowed: boolean;
  risk: "low" | "medium" | "high" | "critical";
  reason: string;
}

const GIT_REVIEW_TOOLS = new Set(["git_review_preview", "git_review_apply"]);

export function assessGitReviewCall(
  mode: ToolPolicyMode,
  toolName: string,
  input: JsonValue,
): GitReviewPolicyDecision | undefined {
  if (!GIT_REVIEW_TOOLS.has(toolName)) return undefined;
  if (
    toolName === "git_review_preview" &&
    (!input ||
      Array.isArray(input) ||
      typeof input !== "object" ||
      typeof input["targetBranchName"] !== "string" ||
      input["targetBranchName"].length < 1)
  ) {
    return {
      allowed: false,
      risk: "high",
      reason: "Git review preview requires one bounded local target branch",
    };
  }
  if (mode === "observe") {
    return {
      allowed: false,
      risk: toolName === "git_review_apply" ? "high" : "medium",
      reason: "the active agent policy does not allow Git review promotion",
    };
  }
  return {
    allowed: true,
    risk: toolName === "git_review_apply" ? "high" : "medium",
    reason:
      toolName === "git_review_preview"
        ? "fast-forward Git review preview"
        : "fresh preview-bound Git review promotion",
  };
}
