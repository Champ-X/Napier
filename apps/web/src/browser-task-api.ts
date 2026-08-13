import { requestJsonWithResponse } from "./api-client";
import { throwNapierApiError } from "./api-error";
import { parseBrowserTaskEvent } from "./browser-task-event-api";
import { readSseJsonRecords } from "./sse-json";
import type {
  BrowserTaskApiEvent,
  BrowserTaskBackend,
  BrowserTaskCreated,
  BrowserTaskSnapshot,
  CreateBrowserTaskInput,
} from "./browser-task-contract";
export type {
  BrowserTaskApiEvent,
  BrowserTaskBackend,
  BrowserTaskCreated,
  BrowserTaskSnapshot,
  BrowserTaskModelProvider,
  CreateBrowserTaskInput,
} from "./browser-task-contract";

const MAX_BROWSER_TASK_STREAM_BYTES = 4 * 1024 * 1024;
const MAX_BROWSER_TASK_RECORD_BYTES = 256 * 1024;

export async function createBrowserTask(
  input: CreateBrowserTaskInput,
): Promise<BrowserTaskCreated> {
  const path = "/api/browser-tasks";
  const response = await requestJsonWithResponse<unknown>(path, {
    method: "POST",
    body: JSON.stringify(input),
  });
  const created = parseCreated(response.body);
  assertTaskHeaders(response.headers, created.taskId, created.backend, path);
  return created;
}

export async function recoverActiveBrowserTask(): Promise<
  BrowserTaskCreated | undefined
> {
  const path = "/api/browser-tasks/active";
  const response = await requestJsonWithResponse<unknown>(path, {
    cache: "no-store",
  });
  if (
    !record(response.body) ||
    Object.keys(response.body).length !== 1 ||
    !("active" in response.body)
  ) {
    throw new Error("Active browser task response is invalid");
  }
  if (response.body["active"] === null) {
    assertInactiveTaskHeaders(response.headers, path);
    return undefined;
  }
  const active = parseCreated(response.body["active"]);
  assertTaskHeaders(response.headers, active.taskId, active.backend, path);
  return active;
}

export async function recoverLatestBrowserTask(): Promise<
  BrowserTaskSnapshot | undefined
> {
  const path = "/api/browser-tasks/latest";
  const response = await requestJsonWithResponse<unknown>(path, {
    cache: "no-store",
  });
  if (
    !record(response.body) ||
    Object.keys(response.body).length !== 1 ||
    !("latest" in response.body)
  ) {
    throw new Error("Latest browser task response is invalid");
  }
  if (response.body["latest"] === null) {
    assertInactiveTaskHeaders(response.headers, path);
    return undefined;
  }
  const snapshot = parseSnapshot(response.body["latest"]);
  assertTaskHeaders(response.headers, snapshot.taskId, snapshot.backend, path);
  return snapshot;
}

export async function streamBrowserTask(
  created: BrowserTaskCreated,
  onEvent: (event: BrowserTaskApiEvent) => void,
  signal?: AbortSignal,
): Promise<Extract<BrowserTaskApiEvent, { type: "completed" | "error" }>> {
  const response = await fetch(created.streamUrl, {
    cache: "no-store",
    headers: { Accept: "text/event-stream" },
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    await throwNapierApiError(
      response,
      "Browser task stream unavailable",
      created.streamUrl,
    );
  }
  assertTaskHeaders(
    response.headers,
    created.taskId,
    created.backend,
    created.streamUrl,
  );
  if (!response.body) {
    throw new Error("Browser task stream body is unavailable");
  }
  let terminal:
    | Extract<BrowserTaskApiEvent, { type: "completed" | "error" }>
    | undefined;
  let expectedSequence = 1;
  for await (const record of readSseJsonRecords(
    created.streamUrl,
    response.body,
    {
      maxTotalBytes: MAX_BROWSER_TASK_STREAM_BYTES,
      maxRecordBytes: MAX_BROWSER_TASK_RECORD_BYTES,
    },
  )) {
    if (terminal || record.id !== String(expectedSequence)) {
      throw new Error("Browser task stream sequence is invalid");
    }
    const event = parseBrowserTaskEvent(
      record.value,
      created.taskId,
      created.backend,
    );
    if (record.eventType !== event.type) {
      throw new Error("Browser task stream event type is invalid");
    }
    expectedSequence += 1;
    onEvent(event);
    if (event.type === "completed" || event.type === "error") {
      terminal = event;
    }
  }
  if (!terminal) throw new Error("Browser task stream terminal is missing");
  return terminal;
}

export async function stopBrowserTask(
  created: BrowserTaskCreated,
): Promise<{ taskId: string; status: "stopping" }> {
  const response = await requestJsonWithResponse<unknown>(created.stopUrl, {
    method: "POST",
    body: "{}",
  });
  if (
    !record(response.body) ||
    response.body["taskId"] !== created.taskId ||
    response.body["status"] !== "stopping"
  ) {
    throw new Error("Browser task stop response is invalid");
  }
  assertTaskHeaders(
    response.headers,
    created.taskId,
    created.backend,
    created.stopUrl,
  );
  return { taskId: created.taskId, status: "stopping" };
}

export async function controlBrowserTask(
  created: BrowserTaskCreated,
  action: "pause" | "resume" | "takeover",
): Promise<{
  taskId: string;
  state: "running" | "paused" | "takeover";
  message: string;
}> {
  const path = {
    pause: created.pauseUrl,
    resume: created.resumeUrl,
    takeover: created.takeoverUrl,
  }[action];
  if (!path) throw new Error(`Browser task ${action} is unavailable`);
  const response = await requestJsonWithResponse<unknown>(path, {
    method: "POST",
    body: "{}",
  });
  if (
    !record(response.body) ||
    response.body["taskId"] !== created.taskId ||
    !["running", "paused", "takeover"].includes(
      String(response.body["state"]),
    ) ||
    !boundedString(response.body["message"], 1, 2_048)
  ) {
    throw new Error(`Browser task ${action} response is invalid`);
  }
  assertTaskHeaders(response.headers, created.taskId, created.backend, path);
  return response.body as {
    taskId: string;
    state: "running" | "paused" | "takeover";
    message: string;
  };
}

function parseCreated(value: unknown): BrowserTaskCreated {
  if (
    !record(value) ||
    !["browser_use_local", "browser_use_cloud"].includes(
      String(value["backend"]),
    ) ||
    value["status"] !== "running" ||
    !boundedString(value["taskId"], 1, 128) ||
    !boundedString(value["streamUrl"], 1, 512) ||
    !boundedString(value["stopUrl"], 1, 512) ||
    value["streamUrl"] !==
      `/api/browser-tasks/${encodeURIComponent(value["taskId"])}/stream` ||
    value["stopUrl"] !==
      `/api/browser-tasks/${encodeURIComponent(value["taskId"])}/stop` ||
    !validControlUrls(value)
  ) {
    throw new Error("Browser task create response is invalid");
  }
  return {
    taskId: value["taskId"],
    backend: value["backend"] as BrowserTaskBackend,
    status: "running",
    streamUrl: value["streamUrl"],
    stopUrl: value["stopUrl"],
    ...(typeof value["pauseUrl"] === "string"
      ? { pauseUrl: value["pauseUrl"] }
      : {}),
    ...(typeof value["resumeUrl"] === "string"
      ? { resumeUrl: value["resumeUrl"] }
      : {}),
    ...(typeof value["takeoverUrl"] === "string"
      ? { takeoverUrl: value["takeoverUrl"] }
      : {}),
  };
}

function parseSnapshot(value: unknown): BrowserTaskSnapshot {
  if (
    !record(value) ||
    Object.keys(value).sort().join("\u0000") !==
      "backend\u0000events\u0000input\u0000status\u0000taskId" ||
    value["status"] !== "terminal" ||
    !boundedString(value["taskId"], 1, 128) ||
    !["browser_use_local", "browser_use_cloud"].includes(
      String(value["backend"]),
    ) ||
    !Array.isArray(value["events"])
  ) {
    throw new Error("Latest browser task response is invalid");
  }
  const backend = value["backend"] as BrowserTaskBackend;
  const input = parseTaskInput(value["input"], backend);
  return {
    taskId: value["taskId"],
    backend,
    status: "terminal",
    input,
    events: value["events"].map((event) =>
      parseBrowserTaskEvent(event, value["taskId"] as string, backend),
    ),
  };
}

function parseTaskInput(
  value: unknown,
  backend: BrowserTaskBackend,
): CreateBrowserTaskInput {
  if (
    !record(value) ||
    Object.keys(value).sort().join("\u0000") !==
      "allowedDomains\u0000backend\u0000credentialEnv\u0000maxCostUsd\u0000maxSteps\u0000model\u0000startUrl\u0000task" ||
    value["backend"] !== backend ||
    !boundedString(value["task"], 1, 8_000) ||
    !boundedString(value["startUrl"], 1, 2_048) ||
    typeof value["credentialEnv"] !== "string" ||
    value["credentialEnv"].length > 128 ||
    !record(value["model"]) ||
    Object.keys(value["model"]).sort().join("\u0000") !== "id\u0000provider" ||
    !boundedString(value["model"]["provider"], 1, 32) ||
    !boundedString(value["model"]["id"], 1, 256) ||
    !Array.isArray(value["allowedDomains"]) ||
    !value["allowedDomains"].every((domain) => boundedString(domain, 1, 253)) ||
    !Number.isSafeInteger(value["maxSteps"]) ||
    typeof value["maxCostUsd"] !== "number" ||
    !Number.isFinite(value["maxCostUsd"])
  ) {
    throw new Error("Latest browser task input is invalid");
  }
  return value as unknown as CreateBrowserTaskInput;
}

function assertTaskHeaders(
  headers: Headers,
  taskId: string,
  backend: BrowserTaskBackend,
  path: string,
): void {
  if (
    headers.get("X-Napier-Browser-Task-Id") !== taskId ||
    headers.get("X-Napier-Browser-Backend") !== backend ||
    headers.get("Cache-Control") !== "no-store" ||
    headers.get("X-Content-Type-Options") !== "nosniff"
  ) {
    throw new Error(`Browser task response contract is invalid for ${path}`);
  }
}

function assertInactiveTaskHeaders(headers: Headers, path: string): void {
  if (
    headers.get("Cache-Control") !== "no-store" ||
    headers.get("X-Content-Type-Options") !== "nosniff" ||
    headers.has("X-Napier-Browser-Task-Id") ||
    headers.has("X-Napier-Browser-Backend")
  ) {
    throw new Error(`Browser task response contract is invalid for ${path}`);
  }
}

function validControlUrls(value: Record<string, unknown>): boolean {
  const taskId = String(value["taskId"]);
  if (value["backend"] === "browser_use_cloud") {
    return (
      value["pauseUrl"] === undefined &&
      value["resumeUrl"] === undefined &&
      value["takeoverUrl"] === undefined
    );
  }
  return (
    value["pauseUrl"] ===
      `/api/browser-tasks/${encodeURIComponent(taskId)}/pause` &&
    value["resumeUrl"] ===
      `/api/browser-tasks/${encodeURIComponent(taskId)}/resume` &&
    value["takeoverUrl"] ===
      `/api/browser-tasks/${encodeURIComponent(taskId)}/takeover`
  );
}

function boundedString(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length >= minimum &&
    value.length <= maximum
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
