import type { RunEvent } from "@napier/contracts";

export interface SkillDataAnalysisProof {
  inspectSeq: number;
  transformSeq: number;
}

export function skillDataAnalysisProof(
  events: readonly RunEvent[],
  terminalSeq: number,
): SkillDataAnalysisProof | undefined {
  const inspect = events.find((event) => {
    const payload = record(event.payload);
    const details = record(
      payload?.toolName === "inspect_data" && payload.details,
    );
    return (
      event.seq > terminalSeq &&
      event.type === "tool.completed" &&
      payload?.status === "completed" &&
      sha(details?.sha256) &&
      details?.truncated === false
    );
  });
  const inspectedSha256 = record(record(inspect?.payload)?.details)?.sha256;
  const transform = events.find((event) => {
    const payload = record(event.payload);
    const details = record(
      payload?.toolName === "data_frame" && payload.details,
    );
    return (
      event.seq > (inspect?.seq ?? terminalSeq) &&
      event.type === "tool.completed" &&
      payload?.status === "completed" &&
      details?.kind === "napier.data-frame" &&
      details?.action === "transform" &&
      details?.sourceSha256 === inspectedSha256 &&
      integer(details?.operationCount, 1, 64) &&
      integer(details?.rowCount, 0, Number.MAX_SAFE_INTEGER) &&
      sha(details?.resultSha256)
    );
  });
  return inspect && transform
    ? { inspectSeq: inspect.seq, transformSeq: transform.seq }
    : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function sha(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function integer(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    Number.isSafeInteger(value) &&
    Number(value) >= minimum &&
    Number(value) <= maximum
  );
}
