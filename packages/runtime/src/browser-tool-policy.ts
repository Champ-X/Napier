import path from "node:path";

import type { JsonValue, ToolPolicyMode } from "@napier/contracts";

import type { PolicyDecision } from "./policy-model.js";
import { validatePublicHttpUrl } from "./public-network.js";
import { isProtectedWorkspacePathSegment } from "./workspace-file-scope.js";

const BROWSER_TOOLS = new Set(["browser", "research_source"]);
const READ_ONLY_BROWSER_ACTIONS = new Set([
  "start",
  "navigate",
  "back",
  "wait",
  "find",
  "scroll",
  "snapshot",
  "screenshot",
  "close",
]);

export function assessBrowserToolCall(
  mode: ToolPolicyMode,
  toolName: string,
  input: JsonValue,
  workspaceRoot: string,
): PolicyDecision | undefined {
  if (!BROWSER_TOOLS.has(toolName)) return undefined;
  const action = getStringField(input, "action");
  if (action === "start" || action === "navigate") {
    try {
      validatePublicHttpUrl(getStringField(input, "url") ?? "");
    } catch {
      return {
        allowed: false,
        risk: "critical",
        reason: "browser URL is outside the public HTTP(S) boundary",
      };
    }
  }
  if (toolName === "research_source") {
    return assessResearchSource(action, input, workspaceRoot);
  }
  if (READ_ONLY_BROWSER_ACTIONS.has(action ?? "")) {
    return {
      allowed: true,
      risk: action === "screenshot" ? "medium" : "low",
      reason: "read-only isolated public-network Browser Session",
    };
  }
  if (mode === "observe") {
    return {
      allowed: false,
      risk: "high",
      reason: "interactive Browser actions require a writable Agent policy",
    };
  }
  if (action === "upload" || action === "download") {
    const candidate = getStringField(input, "path");
    const denial = workspacePathDenial(candidate, workspaceRoot);
    if (denial) return denial;
  }
  return {
    allowed: true,
    risk: "high",
    reason:
      "interactive isolated public-network Browser Session requires action-bound confirmation",
  };
}

function assessResearchSource(
  action: string | undefined,
  input: JsonValue,
  workspaceRoot: string,
): PolicyDecision {
  if (action === "verify_report") {
    const candidate = getStringField(input, "path");
    if (
      !candidate ||
      path.isAbsolute(candidate) ||
      !pathInsideWorkspace(candidate, workspaceRoot)
    ) {
      return {
        allowed: false,
        risk: "high",
        reason: "research reports must be inside the workspace",
      };
    }
    const relative = path.relative(
      path.resolve(workspaceRoot),
      path.resolve(workspaceRoot, candidate),
    );
    const protectedSegment = relative
      .split(path.sep)
      .find(isProtectedWorkspacePathSegment);
    if (protectedSegment) {
      return {
        allowed: false,
        risk: "high",
        reason: `research reports cannot read protected path segment: ${protectedSegment}`,
      };
    }
  }
  return {
    allowed: true,
    risk: "low",
    reason: "Run-local Browser Source and report verification",
  };
}

function workspacePathDenial(
  candidate: string | undefined,
  workspaceRoot: string,
): PolicyDecision | undefined {
  if (!candidate) {
    return {
      allowed: false,
      risk: "high",
      reason: "browser file action requires a workspace-relative path",
    };
  }
  if (
    path.isAbsolute(candidate) ||
    !pathInsideWorkspace(candidate, workspaceRoot)
  ) {
    return {
      allowed: false,
      risk: "high",
      reason: "writes must target a path inside the workspace",
    };
  }
  const protectedSegment = path
    .relative(
      path.resolve(workspaceRoot),
      path.resolve(workspaceRoot, candidate),
    )
    .split(path.sep)
    .find(isProtectedWorkspacePathSegment);
  if (protectedSegment) {
    return {
      allowed: false,
      risk: "high",
      reason: `writes cannot target protected path segment: ${protectedSegment}`,
    };
  }
  return undefined;
}

function pathInsideWorkspace(
  candidate: string,
  workspaceRoot: string,
): boolean {
  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(root, candidate);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

function getStringField(input: JsonValue, key: string): string | undefined {
  if (!input || Array.isArray(input) || typeof input !== "object") {
    return undefined;
  }
  const value = input[key];
  return typeof value === "string" ? value : undefined;
}
