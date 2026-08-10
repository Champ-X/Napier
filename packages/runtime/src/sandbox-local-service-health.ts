import { request } from "node:http";

import type { SandboxLocalServiceRequest } from "./sandbox-types.js";

export const LOCAL_SERVICE_READY_TIMEOUT_MS = 5_000;
export const LOCAL_SERVICE_HTTP_ATTEMPT_TIMEOUT_MS = 500;
const LOCAL_SERVICE_RETRY_MS = 50;
const LOCAL_SERVICE_CLOSE_TIMEOUT_MS = 2_000;

export async function waitForLoopbackHttpService(input: {
  hostPort: number;
  service: SandboxLocalServiceRequest;
  exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  signal?: AbortSignal;
}): Promise<void> {
  const deadline = Date.now() + LOCAL_SERVICE_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    input.signal?.throwIfAborted();
    const outcome = await Promise.race([
      probeLoopbackHttp(input.hostPort, input.service.healthPath).then(
        () => "ready" as const,
        () => "retry" as const,
      ),
      input.exit.then(() => "exited" as const),
    ]);
    if (outcome === "ready") return;
    if (outcome === "exited") {
      throw new Error("Local service process exited before readiness");
    }
    await waitForRetry(input.exit, input.signal);
  }
  throw new Error("Local service readiness probe timed out");
}

export async function waitForLoopbackHttpServiceClosed(
  hostPort: number,
): Promise<void> {
  const deadline = Date.now() + LOCAL_SERVICE_CLOSE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      await probeLoopbackHttp(hostPort, "/");
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, LOCAL_SERVICE_RETRY_MS));
  }
  throw new Error("Local service loopback port remained open after cleanup");
}

function probeLoopbackHttp(port: number, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const probe = request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "GET",
        headers: { connection: "close" },
        timeout: LOCAL_SERVICE_HTTP_ATTEMPT_TIMEOUT_MS,
      },
      (response) => {
        if (response.statusCode === undefined) {
          response.destroy();
          reject(new Error("Local service returned no HTTP status"));
          return;
        }
        response.destroy();
        resolve();
      },
    );
    probe.once("timeout", () =>
      probe.destroy(new Error("Local service HTTP probe timed out")),
    );
    probe.once("error", reject);
    probe.end();
  });
}

async function waitForRetry(
  exit: Promise<unknown>,
  signal: AbortSignal | undefined,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    };
    const abort = (): void =>
      finish(signal?.reason ?? new Error("Local service start was aborted"));
    const timer = setTimeout(() => finish(), LOCAL_SERVICE_RETRY_MS);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    void exit.then(() =>
      finish(new Error("Local service process exited before readiness")),
    );
  });
}
