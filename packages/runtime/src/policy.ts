import path from "node:path";

import type { JsonValue, ToolPolicyMode } from "@napier/contracts";

export interface PolicyDecision {
  allowed: boolean;
  risk: "low" | "medium" | "high" | "critical";
  reason: string;
}

const READ_ONLY_TOOLS = new Set([
  "list_files",
  "read_file",
  "search_files",
  "list_symbols",
  "inspect_data",
  "inspect_code",
  "read_symbol",
  "web_fetch",
  "web_search",
]);
const WRITE_TOOLS = new Set(["apply_patch"]);
const VERIFICATION_TOOLS = new Set(["verify_workspace"]);
const PROCESS_TOOLS = new Set(["run_command", "workspace_process"]);
const PROTECTED_WRITE_SEGMENTS = new Set([".git", ".napier", "node_modules"]);
const INTERNAL_LEDGER_TOOLS = new Set([
  "create_plan",
  "update_plan_step",
  "update_plan_artifact",
  "record_run_milestone",
  "request_operator_decision",
]);
const BLOCKED_COMMAND_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  reason: string;
}> = [
  {
    pattern: /(^|\s)(sudo|doas)\b/i,
    reason: "privilege escalation is not allowed",
  },
  {
    pattern: /(^|\s)rm\s+(-\S*r\S*f\S*|--recursive\b)/i,
    reason: "recursive forced deletion is blocked",
  },
  {
    pattern: /(^|\s)(shutdown|reboot|halt|poweroff)\b/i,
    reason: "host lifecycle commands are blocked",
  },
  {
    pattern: /(^|\s)(mkfs|fdisk|diskutil\s+erase|dd\s+if=)\b/i,
    reason: "raw disk operations are blocked",
  },
  {
    pattern: /(^|\s)git\s+(reset\s+--hard|clean\s+-\w*f)/i,
    reason: "destructive Git operations are blocked",
  },
  {
    pattern: /(^|\s)(kill\s+-9\s+-1|pkill\s+-9)\b/i,
    reason: "broad process termination is blocked",
  },
  {
    pattern: /curl\b[^|]*\|\s*(sh|bash|zsh)\b/i,
    reason: "piping remote code into a shell is blocked",
  },
];

function getStringField(input: JsonValue, key: string): string | undefined {
  if (!input || Array.isArray(input) || typeof input !== "object")
    return undefined;
  const value = input[key];
  return typeof value === "string" ? value : undefined;
}

export function isPathInsideWorkspace(
  candidate: string,
  workspaceRoot: string,
): boolean {
  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(root, candidate);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

export function assessToolCall(
  mode: ToolPolicyMode,
  toolName: string,
  input: JsonValue,
  workspaceRoot: string,
): PolicyDecision {
  if (INTERNAL_LEDGER_TOOLS.has(toolName)) {
    return {
      allowed: true,
      risk: "low",
      reason: "internal durable-ledger update",
    };
  }
  if (READ_ONLY_TOOLS.has(toolName)) {
    const candidate = getStringField(input, "path");
    if (candidate && !isPathInsideWorkspace(candidate, workspaceRoot)) {
      return {
        allowed: false,
        risk: "high",
        reason: "path escapes the configured workspace",
      };
    }
    return {
      allowed: true,
      risk: "low",
      reason: "read-only workspace operation",
    };
  }

  if (WRITE_TOOLS.has(toolName)) {
    const candidate = getStringField(input, "path");
    if (!candidate || !isPathInsideWorkspace(candidate, workspaceRoot)) {
      return {
        allowed: false,
        risk: "high",
        reason: "writes must target a path inside the workspace",
      };
    }
    const relative = path.relative(
      path.resolve(workspaceRoot),
      path.resolve(workspaceRoot, candidate),
    );
    const protectedSegment = relative
      .split(path.sep)
      .find((segment) => PROTECTED_WRITE_SEGMENTS.has(segment));
    if (protectedSegment) {
      return {
        allowed: false,
        risk: "high",
        reason: `writes cannot modify protected path segment: ${protectedSegment}`,
      };
    }
    if (mode === "observe") {
      return {
        allowed: false,
        risk: "medium",
        reason: "the active agent policy is read-only",
      };
    }
    return { allowed: true, risk: "medium", reason: "workspace-scoped write" };
  }

  if (VERIFICATION_TOOLS.has(toolName)) {
    const cwd = getStringField(input, "cwd");
    if (cwd && !isPathInsideWorkspace(cwd, workspaceRoot)) {
      return {
        allowed: false,
        risk: "high",
        reason: "verification cwd escapes the configured workspace",
      };
    }
    const target = getStringField(input, "target");
    if (
      target &&
      (path.isAbsolute(target) || /[\u0000-\u001f\u007f]/.test(target))
    ) {
      return {
        allowed: false,
        risk: "high",
        reason: "verification target must be workspace-relative",
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
      reason: "read-only sandboxed verification",
    };
  }

  if (PROCESS_TOOLS.has(toolName)) {
    const cwd = getStringField(input, "cwd");
    if (cwd && !isPathInsideWorkspace(cwd, workspaceRoot)) {
      return {
        allowed: false,
        risk: "high",
        reason: "command cwd escapes the configured workspace",
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
      risk: toolName === "workspace_process" ? "high" : "medium",
      reason:
        toolName === "workspace_process"
          ? "bounded background Process Session lifecycle"
          : "read-only sandboxed command execution",
    };
  }

  if (toolName === "bash") {
    const command = getStringField(input, "command") ?? "";
    for (const blocked of BLOCKED_COMMAND_PATTERNS) {
      if (blocked.pattern.test(command)) {
        return { allowed: false, risk: "critical", reason: blocked.reason };
      }
    }
    if (mode !== "unrestricted") {
      return {
        allowed: false,
        risk: "high",
        reason: "shell execution requires unrestricted policy",
      };
    }
    return {
      allowed: true,
      risk: "high",
      reason: "explicit unrestricted policy",
    };
  }

  return {
    allowed: false,
    risk: "high",
    reason: `tool "${toolName}" is not registered in the policy`,
  };
}
