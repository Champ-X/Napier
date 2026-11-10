import { validWorkspaceRuntimeId } from "./workspace-runtime-identity.js";
import type { WorkspaceRuntimeRegistry } from "./workspace-runtime-registry.js";

export const WORKSPACE_RUNTIME_HEADER = "X-Napier-Workspace-Id";

interface WorkspaceRuntimeHttpOptions<T> {
  registry: WorkspaceRuntimeRegistry<T>;
  /** Legacy callers are pinned to the launch workspace, never a mutable view. */
  defaultWorkspaceId: string;
  fetch(runtime: T, request: Request): Response | Promise<Response>;
}

/** The outer router binds once, before parsing any thread/run/artifact ID. */
export function createWorkspaceRuntimeFetch<T>(options: WorkspaceRuntimeHttpOptions<T>) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase())) {
      return errorResponse("API host must be loopback", 403);
    }
    if (!url.pathname.startsWith("/api/")) return errorResponse("Unknown API path", 404);
    const scope = parseWorkspaceScope(url, request.headers, options.defaultWorkspaceId);
    if (typeof scope === "string") return errorResponse(scope, 400);
    let lease;
    try {
      lease = await options.registry.acquire(scope.workspaceId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errorResponse(message, message === "Unknown workspace runtime" ? 404 : 503);
    }
    try {
      const headers = new Headers(request.headers);
      headers.set(WORKSPACE_RUNTIME_HEADER, scope.workspaceId);
      const routed = new Request(url, new Request(request, { headers }));
      const response = await options.fetch(lease.runtime, routed);
      const responseHeaders = new Headers(response.headers);
      responseHeaders.set(WORKSPACE_RUNTIME_HEADER, scope.workspaceId);
      const keepExecution = request.method === "POST" &&
        response.headers.get("content-type")?.startsWith("text/event-stream") === true;
      const body = response.body
        ? retainResponseBody(response.body, request.signal, lease.release, keepExecution)
        : null;
      if (!body) lease.release();
      return new Response(body, {
        status: response.status, statusText: response.statusText, headers: responseHeaders,
      });
    } catch (error) {
      lease.release();
      throw error;
    }
  };
}

function parseWorkspaceScope(url: URL, headers: Headers, defaultWorkspaceId: string) {
  const prefix = "/api/workspaces/";
  const explicitHeader = headers.get(WORKSPACE_RUNTIME_HEADER);
  let workspaceId = explicitHeader ?? defaultWorkspaceId;
  if (url.pathname.startsWith(prefix)) {
    const segments = url.pathname.slice(prefix.length).split("/");
    const addressed = segments.shift() ?? "";
    if (explicitHeader && explicitHeader !== addressed) return "Workspace address and header disagree";
    workspaceId = addressed;
    url.pathname = `/api/${segments.join("/")}`;
  }
  if (!validWorkspaceRuntimeId(workspaceId)) return "Workspace identity is invalid";
  return { workspaceId };
}

/** Mutation SSE owns a finite execution. On disconnect, drain it without
 * buffering and keep the graph pinned even before a Run has been created.
 * Observer streams and downloads release after cancellation settles; background obligations
 * must additionally be protected by the registry's canDispose predicate. */
function retainResponseBody(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  release: () => void,
  keepExecution: boolean,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let ended = false;
  let detached = false;
  let cancellation: Promise<void> | undefined;
  const finish = () => {
    if (ended) return;
    ended = true;
    signal.removeEventListener("abort", abort);
    release();
  };
  const disconnect = (reason: unknown) => {
    if (ended || detached) return cancellation;
    detached = true;
    signal.removeEventListener("abort", abort);
    if (keepExecution) {
      void drainExecution(reader).finally(finish);
    } else {
      // A cancelled read can complete before the source's async cleanup. Keep
      // its graph pinned until cancel settles, including rejection cleanup.
      cancellation = reader.cancel(reason).catch(() => undefined).finally(finish);
      return cancellation;
    }
  };
  const abort = () => disconnect(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (detached) { closeDetached(controller); return; }
        const result = await reader.read();
        if (detached) { closeDetached(controller); return; }
        if (result.done) { finish(); controller.close(); }
        else controller.enqueue(result.value);
      } catch (error) {
        if (detached) return;
        finish();
        controller.error(error);
      }
    },
    cancel: disconnect,
  });
}

function closeDetached(controller: ReadableStreamDefaultController<Uint8Array>): void {
  try { controller.close(); } catch { /* Consumer may already have cancelled. */ }
}

async function drainExecution(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try { while (!(await reader.read()).done) { /* bounded discard */ } }
  catch { /* Execution errors are persisted by the owning service. */ }
}

function errorResponse(error: string, status: number): Response {
  return Response.json({ error }, { status });
}
