import path from "node:path";

import type { JsonValue, ToolPolicyMode } from "@napier/contracts";

interface GitInspectPolicyDecision {
  allowed: boolean;
  risk: "medium" | "high";
  reason: string;
}

export function assessGitInspectCall(
  mode: ToolPolicyMode,
  toolName: string,
  input: JsonValue,
  workspaceRoot: string,
): GitInspectPolicyDecision | undefined {
  if (toolName !== "git_inspect") return undefined;
  const candidates = gitInspectPaths(input);
  if (
    candidates.some(
      (candidate) =>
        path.isAbsolute(candidate) ||
        !pathInsideWorkspace(candidate, workspaceRoot),
    )
  ) {
    return {
      allowed: false,
      risk: "high",
      reason: "Git inspection path escapes the configured workspace",
    };
  }
  if (mode === "observe") {
    return {
      allowed: false,
      risk: "medium",
      reason: "the active agent policy does not allow process execution",
    };
  }
  return {
    allowed: true,
    risk: "medium",
    reason: "read-only sandboxed command execution",
  };
}

function gitInspectPaths(input: JsonValue): string[] {
  if (!input || Array.isArray(input) || typeof input !== "object") return [];
  const pathValue = input["path"];
  const pathsValue = input["paths"];
  return [
    ...(typeof pathValue === "string" ? [pathValue] : []),
    ...(Array.isArray(pathsValue)
      ? pathsValue.filter((item): item is string => typeof item === "string")
      : []),
  ];
}

function pathInsideWorkspace(
  candidate: string,
  workspaceRoot: string,
): boolean {
  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(root, candidate);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}
