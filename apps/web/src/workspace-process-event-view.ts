import type { RunEvent } from "@napier/contracts";

const EVENT =
  /^workspace\.process\.(started|input|resized|settled|interrupted)$/u;
const PROCESS_ID = /^process_[a-z0-9]{8,80}$/u;
const STATUS =
  /^(running|succeeded|failed|timed_out|output_capped|cancelled|interrupted)$/u;
const DELTA_STATUS = /^(unchanged|changed|indeterminate)$/u;
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
  const processId = stringMatch(event.payload["id"], PROCESS_ID);
  const status = stringMatch(event.payload["status"], STATUS);
  const runtime =
    event.payload["runtime"] === "node" || event.payload["runtime"] === "python"
      ? event.payload["runtime"]
      : undefined;
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
  return [
    `process / ${event.type.slice("workspace.process.".length)}`,
    ...(processId ? [`id ${processId.slice(-10)}`] : []),
    ...(status ? [`status ${status}`] : []),
    ...(runtime ? [`runtime ${runtime}`] : []),
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
      ? [`changed-files ${workspaceChangedFileCount}`]
      : []),
    ...(workspaceChangedPathSetSha256
      ? [`changed-paths ${workspaceChangedPathSetSha256.slice(0, 12)}`]
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

function stringMatch(value: unknown, pattern: RegExp): string | undefined {
  return typeof value === "string" && pattern.test(value) ? value : undefined;
}

function integer(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}
