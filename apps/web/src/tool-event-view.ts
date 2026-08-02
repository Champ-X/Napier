import type { RunEvent } from "@napier/contracts";
import {
  dataFrameSummaryParts,
  dataFrameToolEventEvidence,
  type DataFrameToolEventTraceView,
} from "./data-frame-event-view";
import {
  inspectDataSummaryParts,
  inspectDataToolEventEvidence,
  type InspectDataToolEventTraceView,
} from "./inspect-data-event-view";
import {
  gitToolEventEvidence,
  gitToolSummaryParts,
  type GitToolEventTraceView,
} from "./git-event-view";
import {
  browserEventEvidence,
  browserSummaryParts,
  type BrowserToolEventTraceView,
} from "./browser-event-view";
import {
  javascriptKernelEventEvidence,
  javascriptKernelSummaryParts,
  type JavascriptKernelToolEventTraceView,
} from "./javascript-kernel-event-view";
import {
  pythonKernelEventEvidence,
  pythonKernelSummaryParts,
  type PythonKernelToolEventTraceView,
} from "./python-kernel-event-view";
import {
  researchSourceEventEvidence,
  researchSourceSummaryParts,
  type ResearchSourceToolEventTraceView,
} from "./research-source-event-view";
import {
  sqliteQueryEventEvidence,
  sqliteQuerySummaryParts,
  type SqliteQueryToolEventTraceView,
} from "./sqlite-query-event-view";
import {
  nodeDebuggerEventEvidence,
  nodeDebuggerSummaryParts,
  type NodeDebuggerToolEventTraceView,
} from "./node-debugger-event-view";
import {
  typescriptAstEventEvidence,
  typescriptAstSummaryParts,
  type TypescriptAstToolEventTraceView,
} from "./typescript-ast-event-view";
import {
  commandToolEventEvidence,
  commandToolEventSummaryParts,
  type CommandToolEventTraceView,
} from "./command-tool-event-view";
import {
  lspToolEventEvidence,
  lspToolEventSummaryParts,
  type LspToolEventTraceView,
} from "./lsp-tool-event-view";
import {
  writeLinkedTestEventEvidence,
  writeLinkedTestSummaryParts,
  type WriteLinkedTestEventTraceView,
} from "./write-linked-test-event-view";
import {
  subagentWorktreeEventEvidence,
  subagentWorktreeSummaryParts,
  type SubagentWorktreeToolEventTraceView,
} from "./subagent-worktree-event-view";
import {
  verificationEventEvidence,
  verificationSummaryParts,
  type VerificationToolEventTraceView,
} from "./verification-event-view";
import {
  workspaceReadEventEvidence,
  workspaceReadSummaryParts,
  type WorkspaceReadToolEventTraceView,
} from "./workspace-read-event-view";

export interface ToolEventTraceView
  extends
    CommandToolEventTraceView,
    BrowserToolEventTraceView,
    LspToolEventTraceView,
    JavascriptKernelToolEventTraceView,
    PythonKernelToolEventTraceView,
    ResearchSourceToolEventTraceView,
    SqliteQueryToolEventTraceView,
    DataFrameToolEventTraceView,
    GitToolEventTraceView,
    InspectDataToolEventTraceView,
    NodeDebuggerToolEventTraceView,
    TypescriptAstToolEventTraceView,
    SubagentWorktreeToolEventTraceView,
    VerificationToolEventTraceView,
    WriteLinkedTestEventTraceView,
    WorkspaceReadToolEventTraceView {
  toolName: string;
  status: string;
  effect?: "read" | "write";
  inputSha256?: string;
  loopGuardTriggerSha256?: string;
  patchOperation?:
    | "create"
    | "replace"
    | "hashline_replace"
    | "hashrange_replace";
  patchPathSha256?: string;
  patchBeforeSha256?: string;
  patchAfterSha256?: string;
  patchBeforeBytes?: number;
  patchAfterBytes?: number;
  patchEditCount?: number;
  patchCreatedParentDirectoryCount?: number;
  patchCreatedParentDirectorySetSha256?: string;
  patchDiagnosticsStatus?:
    | "clean"
    | "introduced"
    | "improved"
    | "unchanged"
    | "regressed"
    | "truncated"
    | "unavailable"
    | "drifted";
  patchBeforeDiagnosticCount?: number;
  patchAfterDiagnosticCount?: number;
  patchIntroducedDiagnosticCount?: number;
  patchResolvedDiagnosticCount?: number;
  patchDiagnosticsDurationMs?: number;
  patchDiagnosticsDeltaSetSha256?: string;
  patchDiagnosticsResultSha256?: string;
  fileMutationAction?: "list_trash" | "preview" | "apply";
  fileMutationOperation?: "create_directory" | "move" | "trash" | "restore";
  fileMutationItemCount?: number;
  fileMutationSourcePathSha256?: string;
  fileMutationDestinationPathSha256?: string;
  fileMutationBeforeSha256?: string;
  fileMutationAfterSha256?: string;
  fileMutationFileCount?: number;
  fileMutationDirectoryCount?: number;
  fileMutationBytes?: number;
  fileMutationReversible?: boolean;
  fileMutationPostcondition?: "verified" | "drifted" | "indeterminate";
  sourceRunId?: string;
  sourceCallId?: string;
  targetCallId?: string;
  targetExecutionMode?: string;
  outputChanged?: boolean;
  durationMsDelta?: number;
  previewSha256?: string;
  comparisonSha256?: string;
  resultSha256?: string;
  resultCapsuleSha256?: string;
  sourceToolResultSetSha256?: string;
  resultReused?: boolean;
  resultError?: boolean;
}

const TOOL_EVENT_PATTERN =
  /^tool\.(started|completed|failed|blocked|experiment\.(started|compared)|result_reused|result_reuse\.blocked)$/u;
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
  const toolName =
    safeToolName(event.payload["toolName"]) ??
    safeToolName(event.payload["sourceToolName"]);
  const status = safeStatus(event.payload["status"]) ?? statusFromEvent(event);
  if (!toolName || !status) return undefined;
  const effect = safeEffect(event.payload["effect"]);
  const inputSha256 = sha256(event.payload["inputSha256"]);
  const loopGuardTriggerSha256 = sha256(
    event.payload["loopGuardTriggerSha256"],
  );
  const workspaceReadEvidence = workspaceReadEventEvidence(
    toolName,
    event.payload["details"],
  );
  const dataEvidence = inspectDataToolEventEvidence(
    toolName,
    event.payload["details"],
  );
  const lspEvidence = lspToolEventEvidence(toolName, event.payload["details"]);
  const verificationEvidence =
    toolName === "verify_workspace"
      ? verificationEventEvidence(event.payload["details"])
      : undefined;
  const commandEvidence =
    toolName === "run_command"
      ? commandToolEventEvidence(event.payload["details"])
      : undefined;
  const gitEvidence = gitToolEventEvidence(
    toolName,
    event.payload["details"],
  );
  const browserEvidence =
    toolName === "browser"
      ? browserEventEvidence(event.payload["details"])
      : undefined;
  const researchSourceEvidence =
    toolName === "research_source"
      ? researchSourceEventEvidence(event.payload["details"])
      : undefined;
  const sqliteQueryEvidence =
    toolName === "sqlite_query"
      ? sqliteQueryEventEvidence(event.payload["details"])
      : undefined;
  const dataFrameEvidence = dataFrameToolEventEvidence(
    toolName,
    event.payload["details"],
  );
  const javascriptKernelEvidence =
    toolName === "javascript_kernel"
      ? javascriptKernelEventEvidence(event.payload["details"])
      : undefined;
  const pythonKernelEvidence =
    toolName === "python_kernel"
      ? pythonKernelEventEvidence(event.payload["details"])
      : undefined;
  const nodeDebuggerEvidence =
    toolName === "node_debugger"
      ? nodeDebuggerEventEvidence(event.payload["details"])
      : undefined;
  const typescriptAstEvidence =
    toolName === "ast_query" || toolName === "ast_edit_preview"
      ? typescriptAstEventEvidence(event.payload["details"])
      : undefined;
  const patchEvidence =
    toolName === "apply_patch"
      ? applyPatchEvidence(event.payload["details"])
      : undefined;
  const subagentWorktreeEvidence =
    toolName === "subagent_worktree_apply"
      ? subagentWorktreeEventEvidence(event.payload["details"])
      : undefined;
  const fileMutationEvidence =
    toolName === "workspace_file_preview" || toolName === "workspace_file_apply"
      ? workspaceFileMutationEvidence(event.payload["details"])
      : undefined;
  return {
    toolName,
    status,
    ...(effect ? { effect } : {}),
    ...(inputSha256 ? { inputSha256 } : {}),
    ...(loopGuardTriggerSha256 ? { loopGuardTriggerSha256 } : {}),
    ...(workspaceReadEvidence ?? {}),
    ...(dataEvidence ?? {}),
    ...(lspEvidence ? lspEvidence : {}),
    ...(verificationEvidence ? verificationEvidence : {}),
    ...(commandEvidence ? commandEvidence : {}),
    ...(gitEvidence ? gitEvidence : {}),
    ...(browserEvidence ? browserEvidence : {}),
    ...(researchSourceEvidence ? researchSourceEvidence : {}),
    ...(sqliteQueryEvidence ? sqliteQueryEvidence : {}),
    ...(dataFrameEvidence ?? {}),
    ...(javascriptKernelEvidence ? javascriptKernelEvidence : {}),
    ...(pythonKernelEvidence ? pythonKernelEvidence : {}),
    ...(nodeDebuggerEvidence ? nodeDebuggerEvidence : {}),
    ...(typescriptAstEvidence ? typescriptAstEvidence : {}),
    ...(patchEvidence ? patchEvidence : {}),
    ...(subagentWorktreeEvidence ? subagentWorktreeEvidence : {}),
    ...(fileMutationEvidence ? fileMutationEvidence : {}),
    ...safeStatusField(event.payload, "sourceRunId"),
    ...safeStatusField(event.payload, "sourceCallId"),
    ...safeStatusField(event.payload, "targetCallId"),
    ...safeStatusField(event.payload, "targetExecutionMode"),
    ...(typeof event.payload["outputChanged"] === "boolean"
      ? { outputChanged: event.payload["outputChanged"] }
      : {}),
    ...signedIntegerField(event.payload, "durationMsDelta"),
    ...shaViewField(event.payload, "previewSha256"),
    ...shaViewField(event.payload, "comparisonSha256"),
    ...shaViewField(event.payload, "resultSha256"),
    ...shaViewField(event.payload, "resultCapsuleSha256"),
    ...shaViewField(event.payload, "sourceToolResultSetSha256"),
    ...(event.payload["resultReused"] === true ? { resultReused: true } : {}),
    ...(typeof event.payload["isError"] === "boolean"
      ? { resultError: event.payload["isError"] }
      : {}),
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
    ...workspaceReadSummaryParts(view),
    ...inspectDataSummaryParts(view),
    ...lspToolEventSummaryParts(view),
    ...verificationSummaryParts(view),
    ...commandToolEventSummaryParts(view),
    ...gitToolSummaryParts(view),
    ...browserSummaryParts(view),
    ...researchSourceSummaryParts(view),
    ...sqliteQuerySummaryParts(view),
    ...dataFrameSummaryParts(view),
    ...javascriptKernelSummaryParts(view),
    ...pythonKernelSummaryParts(view),
    ...nodeDebuggerSummaryParts(view),
    ...typescriptAstSummaryParts(view),
    ...subagentWorktreeSummaryParts(view),
    ...(view.patchOperation ? [`patch ${view.patchOperation}`] : []),
    ...(view.patchEditCount !== undefined
      ? [`edits ${view.patchEditCount}`]
      : []),
    ...(view.patchBeforeBytes !== undefined &&
    view.patchAfterBytes !== undefined
      ? [`bytes ${view.patchBeforeBytes}->${view.patchAfterBytes}`]
      : []),
    ...(view.patchPathSha256
      ? [`path ${view.patchPathSha256.slice(0, 12)}`]
      : []),
    ...(view.patchBeforeSha256
      ? [`before ${view.patchBeforeSha256.slice(0, 12)}`]
      : view.patchOperation === "create"
        ? ["before absent"]
        : []),
    ...(view.patchAfterSha256
      ? [`after ${view.patchAfterSha256.slice(0, 12)}`]
      : []),
    ...(view.patchCreatedParentDirectoryCount !== undefined
      ? [`created-dirs ${view.patchCreatedParentDirectoryCount}`]
      : []),
    ...(view.patchCreatedParentDirectorySetSha256
      ? [
          `created-dir-set ${view.patchCreatedParentDirectorySetSha256.slice(0, 12)}`,
        ]
      : []),
    ...(view.patchDiagnosticsStatus
      ? [`diagnostics ${view.patchDiagnosticsStatus}`]
      : []),
    ...(view.patchBeforeDiagnosticCount !== undefined &&
    view.patchAfterDiagnosticCount !== undefined
      ? [
          `diagnostic-count ${view.patchBeforeDiagnosticCount}->${view.patchAfterDiagnosticCount}`,
        ]
      : []),
    ...(view.patchIntroducedDiagnosticCount !== undefined
      ? [`introduced ${view.patchIntroducedDiagnosticCount}`]
      : []),
    ...(view.patchResolvedDiagnosticCount !== undefined
      ? [`resolved ${view.patchResolvedDiagnosticCount}`]
      : []),
    ...(view.patchDiagnosticsDurationMs !== undefined
      ? [`diagnostic-ms ${view.patchDiagnosticsDurationMs}`]
      : []),
    ...(view.patchDiagnosticsDeltaSetSha256
      ? [`diagnostic-delta ${view.patchDiagnosticsDeltaSetSha256.slice(0, 12)}`]
      : []),
    ...(view.patchDiagnosticsResultSha256
      ? [`diagnostic-result ${view.patchDiagnosticsResultSha256.slice(0, 12)}`]
      : []),
    ...writeLinkedTestSummaryParts(view),
    ...(view.fileMutationAction
      ? [`file-action ${view.fileMutationAction}`]
      : []),
    ...(view.fileMutationOperation
      ? [`file-operation ${view.fileMutationOperation}`]
      : []),
    ...(view.fileMutationItemCount !== undefined
      ? [`trash-items ${view.fileMutationItemCount}`]
      : []),
    ...(view.fileMutationFileCount !== undefined
      ? [`files ${view.fileMutationFileCount}`]
      : []),
    ...(view.fileMutationDirectoryCount !== undefined
      ? [`directories ${view.fileMutationDirectoryCount}`]
      : []),
    ...(view.fileMutationBytes !== undefined
      ? [`bytes ${view.fileMutationBytes}`]
      : []),
    ...(view.fileMutationSourcePathSha256
      ? [`source ${view.fileMutationSourcePathSha256.slice(0, 12)}`]
      : []),
    ...(view.fileMutationDestinationPathSha256
      ? [`destination ${view.fileMutationDestinationPathSha256.slice(0, 12)}`]
      : []),
    ...(view.fileMutationBeforeSha256
      ? [`before ${view.fileMutationBeforeSha256.slice(0, 12)}`]
      : []),
    ...(view.fileMutationAfterSha256
      ? [`after ${view.fileMutationAfterSha256.slice(0, 12)}`]
      : []),
    ...(view.fileMutationPostcondition
      ? [`postcondition ${view.fileMutationPostcondition}`]
      : []),
    ...(view.fileMutationReversible ? ["reversible"] : []),
    ...(view.sourceRunId ? [`source ${view.sourceRunId.slice(-10)}`] : []),
    ...(view.sourceCallId ? [`call ${view.sourceCallId.slice(-10)}`] : []),
    ...(view.targetCallId
      ? [`target-call ${view.targetCallId.slice(-10)}`]
      : []),
    ...(view.targetExecutionMode ? [`mode ${view.targetExecutionMode}`] : []),
    ...(view.outputChanged !== undefined
      ? [`output-changed ${view.outputChanged}`]
      : []),
    ...(view.durationMsDelta !== undefined
      ? [`duration-delta ${view.durationMsDelta}`]
      : []),
    ...(view.previewSha256
      ? [`preview ${view.previewSha256.slice(0, 12)}`]
      : []),
    ...(view.comparisonSha256
      ? [`comparison ${view.comparisonSha256.slice(0, 12)}`]
      : []),
    ...(view.resultSha256 ? [`result ${view.resultSha256.slice(0, 12)}`] : []),
    ...(view.resultCapsuleSha256
      ? [`result-capsule ${view.resultCapsuleSha256.slice(0, 12)}`]
      : []),
    ...(view.sourceToolResultSetSha256
      ? [`result-set ${view.sourceToolResultSetSha256.slice(0, 12)}`]
      : []),
    ...(view.resultReused ? ["reused"] : []),
    ...(view.resultError !== undefined
      ? [`result-error ${view.resultError}`]
      : []),
  ].join(" / ");
}

function statusFromEvent(event: RunEvent): string | undefined {
  if (event.type === "tool.started") return "started";
  if (event.type === "tool.completed") return "completed";
  if (event.type === "tool.failed") return "failed";
  if (event.type === "tool.blocked") return "blocked";
  if (event.type === "tool.experiment.started") return "started";
  if (event.type === "tool.result_reused") return "reused";
  if (event.type === "tool.result_reuse.blocked") return "blocked";
  return undefined;
}

function safeToolName(value: unknown): string | undefined {
  return typeof value === "string" && TOOL_NAME.test(value) ? value : undefined;
}

function safeStatus(value: unknown): string | undefined {
  return typeof value === "string" && STATUS.test(value) ? value : undefined;
}

function safeStatusField(
  payload: Record<string, unknown>,
  key: keyof ToolEventTraceView,
): Partial<ToolEventTraceView> {
  const value = safeStatus(payload[key]);
  return value ? { [key]: value } : {};
}

function signedIntegerField(
  payload: Record<string, unknown>,
  key: keyof ToolEventTraceView,
): Partial<ToolEventTraceView> {
  const value = payload[key];
  return typeof value === "number" && Number.isSafeInteger(value)
    ? { [key]: value }
    : {};
}

function shaViewField(
  payload: Record<string, unknown>,
  key: keyof ToolEventTraceView,
): Partial<ToolEventTraceView> {
  const value = sha256(payload[key]);
  return value ? { [key]: value } : {};
}

function safeEffect(value: unknown): "read" | "write" | undefined {
  return value === "read" || value === "write" ? value : undefined;
}

function sha256(value: unknown): string | undefined {
  return typeof value === "string" && SHA256.test(value) ? value : undefined;
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

function applyPatchEvidence(value: unknown):
  | {
      patchOperation:
        | "create"
        | "replace"
        | "hashline_replace"
        | "hashrange_replace";
      patchPathSha256?: string;
      patchBeforeSha256?: string;
      patchAfterSha256?: string;
      patchBeforeBytes?: number;
      patchAfterBytes?: number;
      patchEditCount?: number;
      patchCreatedParentDirectoryCount?: number;
      patchCreatedParentDirectorySetSha256?: string;
      patchDiagnosticsStatus?:
        | "clean"
        | "introduced"
        | "improved"
        | "unchanged"
        | "regressed"
        | "truncated"
        | "unavailable"
        | "drifted";
      patchBeforeDiagnosticCount?: number;
      patchAfterDiagnosticCount?: number;
      patchIntroducedDiagnosticCount?: number;
      patchResolvedDiagnosticCount?: number;
      patchDiagnosticsDurationMs?: number;
      patchDiagnosticsDeltaSetSha256?: string;
      patchDiagnosticsResultSha256?: string;
    }
  | undefined {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const operation = patchOperation(record["operation"]);
  if (!operation) return undefined;
  const pathSha256 = sha256(record["pathSha256"]);
  const beforeSha256 = sha256(record["beforeSha256"]);
  const afterSha256 = sha256(record["afterSha256"]);
  const beforeBytes = integerInRange(record["beforeBytes"], 0, 262_144);
  const afterBytes = integerInRange(record["afterBytes"], 0, 262_144);
  const editCount = integerInRange(record["editCount"], 0, 32);
  const createdParentDirectoryCount = integerInRange(
    record["createdParentDirectoryCount"],
    0,
    32,
  );
  const createdParentDirectorySetSha256 = sha256(
    record["createdParentDirectorySetSha256"],
  );
  const diagnostics = patchDiagnosticsEvidence(record["diagnostics"]);
  const tests = writeLinkedTestEventEvidence(record["tests"]);
  if (record["tests"] !== undefined && !tests) return undefined;
  return {
    patchOperation: operation,
    ...(pathSha256 ? { patchPathSha256: pathSha256 } : {}),
    ...(beforeSha256 ? { patchBeforeSha256: beforeSha256 } : {}),
    ...(afterSha256 ? { patchAfterSha256: afterSha256 } : {}),
    ...(beforeBytes !== undefined ? { patchBeforeBytes: beforeBytes } : {}),
    ...(afterBytes !== undefined ? { patchAfterBytes: afterBytes } : {}),
    ...(editCount !== undefined ? { patchEditCount: editCount } : {}),
    ...(createdParentDirectoryCount !== undefined
      ? { patchCreatedParentDirectoryCount: createdParentDirectoryCount }
      : {}),
    ...(createdParentDirectorySetSha256
      ? {
          patchCreatedParentDirectorySetSha256: createdParentDirectorySetSha256,
        }
      : {}),
    ...(diagnostics ?? {}),
    ...(tests ?? {}),
  };
}

function patchDiagnosticsEvidence(value: unknown):
  | {
      patchDiagnosticsStatus:
        | "clean"
        | "introduced"
        | "improved"
        | "unchanged"
        | "regressed"
        | "truncated"
        | "unavailable"
        | "drifted";
      patchBeforeDiagnosticCount?: number;
      patchAfterDiagnosticCount?: number;
      patchIntroducedDiagnosticCount?: number;
      patchResolvedDiagnosticCount?: number;
      patchDiagnosticsDurationMs?: number;
      patchDiagnosticsDeltaSetSha256?: string;
      patchDiagnosticsResultSha256?: string;
    }
  | undefined {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const status =
    record["status"] === "clean" ||
    record["status"] === "introduced" ||
    record["status"] === "improved" ||
    record["status"] === "unchanged" ||
    record["status"] === "regressed" ||
    record["status"] === "truncated" ||
    record["status"] === "unavailable" ||
    record["status"] === "drifted"
      ? record["status"]
      : undefined;
  if (
    record["kind"] !== "napier.workspace-patch-diagnostics" ||
    record["schemaVersion"] !== 1 ||
    !status
  ) {
    return undefined;
  }
  const beforeDiagnosticCount = integerInRange(
    record["beforeDiagnosticCount"],
    0,
    64,
  );
  const afterDiagnosticCount = integerInRange(
    record["afterDiagnosticCount"],
    0,
    64,
  );
  const introducedCount = integerInRange(record["introducedCount"], 0, 64);
  const resolvedCount = integerInRange(record["resolvedCount"], 0, 64);
  const durationMs = integerInRange(record["durationMs"], 0, 60_000);
  const deltaSetSha256 = sha256(record["deltaSetSha256"]);
  const resultSha256 = sha256(record["resultSha256"]);
  return {
    patchDiagnosticsStatus: status,
    ...(beforeDiagnosticCount !== undefined
      ? { patchBeforeDiagnosticCount: beforeDiagnosticCount }
      : {}),
    ...(afterDiagnosticCount !== undefined
      ? { patchAfterDiagnosticCount: afterDiagnosticCount }
      : {}),
    ...(introducedCount !== undefined
      ? { patchIntroducedDiagnosticCount: introducedCount }
      : {}),
    ...(resolvedCount !== undefined
      ? { patchResolvedDiagnosticCount: resolvedCount }
      : {}),
    ...(durationMs !== undefined
      ? { patchDiagnosticsDurationMs: durationMs }
      : {}),
    ...(deltaSetSha256
      ? { patchDiagnosticsDeltaSetSha256: deltaSetSha256 }
      : {}),
    ...(resultSha256 ? { patchDiagnosticsResultSha256: resultSha256 } : {}),
  };
}

function patchOperation(
  value: unknown,
): "create" | "replace" | "hashline_replace" | "hashrange_replace" | undefined {
  return value === "create" ||
    value === "replace" ||
    value === "hashline_replace" ||
    value === "hashrange_replace"
    ? value
    : undefined;
}

function workspaceFileMutationEvidence(value: unknown):
  | {
      fileMutationAction: "list_trash" | "preview" | "apply";
      fileMutationOperation?: "create_directory" | "move" | "trash" | "restore";
      fileMutationItemCount?: number;
      fileMutationSourcePathSha256?: string;
      fileMutationDestinationPathSha256?: string;
      fileMutationBeforeSha256?: string;
      fileMutationAfterSha256?: string;
      fileMutationFileCount?: number;
      fileMutationDirectoryCount?: number;
      fileMutationBytes?: number;
      fileMutationReversible?: boolean;
      fileMutationPostcondition?: "verified" | "drifted" | "indeterminate";
    }
  | undefined {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const action =
    record["action"] === "list_trash" ||
    record["action"] === "preview" ||
    record["action"] === "apply"
      ? record["action"]
      : undefined;
  if (!action) return undefined;
  const operation =
    record["operation"] === "create_directory" ||
    record["operation"] === "move" ||
    record["operation"] === "trash" ||
    record["operation"] === "restore"
      ? record["operation"]
      : undefined;
  const itemCount = integerInRange(record["itemCount"], 0, 10_000);
  const fileCount = integerInRange(record["fileCount"], 0, 2_000);
  const directoryCount = integerInRange(record["directoryCount"], 0, 2_000);
  const bytes = integerInRange(record["bytes"], 0, 32 * 1024 * 1024);
  const sourcePathSha256 = sha256(record["sourcePathSha256"]);
  const destinationPathSha256 = sha256(record["destinationPathSha256"]);
  const beforeSha256 = sha256(record["beforeSha256"]);
  const afterSha256 = sha256(record["afterSha256"]);
  const postcondition =
    record["postcondition"] === "verified" ||
    record["postcondition"] === "drifted" ||
    record["postcondition"] === "indeterminate"
      ? record["postcondition"]
      : undefined;
  return {
    fileMutationAction: action,
    ...(operation ? { fileMutationOperation: operation } : {}),
    ...(itemCount !== undefined ? { fileMutationItemCount: itemCount } : {}),
    ...(sourcePathSha256
      ? { fileMutationSourcePathSha256: sourcePathSha256 }
      : {}),
    ...(destinationPathSha256
      ? { fileMutationDestinationPathSha256: destinationPathSha256 }
      : {}),
    ...(beforeSha256 ? { fileMutationBeforeSha256: beforeSha256 } : {}),
    ...(afterSha256 ? { fileMutationAfterSha256: afterSha256 } : {}),
    ...(fileCount !== undefined ? { fileMutationFileCount: fileCount } : {}),
    ...(directoryCount !== undefined
      ? { fileMutationDirectoryCount: directoryCount }
      : {}),
    ...(bytes !== undefined ? { fileMutationBytes: bytes } : {}),
    ...(record["reversible"] === true ? { fileMutationReversible: true } : {}),
    ...(postcondition ? { fileMutationPostcondition: postcondition } : {}),
  };
}
