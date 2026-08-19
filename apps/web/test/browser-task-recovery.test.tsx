import { parseHTML } from "linkedom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { sha256Text } from "../src/api-error";
import { BrowserUseLocalTaskPanel } from "../src/BrowserUseLocalTaskPanel";
import {
  useBrowserTaskRunner,
  type BrowserTaskFormValue,
  type BrowserTaskRunner,
} from "../src/use-browser-task-runner";

const roots: Root[] = [];
let latestRunner: BrowserTaskRunner | undefined;

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await act(async () => root.unmount());
  }
  latestRunner = undefined;
  vi.unstubAllGlobals();
});

describe("Browser task recovery", () => {
  it("reconnects to the server-owned task after a page mount without stopping it on unmount", async () => {
    const { container } = installDom();
    const created = {
      taskId: "browser_task_recovery",
      backend: "browser_use_local" as const,
      status: "running" as const,
      streamUrl: "/api/browser-tasks/browser_task_recovery/stream",
      stopUrl: "/api/browser-tasks/browser_task_recovery/stop",
      pauseUrl: "/api/browser-tasks/browser_task_recovery/pause",
      resumeUrl: "/api/browser-tasks/browser_task_recovery/resume",
      takeoverUrl: "/api/browser-tasks/browser_task_recovery/takeover",
    };
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path === "/api/browser-tasks/active") {
          return activeResponse(created);
        }
        if (path === created.streamUrl) {
          return liveSseResponse(created.taskId, init?.signal);
        }
        throw new Error(`Unexpected request: ${path}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const root = createRoot(container);
    roots.push(root);

    await act(async () => root.render(<BrowserUseLocalTaskPanel />));
    await waitFor(() =>
      container.textContent?.includes(
        "Browser Use local · reconnected · running",
      ),
    );
    expect(container.textContent).toContain("Pause");
    expect(container.textContent).toContain("Take over");

    roots.splice(roots.indexOf(root), 1);
    await act(async () => root.unmount());
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).endsWith("/stop")),
    ).toBe(false);
  });

  it("retries a failed task with the same validated settings", async () => {
    const { container } = installDom();
    const requests: string[] = [];
    const first = createdTask("browser_task_failed");
    const retry = createdTask("browser_task_retry");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path === "/api/browser-tasks/active") return inactiveResponse();
        if (path === "/api/browser-tasks/latest") return latestEmptyResponse();
        if (path === "/api/browser-tasks") {
          requests.push(String(init?.body));
          return taskResponse(requests.length === 1 ? first : retry);
        }
        if (path === first.streamUrl) {
          return terminalSseResponse(first, {
            type: "error",
            backend: "browser_use_local",
            code: "browser_process_exited",
            message: "The browser process exited",
            diagnosticSha256: "a".repeat(64),
            recovery: "Retry the task with the same settings",
          });
        }
        if (path === retry.streamUrl) {
          return terminalSseResponse(retry, {
            type: "completed",
            backend: "browser_use_local",
            status: "completed",
            result: "Release summary",
            stepCount: 2,
            costStatus: "reported",
            costUsd: 0.002,
            totalTokens: 64,
            artifactDirectory: "/private/artifacts",
          });
        }
        throw new Error(`Unexpected request: ${path}`);
      }),
    );
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<RunnerHarness />));
    await waitFor(() => latestRunner?.status === "idle");

    const input: BrowserTaskFormValue = {
      backend: "browser_use_local",
      task: "Summarize releases",
      startUrl: "https://example.com/releases",
      allowedDomains: "example.com",
      provider: "openai",
      modelId: "gpt-test",
      credentialEnv: "OPENAI_API_KEY",
      maxSteps: 8,
      maxCostUsd: 1,
    };
    await act(async () => latestRunner!.start(input));

    expect(latestRunner?.canRetry).toBe(true);
    expect(container.textContent).toContain("Retry same task");
    await act(async () => latestRunner!.retry());

    expect(requests).toHaveLength(2);
    expect(requests[1]).toBe(requests[0]);
    expect(latestRunner?.events.at(-1)).toMatchObject({
      type: "completed",
      result: "Release summary",
    });
  });

  it("restores terminal evidence and a retry action after refresh", async () => {
    const { container } = installDom();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        if (path === "/api/browser-tasks/active") return inactiveResponse();
        if (path === "/api/browser-tasks/latest") {
          return latestResponse({
            taskId: "browser_task_restored",
            backend: "browser_use_local",
            status: "terminal",
            input: {
              backend: "browser_use_local",
              task: "Summarize releases",
              startUrl: "https://example.com/releases",
              allowedDomains: ["example.com"],
              model: { provider: "openai", id: "gpt-test" },
              credentialEnv: "",
              maxSteps: 8,
              maxCostUsd: 1,
            },
            events: [
              startedEvent(),
              {
                type: "error",
                backend: "browser_use_local",
                code: "cancelled",
                message: "Browser Use local task was stopped",
                diagnosticSha256: "b".repeat(64),
                recovery: "Rerun the same command to start a fresh local task",
              },
            ],
          });
        }
        throw new Error(`Unexpected request: ${path}`);
      }),
    );
    const root = createRoot(container);
    roots.push(root);

    await act(async () => root.render(<BrowserUseLocalTaskPanel />));
    await waitFor(() =>
      container.textContent?.includes(
        "Browser Use local · restored history · finished",
      ),
    );

    expect(container.textContent).toContain("Retry same task");
    expect(container.textContent).toContain(
      "Browser Use local task was stopped",
    );
    expect(container.textContent).toContain(
      "Rerun the same command to start a fresh local task",
    );
    expect(container.textContent).toContain("agent stopped");
    expect(container.textContent).not.toContain("agent running");
  });

  it("uses the selected configured model and active credential reference by default", async () => {
    const { container } = installDom();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input) === "/api/browser-tasks/latest"
          ? latestEmptyResponse()
          : inactiveResponse(),
      ),
    );
    const root = createRoot(container);
    roots.push(root);

    await act(async () =>
      root.render(
        <BrowserUseLocalTaskPanel
          selectedModel={{
            key: "deepseek/deepseek-chat",
            provider: "deepseek",
            id: "deepseek-chat",
            label: "DeepSeek",
            configured: true,
            known: true,
          }}
          models={[
            {
              provider: "deepseek",
              providerName: "DeepSeek",
              id: "deepseek-chat",
              name: "DeepSeek Chat",
              contextWindow: 128_000,
              reasoning: true,
              vision: false,
              configured: true,
            },
          ]}
          credentials={[
            {
              id: "credential_deepseek",
              providerId: "deepseek",
              label: "Workspace DeepSeek",
              source: { type: "environment", variable: "DEEPSEEK_API_KEY" },
              status: "active",
              availability: "available",
              revision: 1,
              createdAt: "2026-08-13T00:00:00.000Z",
              updatedAt: "2026-08-13T00:00:00.000Z",
            },
          ]}
        />,
      ),
    );
    await waitFor(() => container.textContent?.includes("Native Playwright"));

    expect(namedElement<HTMLInputElement>(container, "modelId").value).toBe(
      "deepseek-chat",
    );
    expect(
      namedElement<HTMLInputElement>(container, "credentialEnv").value,
    ).toBe("");
    expect(container.textContent).toContain(
      "Active credential · Workspace DeepSeek · available",
    );
    expect(container.textContent).toContain("secret stays server-side");
  });
});

function namedElement<T extends Element>(
  container: HTMLElement,
  name: string,
): T {
  const pending: Array<ChildNode | HTMLElement> = [container];
  while (pending.length > 0) {
    const candidate = pending.shift() as HTMLElement;
    if (candidate.getAttribute?.("name") === name) return candidate as T;
    pending.push(...candidate.childNodes);
  }
  throw new Error(`Missing element[name=${name}]`);
}

function RunnerHarness() {
  latestRunner = useBrowserTaskRunner();
  return (
    <button
      type="button"
      disabled={!latestRunner.canRetry}
      onClick={() => void latestRunner?.retry()}
    >
      Retry same task
    </button>
  );
}

function installDom() {
  const { document, window } = parseHTML(
    "<!doctype html><html><body><div id=app></div></body></html>",
  );
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("navigator", window.navigator);
  vi.stubGlobal("HTMLElement", window.HTMLElement);
  vi.stubGlobal("Event", window.Event);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  return { container: document.getElementById("app") as HTMLElement };
}

async function activeResponse(active: unknown): Promise<Response> {
  const text = JSON.stringify({ active });
  return new Response(text, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Napier-Browser-Task-Id": "browser_task_recovery",
      "X-Napier-Browser-Backend": "browser_use_local",
      "X-Napier-Content-SHA256": await sha256Text(text),
      "X-Napier-Content-SHA256-Mode": "body",
    },
  });
}

async function inactiveResponse(): Promise<Response> {
  const text = JSON.stringify({ active: null });
  return new Response(text, {
    headers: await verifiedHeaders(text),
  });
}

async function latestEmptyResponse(): Promise<Response> {
  const text = JSON.stringify({ latest: null });
  return new Response(text, {
    headers: await verifiedHeaders(text),
  });
}

async function latestResponse(latest: {
  taskId: string;
  backend: "browser_use_local";
  status: "terminal";
  input: Record<string, unknown>;
  events: unknown[];
}): Promise<Response> {
  const text = JSON.stringify({ latest });
  return new Response(text, {
    headers: await verifiedHeaders(text, createdTask(latest.taskId)),
  });
}

function createdTask(taskId: string) {
  return {
    taskId,
    backend: "browser_use_local" as const,
    status: "running" as const,
    streamUrl: `/api/browser-tasks/${taskId}/stream`,
    stopUrl: `/api/browser-tasks/${taskId}/stop`,
    pauseUrl: `/api/browser-tasks/${taskId}/pause`,
    resumeUrl: `/api/browser-tasks/${taskId}/resume`,
    takeoverUrl: `/api/browser-tasks/${taskId}/takeover`,
  };
}

async function taskResponse(task: ReturnType<typeof createdTask>) {
  const text = JSON.stringify(task);
  return new Response(text, {
    status: 201,
    headers: await verifiedHeaders(text, task),
  });
}

function terminalSseResponse(
  task: ReturnType<typeof createdTask>,
  event: import("../src/browser-task-api").BrowserTaskApiEvent,
) {
  return new Response(
    `event: ${event.type}\nid: 1\ndata: ${JSON.stringify(event)}\n\n`,
    {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Napier-Browser-Task-Id": task.taskId,
        "X-Napier-Browser-Backend": task.backend,
      },
    },
  );
}

async function verifiedHeaders(
  text: string,
  task?: ReturnType<typeof createdTask>,
): Promise<Headers> {
  const headers = new Headers({
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Napier-Content-SHA256-Mode": "body",
  });
  if (task) {
    headers.set("X-Napier-Browser-Task-Id", task.taskId);
    headers.set("X-Napier-Browser-Backend", task.backend);
  }
  headers.set("X-Napier-Content-SHA256", await sha256Text(text));
  return headers;
}

function liveSseResponse(
  taskId: string,
  signal?: AbortSignal | null,
): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          `event: started\nid: 1\ndata: ${JSON.stringify(startedEvent())}\n\n`,
        ),
      );
      signal?.addEventListener(
        "abort",
        () => controller.error(signal.reason ?? new Error("aborted")),
        { once: true },
      );
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Napier-Browser-Task-Id": taskId,
      "X-Napier-Browser-Backend": "browser_use_local",
    },
  });
}

function startedEvent() {
  return {
    type: "started",
    backend: "browser_use_local",
    model: "openai/gpt-test",
    allowedDomainCount: 1,
    costStatus: "unknown",
    interactionPolicy: "public_read_only",
    startUrl: "https://example.com/releases",
    pauseAvailable: true,
    takeoverAvailable: true,
    browserVisibility: "visible",
    browserProduct: "system_chrome",
    browserVersion: "151.0.7922.109",
    pauseMode: "immediate_agent_process",
    challengeMode: "automatic_takeover_pause",
    cancelMode: "terminate_process_group",
  };
}

async function waitFor(predicate: () => boolean | undefined): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for browser task recovery");
}
