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

import { ModelRouter } from "../src/model-route.js";
import { ModelRegistry } from "../src/models.js";
import { LocalStore } from "../src/store.js";

const fixtureRoots: string[] = [];

export async function cleanupModelRouteFixtures(): Promise<void> {
  await Promise.all(
    fixtureRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
}

export async function createModelRouteFixture(
  options: {
    noRetryDelay?: boolean;
    abortRetryWait?: AbortController;
  } = {},
) {
  const root = await mkdtemp(path.join(tmpdir(), "napier-model-route-"));
  fixtureRoots.push(root);
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
  const router = options.abortRetryWait
    ? new AbortRetryWaitModelRouter(store, registry, options.abortRetryWait)
    : options.noRetryDelay
      ? new NoRetryDelayModelRouter(store, registry)
      : new ModelRouter(store, registry);
  return { store, thread, run, primary, router };
}

class NoRetryDelayModelRouter extends ModelRouter {
  override waitBeforeRetry(
    _delayMs: number,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    return Promise.resolve();
  }
}

class AbortRetryWaitModelRouter extends ModelRouter {
  constructor(
    store: LocalStore,
    registry: ModelRegistry,
    private readonly abortController: AbortController,
  ) {
    super(store, registry);
  }

  override waitBeforeRetry(
    _delayMs: number,
    signal: AbortSignal,
  ): Promise<void> {
    this.abortController.abort(new Error("Abort fallback retry wait"));
    signal.throwIfAborted();
    return Promise.resolve();
  }
}

export function terminalStream(
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

export function visibleFailureStream(
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

export function openVisibleStream(
  model: Model<Api>,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const partial = modelMessage(model, "partial");
  stream.push({ type: "start", partial });
  stream.push({ type: "text_start", contentIndex: 0, partial });
  stream.push({
    type: "text_delta",
    contentIndex: 0,
    delta: "partial",
    partial,
  });
  return stream;
}

export function emptyTextFailureStream(
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

export function thinkingFailureStream(
  model: Model<Api>,
  thinking: string,
  diagnostic: string,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const partial = modelMessage(model, "", { stopReason: "partial" });
  const failure = modelMessage(model, "", {
    stopReason: "error",
    errorMessage: diagnostic,
  });
  stream.push({ type: "start", partial });
  stream.push({
    type: "thinking_delta",
    contentIndex: 0,
    delta: thinking,
    partial,
  });
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

export async function collectModelRouteStream(
  stream: AssistantMessageEventStream,
): Promise<AssistantMessageEvent[]> {
  const events: AssistantMessageEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

export async function resolveWithin<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `Promise did not resolve within ${String(timeoutMs)} ms`,
              ),
            ),
          timeoutMs,
        );
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
