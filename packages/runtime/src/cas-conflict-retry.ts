export type CasConflictWait = (
  delayMs: number,
  signal?: AbortSignal,
) => Promise<void>;

export interface CasConflictRetryOptions {
  /** Total executions, including the initial optimistic attempt. */
  maxAttempts?: number;
  /** Exponential backoff base. Set to zero only in deterministic tests. */
  initialDelayMs?: number;
  /** Per-conflict delay ceiling. */
  maxDelayMs?: number;
  /** Aggregate delay ceiling across the whole retry episode. */
  maxTotalDelayMs?: number;
  /** Symmetric delay jitter in the inclusive range 0..1. */
  jitterRatio?: number;
  signal?: AbortSignal;
  /** Injectable so virtual-clock tests never sleep. */
  wait?: CasConflictWait;
  /** Injectable so jitter schedules are deterministic in tests. */
  random?: () => number;
}

export interface CasConflictRetryInput<T> {
  operation: (attempt: number) => Promise<T>;
  isConflict: (error: unknown) => boolean;
  exhaustedMessage: string;
  options?: Readonly<CasConflictRetryOptions>;
}

export class CasConflictRetryExhaustedError extends Error {
  override readonly name = "CasConflictRetryExhaustedError";

  constructor(
    message: string,
    readonly attempts: number,
    lastConflict: unknown,
  ) {
    super(message, { cause: lastConflict });
  }
}

const DEFAULT_MAX_ATTEMPTS = 8;
const DEFAULT_INITIAL_DELAY_MS = 1;
const DEFAULT_MAX_DELAY_MS = 32;
const DEFAULT_MAX_TOTAL_DELAY_MS = 100;
const DEFAULT_JITTER_RATIO = 0.2;

/**
 * Retries only an explicitly classified optimistic-CAS conflict.
 *
 * A conflict means another valid writer made progress. Yielding with bounded
 * backoff lets that transaction finish and prevents one worker from starving
 * the winner with an immediate read/CAS loop. Every non-conflict is rethrown
 * unchanged, and exhaustion remains fail-closed with the last conflict as its
 * cause; this is therefore a liveness mechanism, never error recovery.
 */
export async function retryCasConflict<T>(
  input: CasConflictRetryInput<T>,
): Promise<T> {
  const policy = resolvePolicy(input.options);
  let totalDelayMs = 0;
  let lastConflict: unknown;
  let attempts = 0;

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    policy.signal?.throwIfAborted();
    attempts = attempt;
    try {
      return await input.operation(attempt);
    } catch (error) {
      if (!input.isConflict(error)) throw error;
      lastConflict = error;
      if (attempt === policy.maxAttempts) break;

      const remainingDelayMs = policy.maxTotalDelayMs - totalDelayMs;
      if (remainingDelayMs <= 0) break;
      const delayMs = Math.min(
        conflictDelayMs(policy, attempt),
        remainingDelayMs,
      );
      await policy.wait(delayMs, policy.signal);
      totalDelayMs += delayMs;
      policy.signal?.throwIfAborted();
    }
  }

  throw new CasConflictRetryExhaustedError(
    input.exhaustedMessage,
    attempts,
    lastConflict,
  );
}

interface ResolvedCasConflictRetryPolicy {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  maxTotalDelayMs: number;
  jitterRatio: number;
  signal?: AbortSignal;
  wait: CasConflictWait;
  random: () => number;
}

function resolvePolicy(
  options: Readonly<CasConflictRetryOptions> | undefined,
): ResolvedCasConflictRetryPolicy {
  const maxAttempts = integerOption(
    options?.maxAttempts,
    DEFAULT_MAX_ATTEMPTS,
    1,
    32,
    "maxAttempts",
  );
  const initialDelayMs = integerOption(
    options?.initialDelayMs,
    DEFAULT_INITIAL_DELAY_MS,
    0,
    1_000,
    "initialDelayMs",
  );
  const maxDelayMs = integerOption(
    options?.maxDelayMs,
    DEFAULT_MAX_DELAY_MS,
    0,
    5_000,
    "maxDelayMs",
  );
  const maxTotalDelayMs = integerOption(
    options?.maxTotalDelayMs,
    DEFAULT_MAX_TOTAL_DELAY_MS,
    0,
    30_000,
    "maxTotalDelayMs",
  );
  const jitterRatio = options?.jitterRatio ?? DEFAULT_JITTER_RATIO;
  if (!Number.isFinite(jitterRatio) || jitterRatio < 0 || jitterRatio > 1) {
    throw new Error("CAS conflict retry jitterRatio must be between 0 and 1");
  }
  if (initialDelayMs > maxDelayMs) {
    throw new Error(
      "CAS conflict retry initialDelayMs cannot exceed maxDelayMs",
    );
  }
  return {
    maxAttempts,
    initialDelayMs,
    maxDelayMs,
    maxTotalDelayMs,
    jitterRatio,
    ...(options?.signal ? { signal: options.signal } : {}),
    wait: options?.wait ?? waitForRetryDelay,
    random: options?.random ?? Math.random,
  };
}

function conflictDelayMs(
  policy: ResolvedCasConflictRetryPolicy,
  failedAttempt: number,
): number {
  const exponential = Math.min(
    policy.maxDelayMs,
    policy.initialDelayMs * 2 ** Math.min(failedAttempt - 1, 30),
  );
  if (exponential === 0 || policy.jitterRatio === 0) return exponential;
  const sample = policy.random();
  if (!Number.isFinite(sample) || sample < 0 || sample > 1) {
    throw new Error("CAS conflict retry random() must return a value in 0..1");
  }
  const multiplier = 1 + (sample * 2 - 1) * policy.jitterRatio;
  return Math.max(
    0,
    Math.min(policy.maxDelayMs, Math.round(exponential * multiplier)),
  );
}

function integerOption(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  const resolved = value ?? fallback;
  if (
    !Number.isSafeInteger(resolved) ||
    resolved < minimum ||
    resolved > maximum
  ) {
    throw new Error(
      `CAS conflict retry ${name} must be an integer from ${String(minimum)} to ${String(maximum)}`,
    );
  }
  return resolved;
}

async function waitForRetryDelay(
  delayMs: number,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  if (delayMs === 0) {
    await Promise.resolve();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const finish = (): void => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const abort = (): void => {
      clearTimeout(timeout);
      reject(
        signal?.reason ?? new DOMException("Operation aborted", "AbortError"),
      );
    };
    const timeout = setTimeout(finish, delayMs);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
