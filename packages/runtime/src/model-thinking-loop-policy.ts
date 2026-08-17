export type ModelThinkingLoopReason =
  | "literal_repetition"
  | "near_paragraph_cluster"
  | "low_novelty_without_anchor"
  | "overplanning_headings"
  | "semantic_stall";

export interface ModelThinkingLoopEvidence {
  reason: ModelThinkingLoopReason;
  attempt: 1 | 2;
  observedBytes: number;
  observedThinkingChunks: number;
  repeatedUnitBytes: number;
  repeatedUnitSha256: string;
}

const MESSAGE =
  /^Model thinking-loop guard triggered: (literal_repetition|near_paragraph_cluster|low_novelty_without_anchor|overplanning_headings|semantic_stall) attempt=(1|2) bytes=(\d+) chunks=(\d+) unit_bytes=(\d+) unit_sha256=([a-f0-9]{64})\.$/u;

export class ModelThinkingLoopError extends Error {
  constructor(readonly evidence: ModelThinkingLoopEvidence) {
    super(thinkingLoopMessage(evidence));
    this.name = "ModelThinkingLoopError";
  }
}

export function parseModelThinkingLoopError(
  message: string | undefined,
): ModelThinkingLoopError | undefined {
  const match = message ? MESSAGE.exec(message) : undefined;
  if (!match) return undefined;
  const attempt = Number(match[2]);
  const observedBytes = Number(match[3]);
  const observedThinkingChunks = Number(match[4]);
  const repeatedUnitBytes = Number(match[5]);
  if (
    (attempt !== 1 && attempt !== 2) ||
    !positiveInteger(observedBytes) ||
    !positiveInteger(observedThinkingChunks) ||
    !positiveInteger(repeatedUnitBytes)
  ) {
    return undefined;
  }
  return new ModelThinkingLoopError({
    reason: match[1] as ModelThinkingLoopReason,
    attempt,
    observedBytes,
    observedThinkingChunks,
    repeatedUnitBytes,
    repeatedUnitSha256: match[6]!,
  });
}

function thinkingLoopMessage(evidence: ModelThinkingLoopEvidence): string {
  return `Model thinking-loop guard triggered: ${evidence.reason} attempt=${String(evidence.attempt)} bytes=${String(evidence.observedBytes)} chunks=${String(evidence.observedThinkingChunks)} unit_bytes=${String(evidence.repeatedUnitBytes)} unit_sha256=${evidence.repeatedUnitSha256}.`;
}

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}
