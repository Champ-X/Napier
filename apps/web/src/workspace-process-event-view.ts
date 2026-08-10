import type { JsonValue, RunEvent } from "@napier/contracts";

const EVENT =
  /^workspace\.process\.(started|input|resized|settled|interrupted|rollback_started|rolled_back)$/u;
const PROCESS_ID = /^process_[a-z0-9]{8,80}$/u;
const STATUS =
  /^(running|succeeded|failed|timed_out|output_capped|cancelled|interrupted)$/u;
const DELTA_STATUS = /^(unchanged|changed|indeterminate)$/u;
const WRITE_SCOPE_STATUS = /^(within_scope|outside_scope|indeterminate)$/u;
const ROLLBACK_STATUS = /^(restored|reverted|indeterminate)$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

export function workspaceProcessEventTraceSummary(
  event: RunEvent,
): string | undefined {
  if (!event.type.startsWith("workspace.process.")) return undefined;
  if (
    !EVENT.test(event.type) ||
    !event.payload ||
    typeof event.payload !== "object" ||
    Array.isArray(event.payload)
  ) {
    return "process receipt";
  }
  if (event.type === "workspace.process.input") {
    const processId = stringMatch(event.payload["processId"], PROCESS_ID);
    const sequence = integer(event.payload["sequence"]);
    const inputBytes = integer(event.payload["inputBytes"]);
    const totalInputBytes = integer(event.payload["totalInputBytes"]);
    const inputSha256 = stringMatch(event.payload["inputSha256"], SHA256);
    const cumulativeInputSha256 = stringMatch(
      event.payload["cumulativeInputSha256"],
      SHA256,
    );
    return [
      "process / input",
      ...(processId ? [`id ${processId.slice(-10)}`] : []),
      ...(sequence !== undefined ? [`sequence ${sequence}`] : []),
      ...(event.payload["initiatedBy"] === "agent" ||
      event.payload["initiatedBy"] === "operator"
        ? [`by ${event.payload["initiatedBy"]}`]
        : []),
      ...(inputBytes !== undefined ? [`bytes ${inputBytes}`] : []),
      ...(totalInputBytes !== undefined
        ? [`total-bytes ${totalInputBytes}`]
        : []),
      ...(inputSha256 ? [`input ${inputSha256.slice(0, 12)}`] : []),
      ...(cumulativeInputSha256
        ? [`cumulative ${cumulativeInputSha256.slice(0, 12)}`]
        : []),
      ...(event.payload["stdinClosed"] === true ? ["stdin-closed"] : []),
    ].join(" / ");
  }
  if (event.type === "workspace.process.resized") {
    const processId = stringMatch(event.payload["processId"], PROCESS_ID);
    const sequence = integer(event.payload["sequence"]);
    const columns = integer(event.payload["columns"]);
    const rows = integer(event.payload["rows"]);
    return [
      "process / resized",
      ...(processId ? [`id ${processId.slice(-10)}`] : []),
      ...(sequence !== undefined ? [`sequence ${sequence}`] : []),
      ...(event.payload["initiatedBy"] === "agent" ||
      event.payload["initiatedBy"] === "operator"
        ? [`by ${event.payload["initiatedBy"]}`]
        : []),
      ...(columns !== undefined && rows !== undefined
        ? [`size ${columns}x${rows}`]
        : []),
    ].join(" / ");
  }
  if (event.type === "workspace.process.rollback_started") {
    const processId = stringMatch(event.payload["processId"], PROCESS_ID);
    const scopeCount = integer(event.payload["scopeCount"]);
    const fileCount = integer(event.payload["fileCount"]);
    const directoryCount = integer(event.payload["directoryCount"]);
    const bytes = integer(event.payload["bytes"]);
    const preview = stringMatch(event.payload["previewSha256"], SHA256);
    const recovery = stringMatch(
      event.payload["recoverySnapshotSha256"],
      SHA256,
    );
    const expected = stringMatch(
      event.payload["expectedWorkspaceSha256"],
      SHA256,
    );
    return [
      "process / rollback-started",
      ...(processId ? [`id ${processId.slice(-10)}`] : []),
      ...(event.payload["initiatedBy"] === "operator" ||
      event.payload["initiatedBy"] === "automatic_compensation"
        ? [`by ${event.payload["initiatedBy"]}`]
        : []),
      ...(scopeCount !== undefined ? [`scopes ${scopeCount}`] : []),
      ...(fileCount !== undefined ? [`files ${fileCount}`] : []),
      ...(directoryCount !== undefined
        ? [`directories ${directoryCount}`]
        : []),
      ...(bytes !== undefined ? [`bytes ${bytes}`] : []),
      ...(preview ? [`preview ${preview.slice(0, 12)}`] : []),
      ...(recovery ? [`recovery ${recovery.slice(0, 12)}`] : []),
      ...(expected ? [`expected ${expected.slice(0, 12)}`] : []),
    ].join(" / ");
  }
  if (event.type === "workspace.process.rolled_back") {
    const processId = stringMatch(event.payload["processId"], PROCESS_ID);
    const status = stringMatch(event.payload["status"], ROLLBACK_STATUS);
    const scopeCount = integer(event.payload["scopeCount"]);
    const restoredScopeCount = integer(event.payload["restoredScopeCount"]);
    const fileCount = integer(event.payload["fileCount"]);
    const directoryCount = integer(event.payload["directoryCount"]);
    const bytes = integer(event.payload["bytes"]);
    const recovery = stringMatch(
      event.payload["recoverySnapshotSha256"],
      SHA256,
    );
    const expected = stringMatch(
      event.payload["expectedWorkspaceSha256"],
      SHA256,
    );
    const observed = stringMatch(
      event.payload["observedWorkspaceSha256"],
      SHA256,
    );
    const error = stringMatch(event.payload["errorSha256"], SHA256);
    return [
      "process / rolled-back",
      ...(processId ? [`id ${processId.slice(-10)}`] : []),
      ...(status ? [`status ${status}`] : []),
      ...(event.payload["initiatedBy"] === "operator" ||
      event.payload["initiatedBy"] === "automatic_compensation"
        ? [`by ${event.payload["initiatedBy"]}`]
        : []),
      ...(scopeCount !== undefined ? [`scopes ${scopeCount}`] : []),
      ...(restoredScopeCount !== undefined
        ? [`restored-scopes ${restoredScopeCount}`]
        : []),
      ...(fileCount !== undefined ? [`files ${fileCount}`] : []),
      ...(directoryCount !== undefined
        ? [`directories ${directoryCount}`]
        : []),
      ...(bytes !== undefined ? [`bytes ${bytes}`] : []),
      ...(event.payload["durable"] === true ? ["durable"] : []),
      ...(event.payload["rollbackVerified"] === true
        ? ["rollback-verified"]
        : []),
      ...(event.payload["cancellationObserved"] === true
        ? ["cancellation-observed"]
        : []),
      ...(recovery ? [`recovery ${recovery.slice(0, 12)}`] : []),
      ...(expected ? [`expected ${expected.slice(0, 12)}`] : []),
      ...(observed ? [`observed ${observed.slice(0, 12)}`] : []),
      ...(error ? [`error ${error.slice(0, 12)}`] : []),
    ].join(" / ");
  }
  const processId = stringMatch(event.payload["id"], PROCESS_ID);
  const status = stringMatch(event.payload["status"], STATUS);
  const runtime = processRuntime(event.payload);
  const argumentCount = integer(event.payload["argumentCount"]);
  const stdoutChars = integer(event.payload["stdoutChars"]);
  const stderrChars = integer(event.payload["stderrChars"]);
  const nextCursor = integer(event.payload["nextCursor"]);
  const stdinWriteCount = integer(event.payload["stdinWriteCount"]);
  const stdinBytes = integer(event.payload["stdinBytes"]);
  const stdinSha256 = stringMatch(event.payload["stdinSha256"], SHA256);
  const terminalColumns = integer(event.payload["terminalColumns"]);
  const terminalRows = integer(event.payload["terminalRows"]);
  const terminalResizeCount = integer(event.payload["terminalResizeCount"]);
  const commandSha256 = stringMatch(event.payload["commandSha256"], SHA256);
  const stdoutSha256 = stringMatch(event.payload["stdoutSha256"], SHA256);
  const stderrSha256 = stringMatch(event.payload["stderrSha256"], SHA256);
  const workspaceDeltaStatus = stringMatch(
    event.payload["workspaceDeltaStatus"],
    DELTA_STATUS,
  );
  const workspaceChangedFileCount = integer(
    event.payload["workspaceChangedFileCount"],
  );
  const workspaceChangedPathSetSha256 = stringMatch(
    event.payload["workspaceChangedPathSetSha256"],
    SHA256,
  );
  const writeScopeCount = integer(event.payload["writeScopeCount"]);
  const writeScopeSetSha256 = stringMatch(
    event.payload["writeScopeSetSha256"],
    SHA256,
  );
  const writePreviewSha256 = stringMatch(
    event.payload["writePreviewSha256"],
    SHA256,
  );
  const workspaceWriteScopeStatus = stringMatch(
    event.payload["workspaceWriteScopeStatus"],
    WRITE_SCOPE_STATUS,
  );
  return [
    `process / ${event.type.slice("workspace.process.".length)}`,
    ...(processId ? [`id ${processId.slice(-10)}`] : []),
    ...(status ? [`status ${status}`] : []),
    ...(runtime ? [`runtime ${runtime}`] : []),
    ...processIsolationTraceParts(event.payload),
    ...workspaceProcessLocalServiceTraceParts(event.payload),
    ...(writeScopeCount !== undefined
      ? [`write-scopes ${writeScopeCount}`]
      : []),
    ...(writeScopeSetSha256
      ? [`scope-set ${writeScopeSetSha256.slice(0, 12)}`]
      : []),
    ...(writePreviewSha256
      ? [`write-preview ${writePreviewSha256.slice(0, 12)}`]
      : []),
    ...(event.payload["failureRecovery"] === "restore_scopes"
      ? ["failure-recovery restore-scopes"]
      : []),
    ...(argumentCount !== undefined ? [`args ${argumentCount}`] : []),
    ...(stdoutChars !== undefined ? [`stdout-chars ${stdoutChars}`] : []),
    ...(stderrChars !== undefined ? [`stderr-chars ${stderrChars}`] : []),
    ...(nextCursor !== undefined ? [`cursor ${nextCursor}`] : []),
    ...(event.payload["stdinMode"] === "interactive"
      ? ["stdin interactive"]
      : []),
    ...(stdinWriteCount !== undefined
      ? [`stdin-writes ${stdinWriteCount}`]
      : []),
    ...(stdinBytes !== undefined ? [`stdin-bytes ${stdinBytes}`] : []),
    ...(stdinSha256 ? [`stdin ${stdinSha256.slice(0, 12)}`] : []),
    ...(event.payload["stdinOpen"] === true ? ["stdin-open"] : []),
    ...(event.payload["ioMode"] === "pty" ? ["io pty"] : []),
    ...(terminalColumns !== undefined && terminalRows !== undefined
      ? [`terminal ${terminalColumns}x${terminalRows}`]
      : []),
    ...(terminalResizeCount !== undefined
      ? [`resizes ${terminalResizeCount}`]
      : []),
    ...(commandSha256 ? [`command ${commandSha256.slice(0, 12)}`] : []),
    ...(stdoutSha256 ? [`stdout ${stdoutSha256.slice(0, 12)}`] : []),
    ...(stderrSha256 ? [`stderr ${stderrSha256.slice(0, 12)}`] : []),
    ...(workspaceDeltaStatus ? [`workspace ${workspaceDeltaStatus}`] : []),
    ...(workspaceDeltaStatus !== "indeterminate" &&
    workspaceChangedFileCount !== undefined
      ? [
          `${event.payload["workspaceAccess"] === "scoped_write" ? "changed-path-count" : "changed-files"} ${workspaceChangedFileCount}`,
        ]
      : []),
    ...(workspaceChangedPathSetSha256
      ? [`changed-paths ${workspaceChangedPathSetSha256.slice(0, 12)}`]
      : []),
    ...(workspaceWriteScopeStatus
      ? [`scope-status ${workspaceWriteScopeStatus}`]
      : []),
    ...(event.payload["stdoutTruncated"] === true ? ["stdout-truncated"] : []),
    ...(event.payload["stderrTruncated"] === true ? ["stderr-truncated"] : []),
    ...(event.payload["workspaceBeforeTruncated"] === true
      ? ["before-snapshot-truncated"]
      : []),
    ...(event.payload["workspaceAfterTruncated"] === true
      ? ["after-snapshot-truncated"]
      : []),
  ].join(" / ");
}

function processRuntime(
  payload: Record<string, JsonValue>,
): "node" | "python" | "shell" | undefined {
  const runtime = payload["runtime"];
  return runtime === "node" || runtime === "python" || runtime === "shell"
    ? runtime
    : undefined;
}

function processIsolationTraceParts(
  payload: Record<string, JsonValue>,
): string[] {
  const sandbox =
    typeof payload["sandbox"] === "string" ? payload["sandbox"] : undefined;
  const hostDirect = sandbox === "host-direct";
  return [
    ...(sandbox ? [`sandbox ${sandbox}`] : []),
    ...(hostDirect ? ["isolation none", "access policy not enforced"] : []),
    ...(!hostDirect && payload["workspaceAccess"] === "scoped_write"
      ? ["access scoped-write"]
      : !hostDirect && payload["workspaceAccess"] === "read_only"
        ? ["access read-only"]
        : []),
    ...(payload["networkAccess"] === "outbound_denied_loopback_service"
      ? ["outbound denied", "loopback service"]
      : payload["networkAccess"] === "denied"
        ? ["network denied"]
        : []),
  ];
}

function workspaceProcessLocalServiceTraceParts(
  payload: Record<string, JsonValue>,
): string[] {
  const service = record(payload["localService"])
    ? payload["localService"]
    : undefined;
  const identity = stringMatch(service?.["identitySha256"], SHA256);
  const hostPort = integer(service?.["hostPort"]);
  return [
    ...(service?.["status"] === "ready" || service?.["status"] === "closed"
      ? [`service ${service["status"]}`]
      : []),
    ...(hostPort !== undefined ? [`service-host-port ${hostPort}`] : []),
    ...(identity ? [`service ${identity.slice(0, 12)}`] : []),
  ];
}

function record(value: unknown): value is Record<string, JsonValue> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringMatch(value: unknown, pattern: RegExp): string | undefined {
  return typeof value === "string" && pattern.test(value) ? value : undefined;
}

function integer(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}
