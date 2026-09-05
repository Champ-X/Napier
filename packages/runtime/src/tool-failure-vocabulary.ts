import type {
  ToolFailureClassV1,
  ToolFailureDispositionV1,
  ToolFailureScopeV1,
} from "@napier/contracts/tool-protocol";

export const TOOL_FAILURE_CLASSES = new Set<ToolFailureClassV1>([
  "invalid_input",
  "unavailable",
  "unsupported",
  "unauthorized",
  "forbidden",
  "not_found",
  "rate_limited",
  "timeout",
  "network",
  "session_state",
  "cancelled",
  "policy",
  "resource_limit",
  "unknown",
]);

export const TOOL_FAILURE_SCOPES = new Set<ToolFailureScopeV1>([
  "invocation",
  "target",
  "origin",
  "route",
  "capability",
  "session",
]);

export const TOOL_FAILURE_DISPOSITIONS = new Set<ToolFailureDispositionV1>([
  "correct_input",
  "alternate_route",
  "retry_after",
  "recover_state",
  "terminal",
]);
