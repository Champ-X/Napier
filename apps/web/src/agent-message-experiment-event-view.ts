import type { RunEvent } from "@napier/contracts";

const EVENT_TYPES = new Set([
  "agent.experiment.started",
  "agent.experiment.compared",
  "agent.experiment.failed",
]);
const RESOURCE_ID = /^[a-z][a-z0-9_-]{2,80}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const MODEL = /^[a-z][a-z0-9_-]{0,63}\/[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u;
const RUN_STATUS = new Set([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

export function agentMessageExperimentEventTraceSummary(
  event: RunEvent,
): string | undefined {
  if (!EVENT_TYPES.has(event.type) || !record(event.payload)) return undefined;
  const payload = event.payload;
  const sourceRunId = resourceId(payload["sourceRunId"]);
  const sourceMessageSeq = positiveInteger(payload["sourceMessageSeq"]);
  const previewSha256 = hash(payload["previewSha256"]);
  if (
    payload["schemaVersion"] !== 1 ||
    !sourceRunId ||
    sourceMessageSeq === undefined ||
    !previewSha256
  ) {
    return undefined;
  }
  const parts = [
    event.type.replaceAll(".", " "),
    `source-run ${sourceRunId.slice(-10)}`,
    `message ${String(sourceMessageSeq)}`,
    `preview ${previewSha256.slice(0, 12)}`,
  ];
  if (event.type === "agent.experiment.started") {
    const branchFromSeq = nonNegativeInteger(payload["branchFromSeq"]);
    const sourceModel = model(payload["sourceModel"]);
    const targetModel = model(payload["targetModel"]);
    const workspaceSha256 = hash(payload["candidateWorkspaceSnapshotSha256"]);
    const configurationSha256 = hash(payload["sourceRunConfigurationSha256"]);
    if (
      branchFromSeq === undefined ||
      branchFromSeq + 1 !== sourceMessageSeq ||
      !sourceModel ||
      !targetModel ||
      !workspaceSha256 ||
      !configurationSha256 ||
      payload["targetExecutionMode"] !== "agent_experiment_read_only"
    ) {
      return undefined;
    }
    parts.push(
      `${sourceModel} -> ${targetModel}`,
      "read-only",
      `workspace ${workspaceSha256.slice(0, 12)}`,
      `configuration ${configurationSha256.slice(0, 12)}`,
    );
  } else if (event.type === "agent.experiment.compared") {
    const targetRunId = resourceId(payload["targetRunId"]);
    const comparisonSha256 = hash(payload["comparisonSha256"]);
    const sourceStatus = runStatus(payload["sourceStatus"]);
    const targetStatus = runStatus(payload["targetStatus"]);
    const durationMsDelta = finiteNumber(payload["durationMsDelta"]);
    const inputTokensDelta = finiteNumber(payload["inputTokensDelta"]);
    const outputTokensDelta = finiteNumber(payload["outputTokensDelta"]);
    const costUsdDelta = finiteNumber(payload["costUsdDelta"]);
    const toolCallCountDelta = finiteNumber(payload["toolCallCountDelta"]);
    const changedFieldCount = nonNegativeInteger(
      payload["changedConfigurationFieldCount"],
    );
    if (
      !targetRunId ||
      !comparisonSha256 ||
      !sourceStatus ||
      !targetStatus ||
      typeof payload["outputChanged"] !== "boolean" ||
      durationMsDelta === undefined ||
      inputTokensDelta === undefined ||
      outputTokensDelta === undefined ||
      costUsdDelta === undefined ||
      toolCallCountDelta === undefined ||
      changedFieldCount === undefined
    ) {
      return undefined;
    }
    parts.push(
      `${sourceStatus} -> ${targetStatus}`,
      payload["outputChanged"] ? "output changed" : "output unchanged",
      `duration ${signed(durationMsDelta)}ms`,
      `tokens ${signed(inputTokensDelta + outputTokensDelta)}`,
      `tools ${signed(toolCallCountDelta)}`,
      `cost ${signed(costUsdDelta, 6)} USD`,
      `configuration-fields ${String(changedFieldCount)}`,
      `comparison ${comparisonSha256.slice(0, 12)}`,
      `target-run ${targetRunId.slice(-10)}`,
    );
  } else {
    const diagnosticSha256 = hash(payload["diagnosticSha256"]);
    const targetThreadId = resourceId(payload["targetThreadId"]);
    const targetRunId =
      payload["targetRunId"] === undefined
        ? undefined
        : resourceId(payload["targetRunId"]);
    if (
      !diagnosticSha256 ||
      !targetThreadId ||
      (payload["targetRunId"] !== undefined && !targetRunId)
    ) {
      return undefined;
    }
    parts.push(
      `target-thread ${targetThreadId.slice(-10)}`,
      ...(targetRunId ? [`target-run ${targetRunId.slice(-10)}`] : []),
      `diagnostic ${diagnosticSha256.slice(0, 12)}`,
    );
  }
  return parts.join(" / ");
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function resourceId(value: unknown): string | undefined {
  return typeof value === "string" && RESOURCE_ID.test(value)
    ? value
    : undefined;
}

function hash(value: unknown): string | undefined {
  return typeof value === "string" && HASH.test(value) ? value : undefined;
}

function model(value: unknown): string | undefined {
  return typeof value === "string" && MODEL.test(value) ? value : undefined;
}

function runStatus(value: unknown): string | undefined {
  return typeof value === "string" && RUN_STATUS.has(value) ? value : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) > 0
    ? Number(value)
    : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Number(value)
    : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function signed(value: number, fractionDigits?: number): string {
  const text =
    fractionDigits === undefined
      ? String(value)
      : value.toFixed(fractionDigits);
  return value > 0 ? `+${text}` : text;
}
