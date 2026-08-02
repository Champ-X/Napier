import path from "node:path";

import type { JsonValue, ToolPolicyMode } from "@napier/contracts";

import { isProtectedWorkspacePathSegment } from "./workspace-file-scope.js";

const GIT_STAGE_TOOLS = new Set(["git_stage_preview", "git_stage_apply"]);
interface GitStagePolicyDecision {
  allowed: boolean;
  risk: "low" | "medium" | "high" | "critical";
  reason: string;
}

export function assessGitStageCall(
  mode: ToolPolicyMode,
  toolName: string,
  input: JsonValue,
  workspaceRoot: string,
): GitStagePolicyDecision | undefined {
  if (!GIT_STAGE_TOOLS.has(toolName)) return undefined;
  if (toolName === "git_stage_preview") {
    const candidate = stringField(input, "path");
    if (!candidate || !safeWorkspacePath(candidate, workspaceRoot)) {
      return {
        allowed: false,
        risk: "high",
        reason: "Git stage preview requires an unprotected workspace path",
      };
    }
  }
  if (mode === "observe") {
    return {
      allowed: false,
      risk: "medium",
      reason: "the active agent policy does not allow Git process execution",
    };
  }
  return {
    allowed: true,
    risk: "medium",
    reason:
      toolName === "git_stage_preview"
        ? "private-index Git stage preview"
        : "fresh preview-bound atomic Git index update",
  };
}

function safeWorkspacePath(candidate: string, workspaceRoot: string): boolean {
  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(root, candidate);
  if (
    resolved !== root &&
    !resolved.startsWith(`${root}${path.sep}`)
  ) {
    return false;
  }
  const relative = path.relative(root, resolved);
  return !relative.split(path.sep).some(isProtectedWorkspacePathSegment);
}

function stringField(input: JsonValue, key: string): string | undefined {
  if (!input || Array.isArray(input) || typeof input !== "object") {
    return undefined;
  }
  return typeof input[key] === "string" ? input[key] : undefined;
}
