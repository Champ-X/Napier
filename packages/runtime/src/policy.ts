import path from "node:path";

import type { JsonValue, ToolPolicyMode } from "@napier/contracts";
import type { ToolInvocationProtocolV2 } from "@napier/contracts/tool-protocol";

import { assessBrowserToolCall } from "./browser-tool-policy.js";
import { assessGitToolCall } from "./git-tool-policy.js";
import type { PolicyDecision } from "./policy-model.js";
import { assessReadOnlyToolCall } from "./read-only-tool-policy.js";
import { isProtectedWorkspacePathSegment } from "./workspace-file-scope.js";

export type { PolicyDecision } from "./policy-model.js";

const WRITE_TOOLS = new Set(["apply_patch", "web_fetch_save"]);
const WORKSPACE_FILE_PREVIEW_TOOLS = new Set(["workspace_file_preview"]);
const WORKSPACE_FILE_APPLY_TOOLS = new Set(["workspace_file_apply"]);
const LSP_WORKSPACE_EDIT_APPLY_TOOLS = new Set([
  "lsp_rename_apply",
  "lsp_code_action_apply",
  "subagent_worktree_apply",
]);
const VERIFICATION_TOOLS = new Set(["verify_workspace"]);
const LSP_TOOLS = new Set([
  "lsp_diagnostics",
  "lsp_symbols",
  "lsp_definition",
  "lsp_references",
  "lsp_rename",
  "lsp_code_actions",
]);
const PROCESS_TOOL_NAMES =
  "run_command javascript_kernel python_kernel node_debugger workspace_process";
const PROCESS_TOOLS = new Set(PROCESS_TOOL_NAMES.split(" "));
const INTERNAL_LEDGER_TOOLS = new Set([
  "create_plan",
  "update_plan_step",
  "update_plan_artifact",
  "replan_plan",
  "record_run_milestone",
  "request_operator_decision",
  "delegate_task",
  "subagent_start",
  "subagent_send",
  "subagent_inspect",
  "subagent_cancel",
  "subagent_collect",
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
  protocol?: ToolInvocationProtocolV2,
): PolicyDecision {
  if (INTERNAL_LEDGER_TOOLS.has(toolName)) {
    return {
      allowed: true,
      risk: "low",
      reason: "internal durable-ledger update",
    };
  }
  const gitDecision = assessGitToolCall(mode, toolName, input, workspaceRoot);
  if (gitDecision) return gitDecision;
  const browserDecision = assessBrowserToolCall(
    mode,
    toolName,
    input,
    workspaceRoot,
  );
  if (browserDecision) return browserDecision;

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

  if (LSP_WORKSPACE_EDIT_APPLY_TOOLS.has(toolName)) {
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
      reason:
        toolName === "lsp_rename_apply"
          ? "fresh preview-bound coordinated LSP rename"
          : toolName === "lsp_code_action_apply"
            ? "fresh preview-bound coordinated LSP Code Action"
            : "fresh preview-bound coordinated Subagent worktree merge",
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

  if (PROCESS_TOOLS.has(toolName)) {
    const processAction = getStringField(input, "action");
    if (toolName === "workspace_process" && processAction === "preview_write") {
      const writePaths =
        input &&
        typeof input === "object" &&
        !Array.isArray(input) &&
        Array.isArray((input as Record<string, unknown>)["writePaths"])
          ? ((input as Record<string, unknown>)["writePaths"] as unknown[])
          : [];
      if (writePaths.length < 1) {
        return {
          allowed: false,
          risk: "high",
          reason: "scoped Process writes require explicit write paths",
        };
      }
      for (const writePath of writePaths) {
        if (typeof writePath !== "string") {
          return {
            allowed: false,
            risk: "high",
            reason: "scoped Process write path is invalid",
          };
        }
        const denial = workspaceWritePathDenial(writePath, workspaceRoot);
        if (denial) return denial;
      }
    }
    if (
      toolName === "node_debugger" &&
      getStringField(input, "action") === "launch"
    ) {
      const sourcePath = getStringField(input, "path");
      const programPath = getStringField(input, "programPath");
      const sourceMapPath = getStringField(input, "sourceMapPath");
      const candidates = [sourcePath, programPath, sourceMapPath].filter(
        (candidate): candidate is string => candidate !== undefined,
      );
      if (
        !sourcePath ||
        Boolean(programPath) !== Boolean(sourceMapPath) ||
        candidates.some(
          (candidate) =>
            path.isAbsolute(candidate) ||
            !isPathInsideWorkspace(candidate, workspaceRoot),
        )
      ) {
        return {
          allowed: false,
          risk: "high",
          reason:
            "Node debugger source, program, and source map must target paths inside the workspace",
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
          ? workspaceProcessPolicyReason(input, processAction)
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

  const readOnlyDecision = assessReadOnlyToolCall(
    toolName,
    input,
    workspaceRoot,
    protocol,
  );
  if (readOnlyDecision) return readOnlyDecision;

  return {
    allowed: false,
    risk: "high",
    reason: `tool "${toolName}" is not registered in the policy`,
  };
}

function workspaceProcessPolicyReason(
  input: JsonValue,
  action: string | undefined,
): string {
  if (action === "start" && record(input)?.["service"] !== undefined) {
    return "bounded egress-denied loopback service lifecycle";
  }
  if (action === "start_write") {
    return "fresh preview-bound scoped workspace Process write";
  }
  return action === "preview_write"
    ? "read-only scoped workspace Process write preview"
    : "bounded background Process Session lifecycle";
}

function record(value: JsonValue): Record<string, JsonValue> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : undefined;
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
