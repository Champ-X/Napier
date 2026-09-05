import path from "node:path";

import type { JsonValue } from "@napier/contracts";
import type { ToolInvocationProtocolV2 } from "@napier/contracts/tool-protocol";

import { assessHashBoundDataToolPath } from "./data-tool-policy.js";
import { CORE_STATELESS_READ_TOOL_NAMES } from "./read-only-tool-names.js";

const READ_ONLY_TOOLS = new Set([
  ...CORE_STATELESS_READ_TOOL_NAMES,
  "capability",
  "web_fetch",
  "web_search",
]);
interface ReadOnlyPolicyDecision {
  allowed: boolean;
  risk: "low" | "medium" | "high" | "critical";
  reason: string;
}

export function assessReadOnlyToolCall(
  toolName: string,
  input: JsonValue,
  workspaceRoot: string,
  protocol?: ToolInvocationProtocolV2,
): ReadOnlyPolicyDecision | undefined {
  // Current owned semantics are authoritative. The name set is retained only
  // for callers replaying the pre-Protocol compatibility path.
  if (
    protocol ? protocol.sideEffect !== "none" : !READ_ONLY_TOOLS.has(toolName)
  ) {
    return undefined;
  }
  const candidate = stringField(input, "path");
  const dataPathDenial = assessHashBoundDataToolPath(toolName, candidate);
  if (dataPathDenial) return dataPathDenial;
  if (candidate && !pathInsideWorkspace(candidate, workspaceRoot)) {
    return {
      allowed: false,
      risk: "high",
      reason: "path escapes the configured workspace",
    };
  }
  if (
    protocol?.progress.scope === "external" ||
    protocol?.progress.scope === "remote" ||
    protocol?.policyTags.includes("network:public-read") ||
    (!protocol && (toolName === "web_search" || toolName === "web_fetch"))
  ) {
    return {
      allowed: true,
      risk: "low",
      reason: "read-only public-network operation",
    };
  }
  if (protocol?.progress.scope === "run_source") {
    return {
      allowed: true,
      risk: "low",
      reason: "read-only Run-local Source operation",
    };
  }
  if (protocol?.progress.scope === "control") {
    return {
      allowed: true,
      risk: "low",
      reason: "read-only host-control operation",
    };
  }
  return {
    allowed: true,
    risk: "low",
    reason: "read-only workspace operation",
  };
}

function pathInsideWorkspace(
  candidate: string,
  workspaceRoot: string,
): boolean {
  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(root, candidate);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

function stringField(input: JsonValue, key: string): string | undefined {
  if (!input || Array.isArray(input) || typeof input !== "object") {
    return undefined;
  }
  return typeof input[key] === "string" ? input[key] : undefined;
}
