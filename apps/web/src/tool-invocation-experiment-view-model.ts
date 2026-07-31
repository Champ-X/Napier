import type {
  RunEvent,
  RunRecord,
  ToolInvocationCapsuleReceipt,
  ToolInvocationExperimentComparison,
  ToolInvocationExperimentResultFrame,
} from "@napier/contracts";

export interface ToolInvocationCheckpointView {
  key: string;
  runId: string;
  callId: string;
  capsuleEventSeq: number;
  runIndex: number;
  status: RunRecord["status"];
  toolName: string;
  capsuleBytes: number;
  createdAt: string;
}

export interface ToolInvocationExperimentComparisonView {
  sourceStatus: string;
  targetStatus: string;
  toolName: string;
  outputChanged: boolean;
  durationMsDelta: number;
  outputBytesDelta: number;
  sourceOutputBytes: number;
  targetOutputBytes: number;
}

export function toolInvocationCheckpoints(
  runs: RunRecord[],
  events: RunEvent[],
): ToolInvocationCheckpointView[] {
  const runIndexes = new Map(runs.map((run, index) => [run.id, index + 1]));
  const runsById = new Map(runs.map((run) => [run.id, run]));
  return events.flatMap((event): ToolInvocationCheckpointView[] => {
    const run = runsById.get(event.runId);
    const receipt = toolInvocationReceipt(event);
    if (
      !receipt ||
      !run ||
      !terminalStatus(run.status) ||
      !run.finishedAt ||
      !run.configuration ||
      !hasCompletedCall(events, run.id, event.seq, receipt)
    ) {
      return [];
    }
    return [
      {
        key: `${run.id}:${receipt.callId}:${String(event.seq)}`,
        runId: run.id,
        callId: receipt.callId,
        capsuleEventSeq: event.seq,
        runIndex: runIndexes.get(run.id) ?? 0,
        status: run.status,
        toolName: receipt.toolName,
        capsuleBytes: receipt.capsuleBytes,
        createdAt: event.createdAt,
      },
    ];
  });
}

export function projectToolInvocationExperimentComparison(
  comparison: ToolInvocationExperimentComparison,
): ToolInvocationExperimentComparisonView {
  return {
    sourceStatus: comparison.source.status,
    targetStatus: comparison.target.status,
    toolName: comparison.source.toolName,
    outputChanged: comparison.outputChanged,
    durationMsDelta: comparison.durationMsDelta,
    outputBytesDelta:
      comparison.target.outputBytes - comparison.source.outputBytes,
    sourceOutputBytes: comparison.source.outputBytes,
    targetOutputBytes: comparison.target.outputBytes,
  };
}

export function toolInvocationExperimentResultFilename(
  frame: ToolInvocationExperimentResultFrame,
): string {
  return `napier-tool-experiment-${safeSegment(
    frame.targetRunId,
    "run",
  )}-${frame.contentSha256.slice(0, 16)}.json`;
}

function toolInvocationReceipt(
  event: RunEvent,
): ToolInvocationCapsuleReceipt | undefined {
  if (event.type !== "context.tool_invocation") return undefined;
  const value = record(event.payload);
  if (
    !value ||
    !exactKeys(value, [
      "kind",
      "schemaVersion",
      "callId",
      "toolName",
      "effect",
      "toolDefinitionSha256",
      "argumentsSha256",
      "workspaceScopeSha256",
      "capsuleSha256",
      "capsuleBytes",
      "storage",
      "contentSha256",
    ]) ||
    value["kind"] !== "napier.tool-invocation-capsule-receipt" ||
    value["schemaVersion"] !== 1 ||
    !callId(value["callId"]) ||
    typeof value["toolName"] !== "string" ||
    !/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u.test(value["toolName"]) ||
    value["effect"] !== "read" ||
    !hashFields(value, [
      "toolDefinitionSha256",
      "argumentsSha256",
      "workspaceScopeSha256",
      "capsuleSha256",
      "contentSha256",
    ]) ||
    !positiveInteger(value["capsuleBytes"]) ||
    value["capsuleBytes"] > 512 * 1024 ||
    value["storage"] !== "local_only"
  ) {
    return undefined;
  }
  return structuredClone(value) as unknown as ToolInvocationCapsuleReceipt;
}

function hasCompletedCall(
  events: RunEvent[],
  runId: string,
  capsuleEventSeq: number,
  receipt: ToolInvocationCapsuleReceipt,
): boolean {
  return (
    events.filter((event) => {
      const payload = record(event.payload);
      return (
        event.runId === runId &&
        event.seq > capsuleEventSeq &&
        event.type === "tool.completed" &&
        payload?.["callId"] === receipt.callId &&
        payload["toolName"] === receipt.toolName &&
        payload["status"] === "completed" &&
        hash(payload["outputTextSha256"]) &&
        nonNegativeInteger(payload["outputTextBytes"])
      );
    }).length === 1
  );
}

function terminalStatus(status: RunRecord["status"]): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "interrupted"
  );
}

function safeSegment(value: string, fallback: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80);
  return normalized || fallback;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return (
    Object.keys(value).length === keys.length &&
    Object.keys(value).every((key) => keys.includes(key))
  );
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function callId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function hashFields(
  value: Record<string, unknown>,
  fields: readonly string[],
): boolean {
  return fields.every((field) => hash(value[field]));
}

function hash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}
