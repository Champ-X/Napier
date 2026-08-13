import { isIP } from "node:net";

import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";

import {
  BrowserTaskService,
  BrowserTaskServiceError,
  type BrowserTaskCreateInput,
  type BrowserTaskBackend,
  type BrowserTaskEvent,
  type BrowserTaskSnapshot,
} from "./browser-task-service.js";
import {
  errorMessage,
  jsonError,
  setBodyContentSha256Header,
  setContentSha256Header,
  sha256Bytes,
} from "./http-response-evidence.js";
import {
  readLimitedJson,
  RequestBodyTooLargeError,
} from "./http-request-body.js";

const MAX_BROWSER_TASK_REQUEST_BYTES = 16 * 1024;
const MODEL_PROVIDERS = new Set([
  "openai",
  "anthropic",
  "google",
  "browser-use",
  "deepseek",
  "openrouter",
]);

export function registerBrowserTaskHttp(
  app: Hono,
  browserTasks: BrowserTaskService,
): void {
  app.get("/api/browser-tasks/active", (context) => {
    const active = browserTasks.active();
    const body = { active: active ?? null };
    context.header("Cache-Control", "no-store");
    context.header("X-Content-Type-Options", "nosniff");
    if (active) {
      setBrowserTaskHeaders(context, active.taskId, active.backend);
    }
    setBodyContentSha256Header(context, body);
    return context.json(body);
  });

  app.get("/api/browser-tasks/latest", async (context) => {
    try {
      const latest = await browserTasks.latest();
      const body = {
        latest: latest ? publicBrowserTaskSnapshot(latest) : null,
      };
      context.header("Cache-Control", "no-store");
      context.header("X-Content-Type-Options", "nosniff");
      if (latest) {
        setBrowserTaskHeaders(context, latest.taskId, latest.backend);
      }
      setBodyContentSha256Header(context, body);
      return context.json(body);
    } catch (error) {
      return browserTaskError(context, error);
    }
  });

  app.post("/api/browser-tasks", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_BROWSER_TASK_REQUEST_BYTES,
        "Browser task request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseBrowserTaskCreateInput(input);
    if (!body) {
      return jsonError(context, "Browser task request is invalid", 400);
    }
    try {
      const created = await browserTasks.create(body);
      setBrowserTaskHeaders(context, created.taskId, created.backend);
      setBodyContentSha256Header(context, created);
      return context.json(created, 201);
    } catch (error) {
      return browserTaskError(context, error);
    }
  });

  app.get("/api/browser-tasks/:taskId/stream", (context) => {
    const taskId = context.req.param("taskId");
    let backend: BrowserTaskBackend;
    let taskEvents: AsyncGenerator<BrowserTaskEvent>;
    try {
      backend = browserTasks.backend(taskId);
      taskEvents = browserTasks.events(taskId, context.req.raw.signal);
    } catch (error) {
      return browserTaskError(context, error);
    }
    const response = streamSSE(context, async (stream) => {
      let sequence = 0;
      try {
        for await (const event of taskEvents) {
          sequence += 1;
          await stream.writeSSE({
            event: event.type,
            id: String(sequence),
            data: JSON.stringify(publicBrowserTaskEvent(taskId, event)),
          });
        }
      } catch (error) {
        if (!context.req.raw.signal.aborted) throw error;
      }
    });
    setBrowserTaskHeaders(response.headers, taskId, backend);
    response.headers.set("Content-Type", "text/event-stream");
    response.headers.set("X-Accel-Buffering", "no");
    return response;
  });

  app.post("/api/browser-tasks/:taskId/stop", async (context) => {
    try {
      const backend = browserTasks.backend(context.req.param("taskId"));
      const result = await browserTasks.stop(context.req.param("taskId"));
      setBrowserTaskHeaders(context, result.taskId, backend);
      setBodyContentSha256Header(context, result);
      return context.json(result);
    } catch (error) {
      return browserTaskError(context, error);
    }
  });

  for (const action of ["pause", "resume", "takeover"] as const) {
    app.post(`/api/browser-tasks/:taskId/${action}`, async (context) => {
      try {
        const taskId = context.req.param("taskId");
        const backend = browserTasks.backend(taskId);
        const result = await browserTasks.control(taskId, action);
        setBrowserTaskHeaders(context, result.taskId, backend);
        setBodyContentSha256Header(context, result);
        return context.json(result);
      } catch (error) {
        return browserTaskError(context, error);
      }
    });
  }

  app.get("/api/browser-tasks/:taskId/screenshots/:step", async (context) => {
    const step = Number(context.req.param("step"));
    if (!Number.isSafeInteger(step) || step < 0 || step > 100) {
      return jsonError(context, "Browser task screenshot step is invalid", 400);
    }
    try {
      const backend = browserTasks.backend(context.req.param("taskId"));
      const bytes = await browserTasks.screenshot(
        context.req.param("taskId"),
        step,
      );
      const body = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      context.header("Content-Type", "image/png");
      context.header("Content-Length", String(bytes.byteLength));
      context.header("Cache-Control", "no-store");
      context.header("X-Content-Type-Options", "nosniff");
      setBrowserTaskHeaders(context, context.req.param("taskId"), backend);
      setContentSha256Header(context, sha256Bytes(Buffer.from(bytes)), "body");
      return context.body(body);
    } catch (error) {
      return browserTaskError(context, error);
    }
  });
}

function parseBrowserTaskCreateInput(
  input: unknown,
): BrowserTaskCreateInput | undefined {
  if (!browserTaskCreateShape(input)) return undefined;
  const model = input["model"];
  const domainsInput = input["allowedDomains"];
  if (!record(model) || !Array.isArray(domainsInput)) return undefined;
  if (!validBrowserTaskModel(model, input["backend"])) return undefined;
  const allowedDomains = domainsInput.map((value) =>
    String(value).trim().toLowerCase(),
  );
  if (
    allowedDomains.some(
      (domain) =>
        !/^(?:\*\.)?[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/u.test(domain) ||
        domain.includes("..") ||
        !publicDomain(domain),
    )
  ) {
    return undefined;
  }
  let startUrl: URL;
  try {
    startUrl = new URL(String(input["startUrl"]).trim());
  } catch {
    return undefined;
  }
  if (
    !["http:", "https:"].includes(startUrl.protocol) ||
    startUrl.username ||
    startUrl.password ||
    !publicDomain(startUrl.hostname.toLowerCase()) ||
    !domainAllowed(startUrl.hostname.toLowerCase(), allowedDomains)
  ) {
    return undefined;
  }
  return {
    backend: input["backend"] as BrowserTaskBackend,
    task: String(input["task"]).trim(),
    startUrl: startUrl.href,
    credentialEnv: String(input["credentialEnv"]),
    maxSteps: Number(input["maxSteps"]),
    maxCostUsd: Number(input["maxCostUsd"]),
    allowedDomains,
    model: {
      provider: String(model["provider"]),
      id: String(model["id"]).trim(),
    },
  };
}

function browserTaskCreateShape(
  input: unknown,
): input is Record<string, unknown> {
  if (!record(input) || !exactBrowserTaskKeys(input)) return false;
  return (
    validBrowserTaskScalars(input) &&
    validBrowserTaskBudget(input) &&
    validAllowedDomainInput(input["allowedDomains"])
  );
}

function exactBrowserTaskKeys(input: Record<string, unknown>): boolean {
  const expected = [
    "allowedDomains",
    "backend",
    "credentialEnv",
    "maxCostUsd",
    "maxSteps",
    "model",
    "startUrl",
    "task",
  ];
  return (
    Object.keys(input).sort().join("\u0000") === expected.sort().join("\u0000")
  );
}

function validBrowserTaskScalars(input: Record<string, unknown>): boolean {
  return (
    ["browser_use_local", "browser_use_cloud"].includes(
      String(input["backend"]),
    ) &&
    boundedString(input["task"], 1, 8_000) &&
    boundedString(input["startUrl"], 1, 2_048) &&
    typeof input["credentialEnv"] === "string" &&
    (input["credentialEnv"] === "" ||
      (boundedString(input["credentialEnv"], 1, 128) &&
        /^[A-Za-z_][A-Za-z0-9_]{0,127}$/u.test(input["credentialEnv"])))
  );
}

function validBrowserTaskBudget(input: Record<string, unknown>): boolean {
  return (
    Number.isSafeInteger(input["maxSteps"]) &&
    Number(input["maxSteps"]) >= 1 &&
    Number(input["maxSteps"]) <= 100 &&
    typeof input["maxCostUsd"] === "number" &&
    Number.isFinite(input["maxCostUsd"]) &&
    input["maxCostUsd"] >= 0.01 &&
    input["maxCostUsd"] <= 100
  );
}

function validAllowedDomainInput(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= 20 &&
    value.every((domain) => boundedString(domain, 1, 253))
  );
}

function validBrowserTaskModel(
  model: Record<string, unknown>,
  backend: unknown,
): boolean {
  if (Object.keys(model).sort().join("\u0000") !== "id\u0000provider")
    return false;
  if (!boundedString(model["provider"], 1, 32)) return false;
  if (!MODEL_PROVIDERS.has(model["provider"])) return false;
  if (!boundedString(model["id"], 1, 256)) return false;
  return backend !== "browser_use_cloud" || model["provider"] === "browser-use";
}

function publicDomain(value: string): boolean {
  const domain = value.startsWith("*.") ? value.slice(2) : value;
  return (
    isIP(domain.replace(/^\[|\]$/gu, "")) === 0 &&
    domain !== "localhost" &&
    !domain.endsWith(".localhost")
  );
}

function domainAllowed(hostname: string, domains: string[]): boolean {
  return domains.some((domain) =>
    domain.startsWith("*.")
      ? hostname === domain.slice(2) || hostname.endsWith(domain.slice(1))
      : hostname === domain,
  );
}

function publicBrowserTaskEvent(
  taskId: string,
  event: BrowserTaskEvent,
): Record<string, unknown> {
  const publicEvent = pickEventFields(event, PUBLIC_EVENT_FIELDS[event.type]);
  return event.type === "step" && event.screenshotPath
    ? {
        ...publicEvent,
        screenshotUrl: `/api/browser-tasks/${encodeURIComponent(taskId)}/screenshots/${String(event.step)}`,
      }
    : publicEvent;
}

function publicBrowserTaskSnapshot(
  snapshot: BrowserTaskSnapshot,
): Record<string, unknown> {
  return {
    taskId: snapshot.taskId,
    backend: snapshot.backend,
    status: "terminal",
    input: {
      backend: snapshot.input.backend,
      task: snapshot.input.task,
      startUrl: snapshot.input.startUrl,
      model: {
        provider: snapshot.input.model.provider,
        id: snapshot.input.model.id,
      },
      credentialEnv: snapshot.input.credentialEnv,
      allowedDomains: [...snapshot.input.allowedDomains],
      maxSteps: snapshot.input.maxSteps,
      maxCostUsd: snapshot.input.maxCostUsd,
    },
    events: snapshot.events.map((event) =>
      publicBrowserTaskEvent(snapshot.taskId, event),
    ),
  };
}

const PUBLIC_EVENT_FIELDS: Readonly<
  Record<BrowserTaskEvent["type"], readonly string[]>
> = {
  started: [
    "type",
    "backend",
    "model",
    "allowedDomainCount",
    "costStatus",
    "interactionPolicy",
    "startUrl",
    "dataFlow",
    "workspaceAccess",
    "secretForwarding",
    "recording",
    "retentionPolicy",
    "costLimitMode",
    "maxCostUsd",
    "credentialStatus",
    "pauseAvailable",
    "takeoverAvailable",
    "browserVisibility",
    "browserProduct",
    "browserVersion",
    "pauseMode",
    "challengeMode",
    "cancelMode",
  ],
  step: [
    "type",
    "backend",
    "step",
    "url",
    "title",
    "nextGoal",
    "actionNames",
    "errorCode",
    "errorMessage",
    "errorDiagnosticSha256",
  ],
  control: [
    "type",
    "backend",
    "state",
    "pauseAvailable",
    "takeoverAvailable",
    "browserVisibility",
    "message",
  ],
  completed: [
    "type",
    "backend",
    "status",
    "result",
    "stepCount",
    "costStatus",
    "costUsd",
    "totalTokens",
    "recovery",
    "artifactDirectory",
    "providerTaskId",
    "retentionPolicy",
  ],
  error: ["type", "backend", "code", "message", "diagnosticSha256", "recovery"],
};

function pickEventFields(
  event: BrowserTaskEvent,
  keys: readonly string[],
): Record<string, unknown> {
  const source = event as unknown as Record<string, unknown>;
  return Object.fromEntries(
    keys.flatMap((key) =>
      source[key] === undefined ? [] : ([[key, source[key]]] as const),
    ),
  );
}

function browserTaskError(context: Context, error: unknown) {
  if (error instanceof BrowserTaskServiceError) {
    const body = {
      error: error.message,
      code: error.code,
      ...(error.recovery ? { recovery: error.recovery } : {}),
    };
    context.header("Cache-Control", "no-store");
    context.header("X-Napier-Browser-Task-Error-Code", error.code);
    context.header("X-Napier-Error-Status", String(error.status));
    setBodyContentSha256Header(context, body);
    return context.json(body, error.status);
  }
  return jsonError(context, errorMessage(error), 500);
}

function setBrowserTaskHeaders(
  target: Context | Headers,
  taskId: string,
  backend: BrowserTaskBackend,
): void {
  if (target instanceof Headers) {
    target.set("Cache-Control", "no-store");
    target.set("X-Content-Type-Options", "nosniff");
    target.set("X-Napier-Browser-Task-Id", taskId);
    target.set("X-Napier-Browser-Backend", backend);
    return;
  }
  target.header("Cache-Control", "no-store");
  target.header("X-Content-Type-Options", "nosniff");
  target.header("X-Napier-Browser-Task-Id", taskId);
  target.header("X-Napier-Browser-Backend", backend);
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedString(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string {
  return (
    typeof value === "string" &&
    value.trim().length >= minimum &&
    value.length <= maximum
  );
}
