import path from "node:path";

import type { JsonValue, ToolPolicyMode } from "@napier/contracts";

import { validatePublicHttpUrl } from "./public-network.js";
import { isProtectedWorkspacePathSegment } from "./workspace-file-scope.js";

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
  "ast_query",
  "ast_edit_preview",
  "web_fetch",
  "web_search",
]);
const WRITE_TOOLS = new Set(["apply_patch"]);
const WORKSPACE_FILE_PREVIEW_TOOLS = new Set(["workspace_file_preview"]);
const WORKSPACE_FILE_APPLY_TOOLS = new Set(["workspace_file_apply"]);
const VERIFICATION_TOOLS = new Set(["verify_workspace"]);
const LSP_TOOLS = new Set([
  "lsp_diagnostics",
  "lsp_symbols",
  "lsp_definition",
  "lsp_references",
  "lsp_rename",
  "lsp_code_actions",
]);
const PROCESS_TOOLS = new Set([
  "run_command",
  "javascript_kernel",
  "python_kernel",
  "node_debugger",
  "workspace_process",
]);
const BROWSER_TOOLS = new Set(["browser", "research_source"]);
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

  if (WORKSPACE_FILE_PREVIEW_TOOLS.has(toolName)) {
    for (const key of ["path", "sourcePath", "destinationPath"]) {
      const candidate = getStringField(input, key);
      if (!candidate) continue;
      const denial = workspaceWritePathDenial(candidate, workspaceRoot);
      if (denial) return denial;
    }
    return {
      allowed: true,
      risk: "low",
      reason: "read-only workspace file mutation preview",
    };
  }

  if (WORKSPACE_FILE_APPLY_TOOLS.has(toolName)) {
    if (mode === "observe") {
      return {
        allowed: false,
        risk: "medium",
        reason: "the active agent policy is read-only",
      };
    }
    return {
      allowed: true,
      risk: "medium",
      reason: "fresh preview-bound workspace file mutation",
    };
  }

  if (WRITE_TOOLS.has(toolName)) {
    const candidate = getStringField(input, "path");
    if (!candidate) {
      return {
        allowed: false,
        risk: "high",
        reason: "writes must target a path inside the workspace",
      };
    }
    const denial = workspaceWritePathDenial(candidate, workspaceRoot);
    if (denial) return denial;
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

  if (LSP_TOOLS.has(toolName)) {
    const candidate = getStringField(input, "path");
    if (
      !candidate ||
      path.isAbsolute(candidate) ||
      !isPathInsideWorkspace(candidate, workspaceRoot)
    ) {
      return {
        allowed: false,
        risk: "high",
        reason: "LSP tool must target a path inside the workspace",
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
      reason:
        toolName === "lsp_diagnostics"
          ? "read-only sandboxed language-server diagnostics"
          : toolName === "lsp_symbols"
            ? "read-only sandboxed language-server symbol outline"
            : toolName === "lsp_definition"
              ? "read-only sandboxed language-server definition lookup"
              : toolName === "lsp_references"
                ? "read-only sandboxed language-server reference lookup"
                : toolName === "lsp_rename"
                  ? "read-only sandboxed language-server rename preview"
                  : "read-only sandboxed language-server quick-fix preview",
    };
  }

  if (BROWSER_TOOLS.has(toolName)) {
    if (mode !== "unrestricted") {
      return {
        allowed: false,
        risk: "high",
        reason: "external Browser Sessions require unrestricted policy",
      };
    }
    const action = getStringField(input, "action");
    if (action === "start" || action === "navigate") {
      const url = getStringField(input, "url");
      try {
        validatePublicHttpUrl(url ?? "");
      } catch {
        return {
          allowed: false,
          risk: "critical",
          reason: "browser URL is outside the public HTTP(S) boundary",
        };
      }
    }
    if (action === "upload" || action === "download") {
      const candidate = getStringField(input, "path");
      if (!candidate) {
        return {
          allowed: false,
          risk: "high",
          reason: "browser file action requires a workspace-relative path",
        };
      }
      const denial = workspaceWritePathDenial(candidate, workspaceRoot);
      if (denial) return denial;
    }
    return {
      allowed: true,
      risk: "high",
      reason: "isolated public-network Browser Session",
    };
  }

  if (PROCESS_TOOLS.has(toolName)) {
    if (
      toolName === "node_debugger" &&
      getStringField(input, "action") === "launch"
    ) {
      const candidate = getStringField(input, "path");
      if (
        !candidate ||
        path.isAbsolute(candidate) ||
        !isPathInsideWorkspace(candidate, workspaceRoot)
      ) {
        return {
          allowed: false,
          risk: "high",
          reason: "Node debugger must target a path inside the workspace",
        };
      }
    }
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
      risk:
        toolName === "workspace_process" ||
        toolName === "javascript_kernel" ||
        toolName === "python_kernel" ||
        toolName === "node_debugger"
          ? "high"
          : "medium",
      reason:
        toolName === "workspace_process"
          ? "bounded background Process Session lifecycle"
          : toolName === "javascript_kernel"
            ? "persistent sandboxed JavaScript state lifecycle"
            : toolName === "python_kernel"
              ? "persistent sandboxed Python state lifecycle"
              : toolName === "node_debugger"
                ? "persistent sandboxed Node DAP lifecycle"
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

function workspaceWritePathDenial(
  candidate: string,
  workspaceRoot: string,
): PolicyDecision | undefined {
  if (!isPathInsideWorkspace(candidate, workspaceRoot)) {
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
    .find(isProtectedWorkspacePathSegment);
  return protectedSegment
    ? {
        allowed: false,
        risk: "high",
        reason: `writes cannot modify protected path segment: ${protectedSegment}`,
      }
    : undefined;
}
