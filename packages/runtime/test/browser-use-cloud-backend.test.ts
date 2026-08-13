import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { BrowserUseCloudBackend } from "../src/index.js";

const REQUEST = {
  task: "Summarize the public release notes and cite the page URL",
  startUrl: "https://example.com/releases",
  model: { provider: "browser-use", id: "bu-test" },
  allowedDomains: ["example.com"],
  maxSteps: 8,
  maxCostUsd: 0.5,
} as const;

describe("Browser Use Cloud backend boundary", () => {
  it("creates an isolated read-only v2 task and returns streamed evidence", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(input), init });
        if (calls.length === 1)
          return json({ id: "cloud-task-1", sessionId: "session-1" });
        return json({
          id: "cloud-task-1",
          status: "finished",
          output: "The release is stable: https://example.com/releases",
          isSuccess: true,
          cost: 0.07,
          steps: [
            {
              number: 1,
              url: "https://example.com/releases",
              nextGoal: "Read the release summary",
              actions: [{ go_to_url: { url: "https://example.com/releases" } }],
              screenshotUrl: "https://screens.browser-use.test/step.png",
            },
          ],
        });
      },
    );
    const observations: unknown[] = [];
    const backend = new BrowserUseCloudBackend({
      dataRoot: path.join(os.tmpdir(), "napier-browser-use-cloud-test"),
      apiKey: "secret-cloud-key",
      fetch: fetchImpl as typeof fetch,
      pollIntervalMs: 1,
      downloadScreenshot: async () => undefined,
    });

    const result = await backend.run(REQUEST, (event) =>
      observations.push(event),
    );

    expect(result).toMatchObject({
      backend: "browser_use_cloud",
      status: "completed",
      stepCount: 1,
      costStatus: "reported",
      costUsd: 0.07,
      retentionPolicy: "provider_plan",
    });
    expect(observations).toMatchObject([
      {
        type: "started",
        workspaceAccess: "none",
        recording: "disabled",
        retentionPolicy: "provider_plan",
        costLimitMode: "napier_poll_stop",
        pauseAvailable: false,
        takeoverAvailable: false,
        cancelMode: "stop_task_and_session",
      },
      {
        type: "step",
        actionNames: ["go_to_url"],
        screenshotPath: expect.stringContaining("step-1.png"),
      },
    ]);
    const createBody = JSON.parse(String(calls[0]?.init?.body)) as Record<
      string,
      unknown
    >;
    expect(createBody).toMatchObject({
      allowedDomains: ["example.com"],
      maxSteps: 8,
      sessionSettings: { enableRecording: false },
      judge: false,
      skillIds: [],
    });
    expect(createBody).not.toHaveProperty("secrets");
    expect(createBody).not.toHaveProperty("profileId");
    expect(createBody).not.toHaveProperty("workspaceId");
    expect(createBody).not.toHaveProperty("proxyCountryCode");
    expect(calls[0]?.init?.headers).toMatchObject({
      "X-Browser-Use-API-Key": "secret-cloud-key",
    });
  });

  it("stops the provider task when reported spend reaches the explicit ceiling", async () => {
    const methods: string[] = [];
    const fetchImpl = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        methods.push(init?.method ?? "GET");
        if (methods.length === 1) return json({ id: "cloud-task-budget" });
        if (methods.length === 2) {
          return json({
            id: "cloud-task-budget",
            status: "started",
            cost: 0.5,
            steps: [],
          });
        }
        return json({ id: "cloud-task-budget", status: "stopped" });
      },
    );
    const backend = new BrowserUseCloudBackend({
      dataRoot: path.join(os.tmpdir(), "napier-browser-use-cloud-budget-test"),
      apiKey: "secret-cloud-key",
      fetch: fetchImpl as typeof fetch,
      pollIntervalMs: 1,
    });

    const result = await backend.run(
      { ...REQUEST, maxCostUsd: 0.1 },
      () => undefined,
    );

    expect(result).toMatchObject({
      status: "failed",
      costUsd: 0.5,
      recovery: expect.stringContaining("cost ceiling"),
    });
    expect(methods).toEqual(["POST", "GET", "PATCH"]);
  });

  it("rejects private or out-of-policy targets before sending data", async () => {
    const fetchImpl = vi.fn();
    const backend = new BrowserUseCloudBackend({
      dataRoot: path.join(os.tmpdir(), "napier-browser-use-cloud-invalid-test"),
      apiKey: "secret-cloud-key",
      fetch: fetchImpl as typeof fetch,
    });

    await expect(
      backend.run(
        {
          ...REQUEST,
          startUrl: "http://127.0.0.1/private",
          allowedDomains: ["127.0.0.1"],
        },
        () => undefined,
      ),
    ).rejects.toThrow("allowed domain is invalid");
    await expect(
      backend.run(
        {
          ...REQUEST,
          startUrl: "https://other.example.org",
          allowedDomains: ["example.com"],
        },
        () => undefined,
      ),
    ).rejects.toThrow("must match the public domain allowlist");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
