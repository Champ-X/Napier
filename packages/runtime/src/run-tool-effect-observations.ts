import type { JsonValue, RunEvent } from "@napier/contracts";
import { CORE_STATELESS_READ_TOOL_NAMES } from "./read-only-tool-names.js";
import { settledPatchRecoveryCandidates } from "./run-patch-recovery-evidence.js";

const SAFE_READ_ONLY_TOOLS = new Set([
  ...CORE_STATELESS_READ_TOOL_NAMES,
  "lsp_diagnostics",
  "lsp_symbols",
  "lsp_definition",
  "lsp_references",
  "lsp_rename",
  "lsp_code_actions",
  "run_command",
  "workspace_file_preview",
  "verify_workspace",
  "web_search",
]);
const UNSAFE_TOOLS = new Set([
  "apply_patch",
  "lsp_rename_apply",
  "lsp_code_action_apply",
  "workspace_file_apply",
  "bash",
  "javascript_kernel",
  "python_kernel",
  "node_debugger",
  "workspace_process",
  "browser",
  "web_fetch",
  "research_source",
  "create_plan",
  "update_plan_step",
  "update_plan_artifact",
  ..."delegate_task subagent_start subagent_send subagent_inspect subagent_cancel subagent_collect".split(
    " ",
  ),
]);
export interface RunToolEffectObservation {
  toolName: string;
  effect: "read" | "write" | "unknown";
  unresolved: boolean;
  requiresPostconditionCheck?: true;
}

export function collectRunToolEffectObservations(
  events: RunEvent[],
): RunToolEffectObservation[] {
  const recoverablePatches = new Set(
    settledPatchRecoveryCandidates(events).map((patch) => patch.startedSeq),
  );
  const terminals = new Map<string, RunEvent[]>();
  for (const event of events) {
    if (event.type !== "tool.completed" && event.type !== "tool.failed") {
      continue;
    }
    const callId = payloadString(event.payload, "callId");
    if (!callId) continue;
    const bucket = terminals.get(callId) ?? [];
    bucket.push(event);
    terminals.set(callId, bucket);
  }
  return events.flatMap((event): RunToolEffectObservation[] => {
    if (event.type !== "tool.started") return [];
    const callId = payloadString(event.payload, "callId");
    const toolName = payloadString(event.payload, "toolName") ?? "unknown_tool";
    const matches = callId
      ? (terminals.get(callId) ?? []).filter(
          (terminal) =>
            terminal.seq > event.seq &&
            payloadString(terminal.payload, "toolName") === toolName,
        )
      : [];
    const terminal = matches.length === 1 ? matches[0] : undefined;
    const effect = UNSAFE_TOOLS.has(toolName)
      ? "write"
      : (toolEffect(event.payload) ??
        (terminal ? toolEffect(terminal.payload) : undefined) ??
        (SAFE_READ_ONLY_TOOLS.has(toolName) ? "read" : "unknown"));
    return [
      {
        toolName: normalizeToolName(toolName),
        effect,
        unresolved:
          !callId ||
          (matches.length !== 1 && !recoverablePatches.has(event.seq)),
        ...(recoverablePatches.has(event.seq)
          ? { requiresPostconditionCheck: true as const }
          : {}),
      },
    ];
  });
}

function toolEffect(
  payload: JsonValue,
): "read" | "write" | "unknown" | undefined {
  if (!isRecord(payload)) return undefined;
  const direct = payload["effect"];
  if (direct === "read" || direct === "write" || direct === "unknown") {
    return direct;
  }
  const details = payload["details"];
  if (!isRecord(details)) return undefined;
  const nested = details["effect"];
  return nested === "read" || nested === "write" || nested === "unknown"
    ? nested
    : undefined;
}

function payloadString(payload: JsonValue, key: string): string | undefined {
  if (!isRecord(payload)) return undefined;
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function normalizeToolName(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 200 ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return "unknown_tool";
  }
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
