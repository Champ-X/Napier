import type { JsonValue, ToolPolicyMode } from "@napier/contracts";

import { assessGitCommitCall } from "./git-commit-policy.js";
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
    assessGitCommitCall(mode, toolName, input)
  );
}
