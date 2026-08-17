export async function abortBrowserSessionOperation<T>(
  operation: Promise<T>,
  signal: AbortSignal | undefined,
  onAbort: () => Promise<void>,
): Promise<T> {
  if (!signal) return operation;
  assertNotAborted(signal);
  let abort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => {
      void onAbort().finally(() =>
        reject(new Error("Browser Session operation was cancelled")),
      );
    };
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([operation, cancelled]);
  } finally {
    signal.removeEventListener("abort", abort);
    void operation.catch(() => undefined);
  }
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error("Browser Session operation was cancelled");
  }
}
