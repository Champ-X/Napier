import path from "node:path";

import { isProtectedWorkspacePathSegment } from "./workspace-file-scope.js";

interface DataToolPolicyDecision {
  allowed: false;
  risk: "high";
  reason: string;
}

const HASH_BOUND_DATA_TOOLS = new Set(["sqlite_query", "data_frame"]);

export function assessHashBoundDataToolPath(
  toolName: string,
  candidate: string | undefined,
): DataToolPolicyDecision | undefined {
  if (!HASH_BOUND_DATA_TOOLS.has(toolName)) return undefined;
  if (!candidate || path.isAbsolute(candidate)) {
    return {
      allowed: false,
      risk: "high",
      reason:
        toolName === "sqlite_query"
          ? "SQLite queries require a workspace-relative database path"
          : "DataFrame requires a workspace-relative source path",
    };
  }
  const protectedSegment = candidate
    .split(/[\\/]/u)
    .find(isProtectedWorkspacePathSegment);
  return protectedSegment
    ? {
        allowed: false,
        risk: "high",
        reason:
          toolName === "sqlite_query"
            ? `SQLite queries cannot read protected path segment: ${protectedSegment}`
            : `DataFrame cannot read protected path segment: ${protectedSegment}`,
      }
    : undefined;
}
