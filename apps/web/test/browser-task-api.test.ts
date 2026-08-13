import { afterEach, describe, expect, it, vi } from "vitest";

import { sha256Text } from "../src/api-error";
import {
  controlBrowserTask,
  createBrowserTask,
  recoverActiveBrowserTask,
  recoverLatestBrowserTask,
  stopBrowserTask,
  streamBrowserTask,
  type BrowserTaskApiEvent,
} from "../src/browser-task-api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Browser task Web API", () => {
  it("recovers the active task contract and accepts a verified empty state", async () => {
    const created = {
      taskId: "browser_task_123",
      backend: "browser_use_local" as const,
      status: "running" as const,
      streamUrl: "/api/browser-tasks/browser_task_123/stream",
      stopUrl: "/api/browser-tasks/browser_task_123/stop",
      pauseUrl: "/api/browser-tasks/browser_task_123/pause",
      resumeUrl: "/api/browser-tasks/browser_task_123/resume",
      takeoverUrl: "/api/browser-tasks/browser_task_123/takeover",
    };
    const snapshot = {
      taskId: created.taskId,
      backend: created.backend,
      status: "terminal",
      input: {
        backend: "browser_use_local",
        task: "Summarize releases",
        startUrl: "https://example.com/releases",
        model: { provider: "openai", id: "gpt-test" },
        credentialEnv: "",
        allowedDomains: ["example.com"],
        maxSteps: 4,
        maxCostUsd: 1,
      },
      events: [
        localStarted(),
        {
          type: "error",
          backend: "browser_use_local",
          code: "server_restarted",
          message: "Browser task stopped when the server restarted",
          diagnosticSha256: "a".repeat(64),
          recovery: "Retry the same task",
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(await jsonResponse({ active: created }, 200))
        .mockResolvedValueOnce(await inactiveJsonResponse("active"))
        .mockResolvedValueOnce(await jsonResponse({ latest: snapshot }, 200))
        .mockResolvedValueOnce(await inactiveJsonResponse("latest")),
    );

    await expect(recoverActiveBrowserTask()).resolves.toEqual(created);
    await expect(recoverActiveBrowserTask()).resolves.toBeUndefined();
    await expect(recoverLatestBrowserTask()).resolves.toEqual(snapshot);
    await expect(recoverLatestBrowserTask()).resolves.toBeUndefined();
  });

  it("creates a task and verifies its step, screenshot, and terminal stream", async () => {
    const created = {
      taskId: "browser_task_123",
      backend: "browser_use_local" as const,
      status: "running" as const,
      streamUrl: "/api/browser-tasks/browser_task_123/stream",
      stopUrl: "/api/browser-tasks/browser_task_123/stop",
      pauseUrl: "/api/browser-tasks/browser_task_123/pause",
      resumeUrl: "/api/browser-tasks/browser_task_123/resume",
      takeoverUrl: "/api/browser-tasks/browser_task_123/takeover",
    };
    const started = localStarted();
    const control = localControl("takeover");
    const step = {
      type: "step",
      backend: "browser_use_local",
      step: 1,
      url: "https://example.com/releases",
      title: "Releases",
      actionNames: ["navigate"],
      screenshotUrl: "/api/browser-tasks/browser_task_123/screenshots/1",
    };
    const completed = {
      type: "completed",
      backend: "browser_use_local",
      status: "completed",
      result: "Release summary",
      stepCount: 1,
      costStatus: "reported",
      costUsd: 0.001,
      totalTokens: 42,
      artifactDirectory: "/private/artifacts",
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(await jsonResponse(created, 201))
        .mockResolvedValueOnce(
          sseResponse(created.taskId, [
            sse("started", started, "1"),
            sse("control", control, "2"),
            sse("step", step, "3"),
            sse("completed", completed, "4"),
          ]),
        ),
    );

    const task = await createBrowserTask({
      backend: "browser_use_local",
      task: "Summarize releases",
      startUrl: "https://example.com/releases",
      model: { provider: "openai", id: "gpt-test" },
      credentialEnv: "OPENAI_API_KEY",
      allowedDomains: ["example.com"],
      maxSteps: 4,
      maxCostUsd: 1,
    });
    const events: BrowserTaskApiEvent[] = [];
    const terminal = await streamBrowserTask(task, (event) =>
      events.push(event),
    );

    expect(task).toEqual(created);
    expect(events).toEqual([started, control, step, completed]);
    expect(terminal).toEqual(completed);
  });

  it("requests explicit stop and rejects task identity or sequence drift", async () => {
    const created = {
      taskId: "browser_task_123",
      backend: "browser_use_local" as const,
      status: "running" as const,
      streamUrl: "/api/browser-tasks/browser_task_123/stream",
      stopUrl: "/api/browser-tasks/browser_task_123/stop",
      pauseUrl: "/api/browser-tasks/browser_task_123/pause",
      resumeUrl: "/api/browser-tasks/browser_task_123/resume",
      takeoverUrl: "/api/browser-tasks/browser_task_123/takeover",
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          await jsonResponse(
            { taskId: created.taskId, status: "stopping" },
            200,
          ),
        )
        .mockResolvedValueOnce(
          sseResponse(created.taskId, [
            sse(
              "error",
              {
                type: "error",
                backend: "browser_use_local",
                code: "cancelled",
                message: "Browser task was stopped",
                diagnosticSha256: "a".repeat(64),
                recovery: "Start a fresh task",
              },
              "2",
            ),
          ]),
        ),
    );

    await expect(stopBrowserTask(created)).resolves.toEqual({
      taskId: created.taskId,
      status: "stopping",
    });
    await expect(streamBrowserTask(created, () => undefined)).rejects.toThrow(
      "sequence is invalid",
    );
  });

  it("sends local Pause, Take over, and Resume to their task-scoped endpoints", async () => {
    const created = {
      taskId: "browser_task_123",
      backend: "browser_use_local" as const,
      status: "running" as const,
      streamUrl: "/api/browser-tasks/browser_task_123/stream",
      stopUrl: "/api/browser-tasks/browser_task_123/stop",
      pauseUrl: "/api/browser-tasks/browser_task_123/pause",
      resumeUrl: "/api/browser-tasks/browser_task_123/resume",
      takeoverUrl: "/api/browser-tasks/browser_task_123/takeover",
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          await jsonResponse(
            { taskId: created.taskId, state: "paused", message: "Paused" },
            200,
          ),
        )
        .mockResolvedValueOnce(
          await jsonResponse(
            {
              taskId: created.taskId,
              state: "takeover",
              message: "Take over",
            },
            200,
          ),
        )
        .mockResolvedValueOnce(
          await jsonResponse(
            { taskId: created.taskId, state: "running", message: "Resumed" },
            200,
          ),
        ),
    );

    await expect(controlBrowserTask(created, "pause")).resolves.toMatchObject({
      state: "paused",
    });
    await expect(
      controlBrowserTask(created, "takeover"),
    ).resolves.toMatchObject({ state: "takeover" });
    await expect(controlBrowserTask(created, "resume")).resolves.toMatchObject({
      state: "running",
    });
  });

  it("accepts Cloud only when the disclosure and cost contracts remain intact", async () => {
    const created = {
      taskId: "browser_task_123",
      backend: "browser_use_cloud" as const,
      status: "running" as const,
      streamUrl: "/api/browser-tasks/browser_task_123/stream",
      stopUrl: "/api/browser-tasks/browser_task_123/stop",
    };
    const started = {
      type: "started",
      backend: "browser_use_cloud",
      model: "browser-use-2.0",
      allowedDomainCount: 1,
      costStatus: "unknown",
      interactionPolicy: "public_read_only",
      startUrl: "https://example.com/",
      dataFlow: "task_url_domains_and_page_data_to_browser_use_cloud",
      workspaceAccess: "none",
      secretForwarding: "browser_use_api_key_only",
      recording: "disabled",
      retentionPolicy: "provider_plan",
      costLimitMode: "napier_poll_stop",
      maxCostUsd: 0.5,
      credentialStatus: "configured",
      pauseAvailable: false,
      takeoverAvailable: false,
      cancelMode: "stop_task_and_session",
    };
    const completed = {
      type: "completed",
      backend: "browser_use_cloud",
      status: "completed",
      result: "Cloud result",
      stepCount: 0,
      costStatus: "reported",
      costUsd: 0.08,
      artifactDirectory: "/private/cloud-artifacts",
      providerTaskId: "provider-1",
      retentionPolicy: "provider_plan",
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          await jsonResponse(created, 201, "browser_use_cloud"),
        )
        .mockResolvedValueOnce(
          sseResponse(
            created.taskId,
            [sse("started", started, "1"), sse("completed", completed, "2")],
            "browser_use_cloud",
          ),
        ),
    );

    const task = await createBrowserTask({
      backend: "browser_use_cloud",
      task: "Read the page",
      startUrl: "https://example.com/",
      model: { provider: "browser-use", id: "browser-use-2.0" },
      credentialEnv: "BROWSER_USE_API_KEY",
      allowedDomains: ["example.com"],
      maxSteps: 5,
      maxCostUsd: 0.5,
    });
    const events: BrowserTaskApiEvent[] = [];
    await expect(
      streamBrowserTask(task, (event) => events.push(event)),
    ).resolves.toEqual(completed);
    expect(events).toEqual([started, completed]);
  });
});

async function jsonResponse(
  body: unknown,
  status: number,
  backend = "browser_use_local",
): Promise<Response> {
  const text = JSON.stringify(body);
  return new Response(text, {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Napier-Browser-Task-Id": "browser_task_123",
      "X-Napier-Browser-Backend": backend,
      "X-Napier-Content-SHA256": await sha256Text(text),
      "X-Napier-Content-SHA256-Mode": "body",
    },
  });
}

async function inactiveJsonResponse(
  field: "active" | "latest" = "active",
): Promise<Response> {
  const text = JSON.stringify({ [field]: null });
  return new Response(text, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Napier-Content-SHA256": await sha256Text(text),
      "X-Napier-Content-SHA256-Mode": "body",
    },
  });
}

function sseResponse(
  taskId: string,
  records: string[],
  backend = "browser_use_local",
): Response {
  return new Response(records.join("\n\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Napier-Browser-Task-Id": taskId,
      "X-Napier-Browser-Backend": backend,
    },
  });
}

function sse(event: string, body: unknown, id: string): string {
  return `event: ${event}\nid: ${id}\ndata: ${JSON.stringify(body)}`;
}

function localStarted() {
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

function localControl(state: "running" | "paused" | "takeover") {
  return {
    type: "control",
    backend: "browser_use_local",
    state,
    pauseAvailable: true,
    takeoverAvailable: true,
    browserVisibility: "visible",
    message: `Agent ${state}`,
  };
}
