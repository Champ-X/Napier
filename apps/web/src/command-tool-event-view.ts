export interface CommandToolEventTraceView {
  commandRuntime?: "node";
  commandStatus?: "succeeded" | "failed" | "timed_out" | "output_capped";
  commandArgumentCount?: number;
  commandExitCode?: number;
  commandTimeoutMs?: number;
  commandOutputLimitChars?: number;
  commandWorkspaceAccess?: "read_only";
  commandNetworkAccess?: "denied";
  commandSha256?: string;
  commandResultSha256?: string;
  commandExecutableSha256?: string;
  commandArgumentSetSha256?: string;
  commandEnvironmentSha256?: string;
  commandResourceLimitsSha256?: string;
  commandCwdPathSha256?: string;
  commandStdoutSha256?: string;
  commandStderrSha256?: string;
  commandStdoutTruncated?: boolean;
  commandStderrTruncated?: boolean;
}

export function commandToolEventEvidence(
  value: unknown,
): CommandToolEventTraceView | undefined {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const runtime = record["runtime"] === "node" ? record["runtime"] : undefined;
  const status =
    record["status"] === "succeeded" ||
    record["status"] === "failed" ||
    record["status"] === "timed_out" ||
    record["status"] === "output_capped"
      ? record["status"]
      : undefined;
  const argumentCount = integerInRange(record["argumentCount"], 0, 64);
  if (!runtime || !status || argumentCount === undefined) return undefined;
  const exitCode = integerInRange(record["exitCode"], -1, 255);
  const timeoutMs = integerInRange(record["timeoutMs"], 1_000, 120_000);
  const outputLimitChars = integerInRange(
    record["outputLimitChars"],
    1,
    1_000_000,
  );
  return {
    commandRuntime: runtime,
    commandStatus: status,
    commandArgumentCount: argumentCount,
    ...(exitCode !== undefined ? { commandExitCode: exitCode } : {}),
    ...(timeoutMs !== undefined ? { commandTimeoutMs: timeoutMs } : {}),
    ...(outputLimitChars !== undefined
      ? { commandOutputLimitChars: outputLimitChars }
      : {}),
    ...(record["workspaceAccess"] === "read_only"
      ? { commandWorkspaceAccess: "read_only" as const }
      : {}),
    ...(record["networkAccess"] === "denied"
      ? { commandNetworkAccess: "denied" as const }
      : {}),
    ...commandHashes(record),
    ...(record["stdoutTruncated"] === true
      ? { commandStdoutTruncated: true }
      : {}),
    ...(record["stderrTruncated"] === true
      ? { commandStderrTruncated: true }
      : {}),
  };
}

export function commandToolEventSummaryParts(
  view: CommandToolEventTraceView,
): string[] {
  return [
    ...(view.commandRuntime && view.commandStatus
      ? [`command ${view.commandRuntime} ${view.commandStatus}`]
      : []),
    ...(view.commandArgumentCount !== undefined
      ? [`args ${view.commandArgumentCount}`]
      : []),
    ...(view.commandExitCode !== undefined
      ? [`exit ${view.commandExitCode}`]
      : []),
    ...(view.commandTimeoutMs !== undefined
      ? [`timeout ${view.commandTimeoutMs}ms`]
      : []),
    ...(view.commandOutputLimitChars !== undefined
      ? [`output-limit ${view.commandOutputLimitChars}`]
      : []),
    ...(view.commandWorkspaceAccess
      ? [`workspace ${view.commandWorkspaceAccess}`]
      : []),
    ...(view.commandNetworkAccess
      ? [`network ${view.commandNetworkAccess}`]
      : []),
    ...(view.commandSha256
      ? [`command ${view.commandSha256.slice(0, 12)}`]
      : []),
    ...(view.commandResultSha256
      ? [`result ${view.commandResultSha256.slice(0, 12)}`]
      : []),
    ...(view.commandExecutableSha256
      ? [`executable ${view.commandExecutableSha256.slice(0, 12)}`]
      : []),
    ...(view.commandArgumentSetSha256
      ? [`argv ${view.commandArgumentSetSha256.slice(0, 12)}`]
      : []),
    ...(view.commandEnvironmentSha256
      ? [`environment ${view.commandEnvironmentSha256.slice(0, 12)}`]
      : []),
    ...(view.commandResourceLimitsSha256
      ? [`limits ${view.commandResourceLimitsSha256.slice(0, 12)}`]
      : []),
    ...(view.commandCwdPathSha256
      ? [`cwd ${view.commandCwdPathSha256.slice(0, 12)}`]
      : []),
    ...(view.commandStdoutSha256
      ? [`stdout ${view.commandStdoutSha256.slice(0, 12)}`]
      : []),
    ...(view.commandStderrSha256
      ? [`stderr ${view.commandStderrSha256.slice(0, 12)}`]
      : []),
    ...(view.commandStdoutTruncated ? ["stdout-truncated"] : []),
    ...(view.commandStderrTruncated ? ["stderr-truncated"] : []),
  ];
}

function commandHashes(
  record: Record<string, unknown>,
): CommandToolEventTraceView {
  const commandSha256 = sha256(record["commandSha256"]);
  const resultSha256 = sha256(record["resultSha256"]);
  const executableSha256 = sha256(record["executableSha256"]);
  const argumentSetSha256 = sha256(record["argumentSetSha256"]);
  const environmentSha256 = sha256(record["environmentSha256"]);
  const resourceLimitsSha256 = sha256(record["resourceLimitsSha256"]);
  const cwdPathSha256 = sha256(record["cwdPathSha256"]);
  const stdoutSha256 = sha256(record["stdoutSha256"]);
  const stderrSha256 = sha256(record["stderrSha256"]);
  return {
    ...(commandSha256 ? { commandSha256 } : {}),
    ...(resultSha256 ? { commandResultSha256: resultSha256 } : {}),
    ...(executableSha256 ? { commandExecutableSha256: executableSha256 } : {}),
    ...(argumentSetSha256
      ? { commandArgumentSetSha256: argumentSetSha256 }
      : {}),
    ...(environmentSha256
      ? { commandEnvironmentSha256: environmentSha256 }
      : {}),
    ...(resourceLimitsSha256
      ? { commandResourceLimitsSha256: resourceLimitsSha256 }
      : {}),
    ...(cwdPathSha256 ? { commandCwdPathSha256: cwdPathSha256 } : {}),
    ...(stdoutSha256 ? { commandStdoutSha256: stdoutSha256 } : {}),
    ...(stderrSha256 ? { commandStderrSha256: stderrSha256 } : {}),
  };
}

function sha256(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)
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
