import type { RunEvent } from "@napier/contracts";

export interface ToolEventTraceView {
  toolName: string;
  status: string;
  effect?: "read" | "write";
  inputSha256?: string;
  loopGuardTriggerSha256?: string;
  searchMatchCount?: number;
  searchTruncated?: boolean;
  searchMatchSetSha256?: string;
  verificationKind?: "typecheck" | "test" | "format";
  verificationStatus?: "passed" | "failed" | "timed_out" | "output_capped";
  verificationExitCode?: number;
  verificationStdoutSha256?: string;
  verificationStderrSha256?: string;
  verificationStdoutTruncated?: boolean;
  verificationStderrTruncated?: boolean;
}

const TOOL_EVENT_PATTERN = /^tool\.(started|completed|failed|blocked)$/u;
const TOOL_NAME = /^[A-Za-z0-9_.:-]{1,160}$/u;
const STATUS = /^[A-Za-z0-9_.:-]{1,64}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const TOOL_RECEIPT_SUMMARY = "tool receipt";

export function toolEventTraceView(
  event: RunEvent,
): ToolEventTraceView | undefined {
  if (
    !TOOL_EVENT_PATTERN.test(event.type) ||
    !event.payload ||
    Array.isArray(event.payload) ||
    typeof event.payload !== "object"
  ) {
    return undefined;
  }
  const toolName = safeToolName(event.payload["toolName"]);
  const status = safeStatus(event.payload["status"]) ?? statusFromEvent(event);
  if (!toolName || !status) return undefined;
  const effect = safeEffect(event.payload["effect"]);
  const inputSha256 = sha256(event.payload["inputSha256"]);
  const loopGuardTriggerSha256 = sha256(
    event.payload["loopGuardTriggerSha256"],
  );
  const searchEvidence =
    toolName === "search_files"
      ? searchFilesEvidence(event.payload["details"])
      : undefined;
  const verificationEvidence =
    toolName === "verify_workspace"
      ? verificationEvidenceView(event.payload["details"])
      : undefined;
  return {
    toolName,
    status,
    ...(effect ? { effect } : {}),
    ...(inputSha256 ? { inputSha256 } : {}),
    ...(loopGuardTriggerSha256 ? { loopGuardTriggerSha256 } : {}),
    ...(searchEvidence ? searchEvidence : {}),
    ...(verificationEvidence ? verificationEvidence : {}),
  };
}

export function toolEventTraceSummary(event: RunEvent): string | undefined {
  if (!TOOL_EVENT_PATTERN.test(event.type)) return undefined;
  const view = toolEventTraceView(event);
  if (!view) return TOOL_RECEIPT_SUMMARY;
  return [
    `tool / ${view.toolName}`,
    view.status,
    ...(view.effect ? [`effect ${view.effect}`] : []),
    ...(view.inputSha256 ? [`input ${view.inputSha256.slice(0, 12)}`] : []),
    ...(view.loopGuardTriggerSha256
      ? [`loop ${view.loopGuardTriggerSha256.slice(0, 12)}`]
      : []),
    ...(view.searchMatchCount !== undefined
      ? [`matches ${view.searchMatchCount}`]
      : []),
    ...(view.searchTruncated ? ["truncated"] : []),
    ...(view.searchMatchSetSha256
      ? [`match-set ${view.searchMatchSetSha256.slice(0, 12)}`]
      : []),
    ...(view.verificationKind && view.verificationStatus
      ? [`verification ${view.verificationKind} ${view.verificationStatus}`]
      : []),
    ...(view.verificationExitCode !== undefined
      ? [`exit ${view.verificationExitCode}`]
      : []),
    ...(view.verificationStdoutSha256
      ? [`stdout ${view.verificationStdoutSha256.slice(0, 12)}`]
      : []),
    ...(view.verificationStderrSha256
      ? [`stderr ${view.verificationStderrSha256.slice(0, 12)}`]
      : []),
    ...(view.verificationStdoutTruncated ? ["stdout-truncated"] : []),
    ...(view.verificationStderrTruncated ? ["stderr-truncated"] : []),
  ].join(" / ");
}

function statusFromEvent(event: RunEvent): string | undefined {
  if (event.type === "tool.started") return "started";
  if (event.type === "tool.completed") return "completed";
  if (event.type === "tool.failed") return "failed";
  if (event.type === "tool.blocked") return "blocked";
  return undefined;
}

function safeToolName(value: unknown): string | undefined {
  return typeof value === "string" && TOOL_NAME.test(value) ? value : undefined;
}

function safeStatus(value: unknown): string | undefined {
  return typeof value === "string" && STATUS.test(value) ? value : undefined;
}

function safeEffect(value: unknown): "read" | "write" | undefined {
  return value === "read" || value === "write" ? value : undefined;
}

function sha256(value: unknown): string | undefined {
  return typeof value === "string" && SHA256.test(value) ? value : undefined;
}

function searchFilesEvidence(
  value: unknown,
):
  | {
      searchMatchCount: number;
      searchTruncated?: boolean;
      searchMatchSetSha256?: string;
    }
  | undefined {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const count = record["count"];
  if (
    typeof count !== "number" ||
    !Number.isSafeInteger(count) ||
    count < 0 ||
    count > 80
  ) {
    return undefined;
  }
  const truncated = record["truncated"] === true;
  const matchSetSha256 = sha256(record["matchSetSha256"]);
  return {
    searchMatchCount: count,
    ...(truncated ? { searchTruncated: true } : {}),
    ...(matchSetSha256 ? { searchMatchSetSha256: matchSetSha256 } : {}),
  };
}

function verificationEvidenceView(
  value: unknown,
):
  | {
      verificationKind: "typecheck" | "test" | "format";
      verificationStatus: "passed" | "failed" | "timed_out" | "output_capped";
      verificationExitCode?: number;
      verificationStdoutSha256?: string;
      verificationStderrSha256?: string;
      verificationStdoutTruncated?: boolean;
      verificationStderrTruncated?: boolean;
    }
  | undefined {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const kind = verificationKind(record["kind"]);
  const status = verificationStatus(record["status"]);
  if (!kind || !status) return undefined;
  const exitCode = integerInRange(record["exitCode"], -1, 255);
  const stdoutSha256 = sha256(record["stdoutSha256"]);
  const stderrSha256 = sha256(record["stderrSha256"]);
  return {
    verificationKind: kind,
    verificationStatus: status,
    ...(exitCode !== undefined ? { verificationExitCode: exitCode } : {}),
    ...(stdoutSha256 ? { verificationStdoutSha256: stdoutSha256 } : {}),
    ...(stderrSha256 ? { verificationStderrSha256: stderrSha256 } : {}),
    ...(record["stdoutTruncated"] === true
      ? { verificationStdoutTruncated: true }
      : {}),
    ...(record["stderrTruncated"] === true
      ? { verificationStderrTruncated: true }
      : {}),
  };
}

function verificationKind(
  value: unknown,
): "typecheck" | "test" | "format" | undefined {
  return value === "typecheck" || value === "test" || value === "format"
    ? value
    : undefined;
}

function verificationStatus(
  value: unknown,
): "passed" | "failed" | "timed_out" | "output_capped" | undefined {
  return value === "passed" ||
    value === "failed" ||
    value === "timed_out" ||
    value === "output_capped"
    ? value
    : undefined;
}

function integerInRange(
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
