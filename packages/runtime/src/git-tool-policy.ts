import type { JsonValue, ToolPolicyMode } from "@napier/contracts";

import { assessGitBranchCall } from "./git-branch-policy.js";
import { assessGitBranchSwitchCall } from "./git-branch-switch-policy.js";
import { assessGitCommitCall } from "./git-commit-policy.js";
import { assessGitReviewCall } from "./git-review-policy.js";
import { assessGitStageCall } from "./git-stage-policy.js";

interface GitToolPolicyDecision {
  allowed: boolean;
  risk: "low" | "medium" | "high" | "critical";
  reason: string;
}

export function assessGitToolCall(
  mode: ToolPolicyMode,
  toolName: string,
  input: JsonValue,
  workspaceRoot: string,
): GitToolPolicyDecision | undefined {
  return (
    assessGitStageCall(mode, toolName, input, workspaceRoot) ??
    assessGitCommitCall(mode, toolName, input) ??
    assessGitBranchCall(mode, toolName, input) ??
    assessGitBranchSwitchCall(mode, toolName, input) ??
    assessGitReviewCall(mode, toolName, input)
  );
}
