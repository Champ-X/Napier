export async function waitForBrowserSessionTurn(
  previous: Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  if (!signal) {
    await previous.catch(() => undefined);
    return;
  }
  assertBrowserSessionNotAborted(signal);
  let abort!: () => void;
  try {
    await Promise.race([
      previous.catch(() => undefined),
      new Promise<never>((_, reject) => {
        abort = () =>
          reject(new Error("Browser Session operation was cancelled"));
        signal.addEventListener("abort", abort, { once: true });
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

export function assertBrowserSessionNotAborted(
  signal: AbortSignal | undefined,
): void {
  if (signal?.aborted) {
    throw new Error("Browser Session operation was cancelled");
  }
}
