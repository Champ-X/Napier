import type { RunEvent } from "@napier/contracts";
import {
  legacyToolEffect,
  toolProtocolEventEvidence,
  type ToolProtocolEventEvidence,
} from "./tool-protocol-event-view";

export interface ConversationToolEvidence extends ToolProtocolEventEvidence {
  effect?: "read" | "write";
  inputSha256?: string;
  outputSha256?: string;
  outputBytes?: number;
  commandRuntime?: "node";
  commandStatus?: "succeeded" | "failed" | "timed_out" | "output_capped";
  commandArgumentCount?: number;
  commandExitCode?: number;
  commandTimeoutMs?: number;
  commandWorkspaceAccess?: "read_only";
  commandNetworkAccess?: "denied";
  commandSha256?: string;
  commandResultSha256?: string;
  readStartLine?: number;
  readEndLine?: number;
  readTotalLines?: number;
  readSizeBytes?: number;
  readPathSha256?: string;
  readFileSha256?: string;
  readAnchorSetSha256?: string;
  readTruncated?: boolean;
}

export interface ConversationToolActivity {
  id: string;
  callId: string;
  seq: number;
  createdAt: string;
  kind: "shell" | "tool";
  status: "working" | "completed" | "failed" | "blocked";
  toolName: string;
  evidence: ConversationToolEvidence;
  receipt: string;
  eventIds: string[];
}

const EVENT = /^tool\.(started|completed|failed|blocked)$/u;
const CALL_ID = /^[A-Za-z0-9_.:-]{1,160}$/u;
const TOOL_NAME = /^[A-Za-z0-9_.:-]{1,160}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const SPECIALIZED_TOOLS = new Set(["browser", "web_fetch", "web_search"]);

export function conversationToolActivities(
  events: RunEvent[],
  excludedCallIds: ReadonlySet<string> = new Set(),
  limit = 12,
): ConversationToolActivity[] {
  const latest = new Map<string, ConversationToolActivity>();
  for (const event of events) {
    const activity = conversationToolActivity(event);
    if (!activity || excludedCallIds.has(activity.callId)) continue;
    const prior = latest.get(activity.callId);
    latest.set(activity.callId, {
      ...activity,
      eventIds: [...(prior?.eventIds ?? []), event.id],
    });
  }
  return [...latest.values()]
    .sort((left, right) => left.seq - right.seq)
    .slice(-limit);
}

export function conversationToolActivity(
  event: RunEvent,
): ConversationToolActivity | undefined {
  if (
    event.visibility !== "user" ||
    !EVENT.test(event.type) ||
    !event.payload ||
    typeof event.payload !== "object" ||
    Array.isArray(event.payload)
  ) {
    return undefined;
  }
  const callId = event.payload["callId"];
  const toolName = event.payload["toolName"];
  if (
    typeof callId !== "string" ||
    !CALL_ID.test(callId) ||
    typeof toolName !== "string" ||
    !TOOL_NAME.test(toolName) ||
    SPECIALIZED_TOOLS.has(toolName)
  ) {
    return undefined;
  }
  const evidence = toolEvidence(toolName, event.payload);
  const shellFailed =
    toolName === "run_command" &&
    evidence.commandStatus !== undefined &&
    evidence.commandStatus !== "succeeded";
  return {
    id: event.id,
    callId,
    seq: event.seq,
    createdAt: event.createdAt,
    kind: toolName === "run_command" ? "shell" : "tool",
    status:
      event.type === "tool.started"
        ? "working"
        : event.type === "tool.completed"
          ? shellFailed
            ? "failed"
            : "completed"
          : event.type === "tool.blocked"
            ? "blocked"
            : "failed",
    toolName,
    evidence,
    receipt: toolReceipt(toolName, event.type, evidence),
    eventIds: [event.id],
  };
}

function toolEvidence(
  toolName: string,
  payload: Record<string, unknown>,
): ConversationToolEvidence {
  const effect =
    legacyToolEffect(toolProtocolEventEvidence(payload, toolName, statusFromPayload(payload))) ??
    (payload["effect"] === "read" || payload["effect"] === "write"
      ? payload["effect"]
      : undefined);
  const protocol = toolProtocolEventEvidence(
    payload,
    toolName,
    statusFromPayload(payload),
  );
  const inputSha256 = hash(payload["inputSha256"]);
  const outputSha256 =
    hash(payload["outputSha256"]) ?? hash(payload["outputTextSha256"]);
  const outputBytes =
    integer(payload["outputBytes"], 0, 16 * 1024 * 1024) ??
    integer(payload["outputTextBytes"], 0, 16 * 1024 * 1024);
  const command =
    toolName === "run_command" ? commandEvidence(payload["details"]) : {};
  const read =
    toolName === "read_file" ? readFileEvidence(payload["details"]) : {};
  return {
    ...(effect ? { effect } : {}),
    ...(inputSha256 ? { inputSha256 } : {}),
    ...(outputSha256 ? { outputSha256 } : {}),
    ...(outputBytes !== undefined ? { outputBytes } : {}),
    ...protocol,
    ...command,
    ...read,
  };
}

function statusFromPayload(
  payload: Record<string, unknown>,
): "started" | "completed" | "failed" | "blocked" {
  const value = payload["status"];
  return value === "started" ||
    value === "completed" ||
    value === "failed" ||
    value === "blocked"
    ? value
    : "failed";
}

function readFileEvidence(value: unknown): ConversationToolEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const details = value as Record<string, unknown>;
  const startLine = integer(details["startLine"], 1, 1_000_000);
  const endLine = integer(details["endLine"], 1, 1_000_000);
  if (startLine !== undefined && endLine !== undefined && endLine < startLine) {
    return {};
  }
  const totalLines = integer(details["totalLines"], 1, 1_000_000);
  const sizeBytes = integer(details["sizeBytes"], 0, 2 * 1024 * 1024);
  const pathSha256 = hash(details["pathSha256"]);
  const fileSha256 = hash(details["sha256"]);
  const anchorSetSha256 = hash(details["lineAnchorSetSha256"]);
  if (!pathSha256 && !fileSha256 && startLine === undefined) return {};
  return {
    ...(startLine !== undefined ? { readStartLine: startLine } : {}),
    ...(endLine !== undefined ? { readEndLine: endLine } : {}),
    ...(totalLines !== undefined ? { readTotalLines: totalLines } : {}),
    ...(sizeBytes !== undefined ? { readSizeBytes: sizeBytes } : {}),
    ...(pathSha256 ? { readPathSha256: pathSha256 } : {}),
    ...(fileSha256 ? { readFileSha256: fileSha256 } : {}),
    ...(anchorSetSha256 ? { readAnchorSetSha256: anchorSetSha256 } : {}),
    ...(details["truncated"] === true ? { readTruncated: true } : {}),
  };
}

function commandEvidence(value: unknown): ConversationToolEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const details = value as Record<string, unknown>;
  const commandStatus =
    details["status"] === "succeeded" ||
    details["status"] === "failed" ||
    details["status"] === "timed_out" ||
    details["status"] === "output_capped"
      ? details["status"]
      : undefined;
  const argumentCount = integer(details["argumentCount"], 0, 64);
  if (
    details["runtime"] !== "node" ||
    !commandStatus ||
    argumentCount === undefined
  ) {
    return {};
  }
  const exitCode = integer(details["exitCode"], -1, 255);
  const timeoutMs = integer(details["timeoutMs"], 1_000, 120_000);
  const commandSha256 = hash(details["commandSha256"]);
  const resultSha256 = hash(details["resultSha256"]);
  return {
    commandRuntime: "node",
    commandStatus,
    commandArgumentCount: argumentCount,
    ...(exitCode !== undefined ? { commandExitCode: exitCode } : {}),
    ...(timeoutMs !== undefined ? { commandTimeoutMs: timeoutMs } : {}),
    ...(details["workspaceAccess"] === "read_only"
      ? { commandWorkspaceAccess: "read_only" as const }
      : {}),
    ...(details["networkAccess"] === "denied"
      ? { commandNetworkAccess: "denied" as const }
      : {}),
    ...(commandSha256 ? { commandSha256 } : {}),
    ...(resultSha256 ? { commandResultSha256: resultSha256 } : {}),
  };
}

function toolReceipt(
  toolName: string,
  eventType: string,
  evidence: ConversationToolEvidence,
): string {
  return [
    `tool / ${toolName}`,
    eventType.slice("tool.".length),
    ...(evidence.effect ? [`effect ${evidence.effect}`] : []),
    ...(evidence.toolProtocolVersion
      ? [
          `protocol v${evidence.toolProtocolVersion}`,
          `side-effect ${evidence.toolSideEffect}`,
          `concurrency ${evidence.toolConcurrency}`,
          `definition ${evidence.toolDefinitionSha256!.slice(0, 12)}`,
          evidence.toolCompatibilityMode === "compatibility"
            ? "compatibility pi-v1"
            : "native protocol",
        ]
      : []),
    ...(evidence.commandStatus
      ? [`command ${evidence.commandRuntime} ${evidence.commandStatus}`]
      : []),
    ...(evidence.commandArgumentCount !== undefined
      ? [`args ${evidence.commandArgumentCount}`]
      : []),
    ...(evidence.commandExitCode !== undefined
      ? [`exit ${evidence.commandExitCode}`]
      : []),
    ...(evidence.commandWorkspaceAccess
      ? [`workspace ${evidence.commandWorkspaceAccess}`]
      : []),
    ...(evidence.commandNetworkAccess
      ? [`network ${evidence.commandNetworkAccess}`]
      : []),
    ...(evidence.readStartLine !== undefined &&
    evidence.readEndLine !== undefined
      ? [`range ${evidence.readStartLine}-${evidence.readEndLine}`]
      : []),
    ...(evidence.readTotalLines !== undefined
      ? [`lines ${evidence.readTotalLines}`]
      : []),
    ...(evidence.readSizeBytes !== undefined
      ? [`size ${evidence.readSizeBytes}`]
      : []),
    ...(evidence.readTruncated ? ["read-truncated"] : []),
    ...shortHash("input", evidence.inputSha256),
    ...shortHash("output", evidence.outputSha256),
    ...shortHash("command", evidence.commandSha256),
    ...shortHash("result", evidence.commandResultSha256),
    ...shortHash("read-path", evidence.readPathSha256),
    ...shortHash("file", evidence.readFileSha256),
    ...shortHash("anchor-set", evidence.readAnchorSetSha256),
  ].join(" / ");
}

function shortHash(label: string, value: string | undefined): string[] {
  return value ? [`${label} ${value.slice(0, 12)}`] : [];
}

function hash(value: unknown): string | undefined {
  return typeof value === "string" && SHA256.test(value) ? value : undefined;
}

function integer(
  value: unknown,
  minimum: number,
  maximum: number,
): number | undefined {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : undefined;
}
