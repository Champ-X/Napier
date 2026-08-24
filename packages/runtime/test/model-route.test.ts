import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxProvider,
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Model,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import { canonicalJson, sha256 } from "../src/ed25519.js";
import {
  classifyRouteFailure,
  ModelRouter,
  routeCanFallback,
} from "../src/model-route.js";
import { ModelRegistry } from "../src/models.js";
import { LocalStore } from "../src/store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Model route failure policy", () => {
  it.each([
    [{ status: 429, message: "Too many requests" }, "rate_limited"],
    [{ statusCode: 503, message: "Service unavailable" }, "provider_server"],
    [{ code: "ECONNRESET", message: "socket closed" }, "network"],
    [{ message: "context_length_exceeded" }, "context"],
    [{ status: 401, message: "invalid API key" }, "authentication"],
    [{ status: 402, message: "payment required" }, "billing"],
    [{ message: "tool schema is unsupported" }, "tool_dialect"],
    [{ message: "request aborted" }, "cancelled"],
    [{ message: "opaque provider failure" }, "unknown"],
  ] as const)("normalizes %o as %s", (failure, expected) => {
    expect(classifyRouteFailure(failure)).toBe(expected);
  });

  it("permits only retryable failures before output and side effects", () => {
    expect(
      routeCanFallback({
        failureClass: "rate_limited",
        visibleOutputProduced: false,
        sideEffectState: "none",
        hasNextCandidate: true,
        aborted: false,
      }),
    ).toBe(true);
    for (const override of [
      { failureClass: "authentication" as const },
      { visibleOutputProduced: true },
      { sideEffectState: "known" as const },
      { sideEffectState: "unknown" as const },
      { hasNextCandidate: false },
      { aborted: true },
    ]) {
      expect(
        routeCanFallback({
          failureClass: "network",
          visibleOutputProduced: false,
          sideEffectState: "none",
          hasNextCandidate: true,
          aborted: false,
          ...override,
        }),
      ).toBe(false);
    }
  });
});

describe("ModelRouteSession", () => {
  it("records an immutable plan and falls back before presenting output", async () => {
    const fixture = await createFixture();
    const session = await fixture.router.createSession({
      run: fixture.run,
      primary: fixture.primary,
      request: {
        role: "reasoning",
        fallbackModels: [{ provider: "route-fixture", id: "fallback" }],
      },
    });
    const invoked: string[] = [];
    const stream = session.stream({
      signal: new AbortController().signal,
      invoke: async (model) => {
        invoked.push(model.id);
        return model.id === "primary"
          ? terminalStream(model, "error", "HTTP 503 service unavailable")
          : terminalStream(model, "stop", "served by fallback");
      },
    });

    const streamed = await collect(stream);
    const result = await stream.result();
    const routeEvents = (
      await fixture.store.listEvents(fixture.thread.id)
    ).filter((event) => event.runId === fixture.run.id);

    expect(invoked).toEqual(["primary", "fallback"]);
    expect(result).toEqual(
      expect.objectContaining({
        provider: "route-fixture",
        model: "fallback",
        stopReason: "stop",
      }),
    );
    expect(streamed.map((event) => event.type)).toEqual(["start", "done"]);
    expect(JSON.stringify(streamed)).not.toContain("service unavailable");
    expect(routeEvents.map((event) => event.type)).toEqual([
      "route_plan_created",
      "route_attempt_started",
      "route_attempt_ended",
      "route_attempt_started",
      "route_attempt_ended",
    ]);
    expect(routeEvents[0]!.payload).toEqual(
      expect.objectContaining({
        role: "reasoning",
        candidates: [
          expect.objectContaining({ modelId: "primary" }),
          expect.objectContaining({ modelId: "fallback" }),
        ],
      }),
    );
    expect(routeEvents[2]!.payload).toEqual(
      expect.objectContaining({
        modelId: "primary",
        outcome: "retryable",
        failureClass: "provider_server",
        visibleOutputProduced: false,
        sideEffectState: "none",
      }),
    );
    expect(routeEvents[3]!.payload).toEqual(
      expect.objectContaining({
        modelId: "fallback",
        fallbackFromAttempt: 1,
        fallbackReason: "provider_server",
      }),
    );
    expect(routeEvents[4]!.payload).toEqual(
      expect.objectContaining({ modelId: "fallback", outcome: "success" }),
    );
    for (const event of routeEvents) assertPayloadHash(event.payload);
    expect(routeEvents[1]!.payload["contentSha256"]).not.toBe(
      routeEvents[2]!.payload["contentSha256"],
    );
    fixture.store.close();
  });

  it("does not treat an empty provider text block as visible output", async () => {
    const fixture = await createFixture();
    const session = await fixture.router.createSession({
      run: fixture.run,
      primary: fixture.primary,
      request: {
        fallbackModels: [{ provider: "route-fixture", id: "fallback" }],
      },
    });
    const invoked: string[] = [];
    const stream = session.stream({
      signal: new AbortController().signal,
      invoke: async (model) => {
        invoked.push(model.id);
        return model.id === "primary"
          ? emptyTextFailureStream(model, "HTTP 503 service unavailable")
          : terminalStream(model, "stop", "served by fallback");
      },
    });

    const streamed = await collect(stream);
    expect(invoked).toEqual(["primary", "fallback"]);
    expect(streamed.map((event) => event.type)).toEqual(["start", "done"]);
    const attempts = (await fixture.store.listEvents(fixture.thread.id)).filter(
      (event) =>
        event.runId === fixture.run.id && event.type === "route_attempt_ended",
    );
    expect(attempts[0]?.payload).toEqual(
      expect.objectContaining({
        outcome: "retryable",
        visibleOutputProduced: false,
      }),
    );
    fixture.store.close();
  });

  it("never falls back after visible output", async () => {
    const fixture = await createFixture();
    const session = await fixture.router.createSession({
      run: fixture.run,
      primary: fixture.primary,
      request: {
        fallbackModels: [{ provider: "route-fixture", id: "fallback" }],
      },
    });
    const invoked: string[] = [];
    const stream = session.stream({
      signal: new AbortController().signal,
      invoke: async (model) => {
        invoked.push(model.id);
        return visibleFailureStream(model, "HTTP 429 rate limit");
      },
    });

    const streamed = await collect(stream);
    expect(invoked).toEqual(["primary"]);
    expect(streamed.map((event) => event.type)).toEqual([
      "start",
      "text_start",
      "text_delta",
      "error",
    ]);
    expect((await stream.result()).stopReason).toBe("error");
    const ended = (await fixture.store.listEvents(fixture.thread.id)).find(
      (event) =>
        event.runId === fixture.run.id && event.type === "route_attempt_ended",
    );
    expect(ended?.payload).toEqual(
      expect.objectContaining({
        outcome: "terminal",
        visibleOutputProduced: true,
        failureClass: "rate_limited",
      }),
    );
    fixture.store.close();
  });

  it("never falls back while a write side effect is unresolved", async () => {
    const fixture = await createFixture();
    const session = await fixture.router.createSession({
      run: fixture.run,
      primary: fixture.primary,
      request: {
        fallbackModels: [{ provider: "route-fixture", id: "fallback" }],
      },
    });
    await fixture.store.appendEvent({
      threadId: fixture.thread.id,
      runId: fixture.run.id,
      type: "tool.started",
      category: "tool",
      visibility: "user",
      payload: {
        callId: "call_pending",
        toolName: "apply_patch",
        effect: "write",
      },
    });
    const invoked: string[] = [];
    const stream = session.stream({
      signal: new AbortController().signal,
      invoke: async (model) => {
        invoked.push(model.id);
        return terminalStream(model, "error", "network error");
      },
    });

    await collect(stream);
    expect(invoked).toEqual(["primary"]);
    const ended = (await fixture.store.listEvents(fixture.thread.id)).find(
      (event) =>
        event.runId === fixture.run.id && event.type === "route_attempt_ended",
    );
    expect(ended?.payload).toEqual(
      expect.objectContaining({
        outcome: "terminal",
        sideEffectState: "unknown",
      }),
    );
    fixture.store.close();
  });
});

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-model-route-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  const store = new LocalStore({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
  });
  await store.initialize();
  const agent = store.listAgents()[0]!;
  const thread = await store.createThread({
    title: "Model route",
    agentId: agent.id,
  });
  const run = await store.createRun({
    threadId: thread.id,
    agentId: agent.id,
    model: { provider: "route-fixture", id: "primary" },
  });
  const registry = new ModelRegistry();
  registry.registerProvider(
    fauxProvider({
      provider: "route-fixture",
      models: [
        { id: "primary", reasoning: false },
        { id: "fallback", reasoning: false },
      ],
    }).provider,
  );
  const primary = await registry.resolveConfigured({
    provider: "route-fixture",
    id: "primary",
  });
  if (!primary) throw new Error("Primary route fixture was not resolved");
  return {
    store,
    thread,
    run,
    primary,
    router: new ModelRouter(store, registry),
  };
}

function terminalStream(
  model: Model<Api>,
  stopReason: "stop" | "error",
  text: string,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const message = modelMessage(model, stopReason === "stop" ? text : "", {
    stopReason,
    ...(stopReason === "error" ? { errorMessage: text } : {}),
  });
  stream.push({ type: "start", partial: message });
  stream.push(
    stopReason === "stop"
      ? { type: "done", reason: "stop", message }
      : { type: "error", reason: "error", error: message },
  );
  return stream;
}

function visibleFailureStream(
  model: Model<Api>,
  diagnostic: string,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const partial = modelMessage(model, "partial");
  const failure = modelMessage(model, "", {
    stopReason: "error",
    errorMessage: diagnostic,
  });
  stream.push({ type: "start", partial });
  stream.push({ type: "text_start", contentIndex: 0, partial });
  stream.push({
    type: "text_delta",
    contentIndex: 0,
    delta: "partial",
    partial,
  });
  stream.push({ type: "error", reason: "error", error: failure });
  return stream;
}

function emptyTextFailureStream(
  model: Model<Api>,
  diagnostic: string,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const partial = modelMessage(model, "", { stopReason: "partial" });
  const failure = modelMessage(model, "", {
    stopReason: "error",
    errorMessage: diagnostic,
  });
  stream.push({ type: "start", partial });
  stream.push({ type: "text_start", contentIndex: 0, partial });
  stream.push({ type: "text_end", contentIndex: 0, content: "", partial });
  stream.push({ type: "error", reason: "error", error: failure });
  return stream;
}

function modelMessage(
  model: Model<Api>,
  text: string,
  options: {
    stopReason?: AssistantMessage["stopReason"];
    errorMessage?: string;
  } = {},
): AssistantMessage {
  return {
    ...fauxAssistantMessage(text, options),
    api: model.api,
    provider: model.provider,
    model: model.id,
  };
}

async function collect(stream: AssistantMessageEventStream) {
  const events: AssistantMessageEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

function assertPayloadHash(payload: Record<string, unknown>): void {
  const { contentSha256, ...content } = payload;
  expect(contentSha256).toBe(sha256(canonicalJson(content)));
}
