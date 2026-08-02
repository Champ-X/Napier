import type { JsonValue, ToolPolicyMode } from "@napier/contracts";

interface GitCommitPolicyDecision {
  allowed: boolean;
  risk: "low" | "medium" | "high" | "critical";
  reason: string;
}

const GIT_COMMIT_TOOLS = new Set(["git_commit_preview", "git_commit_apply"]);

export function assessGitCommitCall(
  mode: ToolPolicyMode,
  toolName: string,
  input: JsonValue,
): GitCommitPolicyDecision | undefined {
  if (!GIT_COMMIT_TOOLS.has(toolName)) return undefined;
  if (
    toolName === "git_commit_preview" &&
    (!input ||
      Array.isArray(input) ||
      typeof input !== "object" ||
      typeof input["message"] !== "string" ||
      input["message"].length < 1)
  ) {
    return {
      allowed: false,
      risk: "high",
      reason: "Git commit preview requires a bounded message",
    };
  }
  if (mode === "observe") {
    return {
      allowed: false,
      risk: toolName === "git_commit_apply" ? "high" : "medium",
      reason: "the active agent policy does not allow Git commit execution",
    };
  }
  return {
    allowed: true,
    risk: toolName === "git_commit_apply" ? "high" : "medium",
    reason:
      toolName === "git_commit_preview"
        ? "private-object Git commit preview"
        : "fresh preview-bound atomic Git ref update",
  };
}
