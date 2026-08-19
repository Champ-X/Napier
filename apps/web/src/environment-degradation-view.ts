import type { RunEvent, ThreadDetail } from "@napier/contracts";

export interface EnvironmentDegradationView {
  runId: string;
  activeToolCount: number;
  configuredToolCount: number;
  omittedToolCount: number;
  sandboxId: string;
  repairCommand: string;
  contentSha256: string;
}

export function environmentDegradationView(
  detail: Pick<ThreadDetail, "thread" | "runs" | "events"> | undefined,
): EnvironmentDegradationView | undefined {
  if (!detail) return undefined;
  const runId = detail.thread.currentRunId ?? detail.runs.at(-1)?.id;
  if (!runId) return undefined;
  const event = detail.events.findLast(
    (candidate) =>
      candidate.runId === runId &&
      candidate.type === "run.environment.negotiated",
  );
  return event ? parseEnvironmentDegradationEvent(event) : undefined;
}

export function parseEnvironmentDegradationEvent(
  event: Pick<RunEvent, "runId" | "payload">,
): EnvironmentDegradationView | undefined {
  const payload = record(event.payload);
  const activeToolCount = integer(payload?.["activeToolCount"]);
  const configuredToolCount = integer(payload?.["configuredToolCount"]);
  const active = stringArray(payload?.["activeToolNames"]);
  const omitted = stringArray(payload?.["omittedToolNames"]);
  const sandboxId = text(payload?.["sandboxId"]);
  const repairCommand = text(payload?.["repairCommand"]);
  const contentSha256 = hash(payload?.["contentSha256"]);
  if (
    payload?.["kind"] !== "napier.environment-capability-negotiation" ||
    payload["schemaVersion"] !== 1 ||
    payload["status"] !== "degraded_read_only" ||
    payload["executionMode"] !== "environment_degraded_read_only" ||
    payload["reason"] !== "sandbox_unavailable" ||
    activeToolCount === undefined ||
    configuredToolCount === undefined ||
    configuredToolCount < activeToolCount ||
    !active ||
    active.length !== activeToolCount ||
    !omitted ||
    omitted.length !== configuredToolCount - activeToolCount ||
    !sandboxId ||
    !repairCommand ||
    !contentSha256
  ) {
    return undefined;
  }
  return {
    runId: event.runId,
    activeToolCount,
    configuredToolCount,
    omittedToolCount: omitted.length,
    sandboxId,
    repairCommand,
    contentSha256,
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function integer(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Number(value)
    : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function hash(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)
    ? value
    : undefined;
}
