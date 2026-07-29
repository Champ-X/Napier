import type { RunEvent } from "@napier/contracts";

const EVENT = /^workspace\.process\.(started|settled|interrupted)$/u;
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
  const processId = stringMatch(event.payload["id"], PROCESS_ID);
  const status = stringMatch(event.payload["status"], STATUS);
  const runtime = event.payload["runtime"] === "node" ? "node" : undefined;
  const argumentCount = integer(event.payload["argumentCount"]);
  const stdoutChars = integer(event.payload["stdoutChars"]);
  const stderrChars = integer(event.payload["stderrChars"]);
  const nextCursor = integer(event.payload["nextCursor"]);
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
