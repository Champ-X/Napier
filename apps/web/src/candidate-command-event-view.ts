export interface CandidateCommandEventEvidence {
  attemptCount?: number;
  freshCount?: number;
  succeededCount?: number;
  failedCount?: number;
  staleCount?: number;
  setSha256?: string;
}

export function candidateCommandEventEvidence(
  input: Record<string, unknown>,
): CandidateCommandEventEvidence | null {
  const fields = [
    input["candidateCommandAttemptCount"],
    input["candidateCommandFreshCount"],
    input["candidateCommandSucceededCount"],
    input["candidateCommandFailedCount"],
    input["candidateCommandStaleCount"],
    input["candidateCommandSetSha256"],
  ];
  if (fields.every((value) => value === undefined)) return {};
  const attemptCount = integer(fields[0]);
  const freshCount = integer(fields[1]);
  const succeededCount = integer(fields[2]);
  const failedCount = integer(fields[3]);
  const staleCount = integer(fields[4]);
  const setSha256 = hash(fields[5]);
  if (
    attemptCount === undefined ||
    freshCount === undefined ||
    succeededCount === undefined ||
    failedCount === undefined ||
    staleCount === undefined ||
    !setSha256 ||
    succeededCount + failedCount !== freshCount ||
    freshCount + staleCount !== attemptCount
  ) {
    return null;
  }
  return {
    attemptCount,
    freshCount,
    succeededCount,
    failedCount,
    staleCount,
    setSha256,
  };
}

function integer(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 8
    ? Number(value)
    : undefined;
}

function hash(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)
    ? value
    : undefined;
}
