import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  browserUseCloudRuntimeRoot,
  BrowserUseLocalError,
  browserUseLocalRuntimeRoot,
  sha256,
  type BrowserUseCloudTaskRequest,
  type BrowserUseCloudTaskResult,
  type BrowserUseLocalTaskRequest,
  type BrowserUseLocalTaskResult,
} from "@napier/runtime";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";

import { registerBrowserTaskHttp } from "../src/browser-task-http.js";
import { BrowserTaskService } from "../src/browser-task-service.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Browser Use local task HTTP", () => {
  it("streams replayable steps, serves screenshot evidence, and returns a result", async () => {
    const root = await temporaryRoot();
    const screenshot = path.join(
      browserUseLocalRuntimeRoot(root),
      "runs",
      "test-run",
      "step-1.png",
    );
    await mkdir(path.dirname(screenshot), { recursive: true });
    await writeFile(screenshot, Buffer.from("browser-step"));
    let runtimeRequest: BrowserUseLocalTaskRequest | undefined;
    let backendEnv: Readonly<Record<string, string | undefined>> | undefined;
    const service = new BrowserTaskService({
      dataRoot: root,
      env: {
        TEST_BROWSER_KEY: "private-credential",
        PATH: "/usr/bin",
      },
      createBackend: (options) => {
        backendEnv = options.env;
        return {
          run: async (request, observe) => {
            runtimeRequest = request;
            await observe(
              localStarted({ startUrl: "https://example.com/releases" }),
            );
            await observe({
              type: "step",
              backend: "browser_use_local",
              step: 1,
              url: "https://example.com/releases",
              title: "Releases",
              nextGoal: "Read the current release",
              actionNames: ["navigate"],
              screenshotPath: screenshot,
            });
            return completed(root);
          },
        };
      },
    });
    const app = new Hono();
    registerBrowserTaskHttp(app, service);

    const create = await app.request("http://napier.test/api/browser-tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validRequest()),
    });
    const created = (await create.json()) as {
      taskId: string;
      streamUrl: string;
      stopUrl: string;
    };
    expect(create.status).toBe(201);
    expect(create.headers.get("X-Napier-Browser-Task-Id")).toBe(created.taskId);
    expect(create.headers.get("X-Napier-Content-SHA256")).toMatch(
      /^[a-f0-9]{64}$/u,
    );

    const stream = await app.request(`http://napier.test${created.streamUrl}`);
    const streamText = await stream.text();
    expect(stream.status).toBe(200);
    expect(stream.headers.get("X-Napier-Browser-Backend")).toBe(
      "browser_use_local",
    );
    expect(streamText).toContain("event: started");
    expect(streamText).toContain("event: step");
    expect(streamText).toContain("event: completed");
    expect(streamText).toContain(
      `/api/browser-tasks/${created.taskId}/screenshots/1`,
    );
    expect(streamText).not.toContain(screenshot);
    expect(streamText).not.toContain("private-credential");

    const image = await app.request(
      `http://napier.test/api/browser-tasks/${created.taskId}/screenshots/1`,
    );
    expect(image.status).toBe(200);
    expect(image.headers.get("Content-Type")).toContain("image/png");
    expect(await image.text()).toBe("browser-step");
    expect(runtimeRequest).toMatchObject({
      startUrl: "https://example.com/releases",
      allowedDomains: ["example.com"],
    });
    expect(backendEnv).toMatchObject({
      NAPIER_BROWSER_USE_CREDENTIAL: "private-credential",
      PATH: "/usr/bin",
    });
    expect(backendEnv).not.toHaveProperty("TEST_BROWSER_KEY");
  });

  it("stops an active browser process and streams a privacy-safe terminal error", async () => {
    const root = await temporaryRoot();
    const service = new BrowserTaskService({
      dataRoot: root,
      env: { TEST_BROWSER_KEY: "private-credential" },
      createBackend: () => ({
        pause: () => controlObservation("paused"),
        takeover: () => controlObservation("takeover"),
        resume: () => controlObservation("running"),
        run: async (_request, observe, signal) => {
          await observe(localStarted());
          await aborted(signal);
          throw new BrowserUseLocalError(
            "Browser Use local task was stopped",
            "cancelled",
            sha256("cancelled"),
            "Start a fresh task when ready",
          );
        },
      }),
    });
    const app = new Hono();
    registerBrowserTaskHttp(app, service);
    const create = await app.request("http://napier.test/api/browser-tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validRequest()),
    });
    const created = (await create.json()) as {
      taskId: string;
      streamUrl: string;
      stopUrl: string;
      pauseUrl: string;
      resumeUrl: string;
      takeoverUrl: string;
    };
    const active = await app.request(
      "http://napier.test/api/browser-tasks/active",
    );
    expect(active.status).toBe(200);
    expect(active.headers.get("X-Napier-Browser-Task-Id")).toBe(created.taskId);
    expect(await active.json()).toEqual({ active: created });
    const streamPromise = app.request(`http://napier.test${created.streamUrl}`);

    for (const [path, state] of [
      [created.pauseUrl, "paused"],
      [created.takeoverUrl, "takeover"],
      [created.resumeUrl, "running"],
    ] as const) {
      const control = await app.request(`http://napier.test${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      expect(control.status).toBe(200);
      expect(await control.json()).toMatchObject({
        taskId: created.taskId,
        state,
      });
    }

    const stop = await app.request(`http://napier.test${created.stopUrl}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(stop.status).toBe(200);
    expect(await stop.json()).toEqual({
      taskId: created.taskId,
      status: "stopping",
    });
    const stream = await streamPromise;
    const text = await stream.text();
    expect(text).toContain("event: started");
    expect(text.match(/event: control/gu)).toHaveLength(3);
    expect(text).toContain('"state":"takeover"');
    expect(text).toContain("event: error");
    expect(text).toContain('"code":"cancelled"');
    expect(text).not.toContain("private-credential");
    const settled = await app.request(
      "http://napier.test/api/browser-tasks/active",
    );
    expect(await settled.json()).toEqual({ active: null });
    expect(settled.headers.get("X-Napier-Browser-Task-Id")).toBeNull();
  });

  it("rejects invalid and missing task requests before opening a stream", async () => {
    const root = await temporaryRoot();
    const service = new BrowserTaskService({
      dataRoot: root,
      env: {},
    });
    const app = new Hono();
    registerBrowserTaskHttp(app, service);

    const invalid = await app.request("http://napier.test/api/browser-tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validRequest(), credentialEnv: "bad locator" }),
    });
    expect(invalid.status).toBe(400);
    const missing = await app.request(
      "http://napier.test/api/browser-tasks/missing/stream",
    );
    expect(missing.status).toBe(404);
  });

  it("resolves the active provider credential without sending a locator through the Web client", async () => {
    const root = await temporaryRoot();
    let resolvedProvider: string | undefined;
    let backendCredential: string | undefined;
    const service = new BrowserTaskService({
      dataRoot: root,
      env: {},
      resolveCredential: async (providerId) => {
        resolvedProvider = providerId;
        return "private-reference-credential";
      },
      createBackend: (options) => {
        backendCredential = options.env["NAPIER_BROWSER_USE_CREDENTIAL"];
        return {
          run: async () => completed(root),
        };
      },
    });
    const app = new Hono();
    registerBrowserTaskHttp(app, service);

    const create = await app.request("http://napier.test/api/browser-tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validRequest(), credentialEnv: "" }),
    });
    const responseText = await create.text();

    expect(create.status).toBe(201);
    expect(resolvedProvider).toBe("openai");
    expect(backendCredential).toBe("private-reference-credential");
    expect(responseText).not.toContain("private-reference-credential");
    expect(responseText).not.toContain("credentialEnv");
  });

  it("returns an actionable recovery when the active credential reference cannot resolve", async () => {
    const root = await temporaryRoot();
    const service = new BrowserTaskService({
      dataRoot: root,
      env: {},
      resolveCredential: async () => {
        throw new Error("private keychain detail");
      },
    });
    const app = new Hono();
    registerBrowserTaskHttp(app, service);

    const create = await app.request("http://napier.test/api/browser-tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validRequest(), credentialEnv: "" }),
    });
    const body = (await create.json()) as Record<string, unknown>;

    expect(create.status).toBe(409);
    expect(body).toMatchObject({
      code: "credential_reference_unavailable",
      recovery:
        "Open Context → Credentials, repair the active openai credential, then retry",
    });
    expect(JSON.stringify(body)).not.toContain("private keychain detail");
  });

  it("keeps cloud credentials server-side and exposes provider policy, cost, and screenshots", async () => {
    const root = await temporaryRoot();
    const screenshot = path.join(
      browserUseCloudRuntimeRoot(root),
      "runs",
      "cloud-run",
      "step-1.png",
    );
    await mkdir(path.dirname(screenshot), { recursive: true });
    await writeFile(screenshot, Buffer.from("cloud-browser-step"));
    let runtimeRequest: BrowserUseCloudTaskRequest | undefined;
    let receivedKey: string | undefined;
    const service = new BrowserTaskService({
      dataRoot: root,
      env: { BROWSER_USE_API_KEY: "private-cloud-key" },
      createCloudBackend: (options) => {
        receivedKey = options.apiKey;
        return {
          run: async (request, observe) => {
            runtimeRequest = request;
            await observe({
              type: "started",
              backend: "browser_use_cloud",
              model: "bu-test",
              allowedDomainCount: 1,
              costStatus: "unknown",
              interactionPolicy: "public_read_only",
              startUrl: "https://example.com/releases",
              dataFlow: "task_url_domains_and_page_data_to_browser_use_cloud",
              workspaceAccess: "none",
              secretForwarding: "browser_use_api_key_only",
              recording: "disabled",
              retentionPolicy: "provider_plan",
              costLimitMode: "napier_poll_stop",
              maxCostUsd: 0.25,
              credentialStatus: "configured",
              pauseAvailable: false,
              takeoverAvailable: false,
              cancelMode: "stop_task_and_session",
            });
            await observe({
              type: "step",
              backend: "browser_use_cloud",
              step: 1,
              url: "https://example.com/releases",
              title: "",
              actionNames: ["go_to_url"],
              screenshotPath: screenshot,
            });
            return cloudCompleted(root);
          },
        };
      },
    });
    const app = new Hono();
    registerBrowserTaskHttp(app, service);

    const create = await app.request("http://napier.test/api/browser-tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validRequest(),
        backend: "browser_use_cloud",
        model: { provider: "browser-use", id: "bu-test" },
        credentialEnv: "BROWSER_USE_API_KEY",
        maxCostUsd: 0.25,
      }),
    });
    const created = (await create.json()) as {
      taskId: string;
      backend: string;
      streamUrl: string;
    };
    expect(create.status).toBe(201);
    expect(created.backend).toBe("browser_use_cloud");
    expect(create.headers.get("X-Napier-Browser-Backend")).toBe(
      "browser_use_cloud",
    );
    const stream = await app.request(`http://napier.test${created.streamUrl}`);
    const streamText = await stream.text();
    expect(stream.headers.get("X-Napier-Browser-Backend")).toBe(
      "browser_use_cloud",
    );
    expect(streamText).toContain('"retentionPolicy":"provider_plan"');
    expect(streamText).toContain('"costUsd":0.08');
    expect(streamText).not.toContain("private-cloud-key");
    expect(receivedKey).toBe("private-cloud-key");
    expect(runtimeRequest).toMatchObject({
      model: { provider: "browser-use", id: "bu-test" },
      maxCostUsd: 0.25,
      allowedDomains: ["example.com"],
    });
    const image = await app.request(
      `http://napier.test/api/browser-tasks/${created.taskId}/screenshots/1`,
    );
    expect(await image.text()).toBe("cloud-browser-step");
  });

  it("restores terminal evidence and retry input after restart without persisting the credential", async () => {
    const root = await temporaryRoot();
    const first = new BrowserTaskService({
      dataRoot: root,
      env: { TEST_BROWSER_KEY: "private-restart-credential" },
      createBackend: () => ({
        run: async (_request, observe) => {
          await observe(localStarted());
          return completed(root);
        },
      }),
    });
    const firstApp = new Hono();
    registerBrowserTaskHttp(firstApp, first);
    const create = await firstApp.request(
      "http://napier.test/api/browser-tasks",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validRequest()),
      },
    );
    const created = (await create.json()) as {
      taskId: string;
      streamUrl: string;
    };
    await (
      await firstApp.request(`http://napier.test${created.streamUrl}`)
    ).text();

    const journal = await readFile(
      path.join(root, "browser-tasks", "latest.json"),
      "utf8",
    );
    expect(journal).toContain("TEST_BROWSER_KEY");
    expect(journal).not.toContain("private-restart-credential");

    const restored = new BrowserTaskService({ dataRoot: root, env: {} });
    const restoredApp = new Hono();
    registerBrowserTaskHttp(restoredApp, restored);
    const latest = await restoredApp.request(
      "http://napier.test/api/browser-tasks/latest",
    );
    const body = (await latest.json()) as Record<string, unknown>;

    expect(latest.status).toBe(200);
    expect(latest.headers.get("X-Napier-Browser-Task-Id")).toBe(created.taskId);
    expect(body).toMatchObject({
      latest: {
        taskId: created.taskId,
        status: "terminal",
        input: {
          task: "Summarize the latest release",
          credentialEnv: "TEST_BROWSER_KEY",
        },
        events: expect.arrayContaining([
          expect.objectContaining({ type: "started" }),
          expect.objectContaining({
            type: "completed",
            result: "Release summary",
          }),
        ]),
      },
    });
    expect(JSON.stringify(body)).not.toContain("private-restart-credential");
  });

  it("settles an interrupted journal as retryable history on restart", async () => {
    const root = await temporaryRoot();
    const first = new BrowserTaskService({
      dataRoot: root,
      env: { TEST_BROWSER_KEY: "private-interrupted-credential" },
      createBackend: () => ({
        run: async (_request, observe, signal) => {
          await observe(localStarted());
          await aborted(signal);
          throw new BrowserUseLocalError(
            "stopped",
            "cancelled",
            sha256("stopped"),
            "retry",
          );
        },
      }),
    });
    await first.create(validRequest());
    const restored = new BrowserTaskService({ dataRoot: root, env: {} });
    const snapshot = await restored.latest();

    expect(snapshot).toMatchObject({
      status: "terminal",
      input: { task: "Summarize the latest release" },
      events: expect.arrayContaining([
        expect.objectContaining({
          type: "error",
          code: "server_restarted",
          recovery: expect.stringContaining("Retry the same task"),
        }),
      ]),
    });
    await first.shutdown();
  });
});

function validRequest() {
  return {
    backend: "browser_use_local",
    task: "Summarize the latest release",
    startUrl: "https://example.com/releases",
    model: { provider: "openai", id: "gpt-test" },
    credentialEnv: "TEST_BROWSER_KEY",
    allowedDomains: ["example.com"],
    maxSteps: 4,
    maxCostUsd: 1,
  };
}

function localStarted(overrides: { startUrl?: string } = {}) {
  return {
    type: "started" as const,
    backend: "browser_use_local" as const,
    model: "openai/gpt-test",
    allowedDomainCount: 1,
    costStatus: "unknown" as const,
    interactionPolicy: "public_read_only" as const,
    pauseAvailable: true,
    takeoverAvailable: true,
    browserVisibility: "visible" as const,
    browserProduct: "system_chrome" as const,
    browserVersion: "151.0.7922.109",
    pauseMode: "immediate_agent_process" as const,
    challengeMode: "automatic_takeover_pause" as const,
    cancelMode: "terminate_process_group" as const,
    ...overrides,
  };
}

function controlObservation(state: "running" | "paused" | "takeover") {
  return {
    type: "control" as const,
    backend: "browser_use_local" as const,
    state,
    pauseAvailable: true,
    takeoverAvailable: true,
    browserVisibility: "visible" as const,
    message: `Agent ${state}`,
  };
}

function cloudCompleted(root: string): BrowserUseCloudTaskResult {
  return {
    type: "completed",
    backend: "browser_use_cloud",
    status: "completed",
    result: "Cloud release summary",
    stepCount: 1,
    costStatus: "reported",
    costUsd: 0.08,
    artifactDirectory: root,
    providerTaskId: "provider-task-1",
    retentionPolicy: "provider_plan",
  };
}

function completed(root: string): BrowserUseLocalTaskResult {
  return {
    type: "completed",
    backend: "browser_use_local",
    status: "completed",
    result: "Release summary",
    stepCount: 1,
    costStatus: "reported",
    costUsd: 0.001,
    totalTokens: 42,
    artifactDirectory: root,
  };
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "napier-browser-task-"));
  temporaryRoots.push(root);
  return root;
}

function aborted(signal: AbortSignal | undefined): Promise<void> {
  if (!signal) return Promise.reject(new Error("Abort signal is missing"));
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) =>
    signal.addEventListener("abort", () => resolve(), { once: true }),
  );
}
