import {
  createAssistantMessageEventStream,
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Context,
} from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";

import {
  createAdmittedModels,
  ModelCallAdmissionError,
  preserveModelAdmissionFailure,
  type ModelCallAdmission,
} from "../src/model-call-admission.js";
import { ModelRegistry } from "../src/models.js";
import { classifyRouteFailure, routeCanFallback, routeCanRetrySameCandidate } from "../src/model-route-policy.js";
import { modelStream } from "../src/model-stream-cancellation.js";

const context: Context = { messages: [{ role: "user", content: "Reply briefly.", timestamp: 1 }] };

function fixture(settle = vi.fn((_message?: AssistantMessage) => undefined)) {
  const provider = fauxProvider({ provider: "admission-test", models: [{ id: "tiny", maxTokens: 100 }] });
  provider.setResponses([fauxAssistantMessage("done")]);
  const models = createModels(); models.setProvider(provider.provider);
  const reserve = vi.fn((_input: Parameters<ModelCallAdmission["reserve"]>[0]) => ({ settle }));
  return { provider, raw: models, models: createAdmittedModels(models, { reserve }), reserve, settle, model: provider.getModel() };
}

async function collect(source: AssistantMessageEventStream) {
  const events: AssistantMessageEvent[] = [];
  for await (const event of source) events.push(event);
  return events;
}

describe("physical model invocation admission", () => {
  it.each(["stream", "streamSimple", "complete", "completeSimple"] as const)(
    "reserves and settles %s once through actual pi-ai methods, including result-only callers", async (method) => {
      const f = fixture();
      const options = { maxTokens: 27, maxRetries: 3, metadata: { purpose: "unchanged" } };
      const output = f.models[method](f.model, context, options);
      const response = await ("result" in output ? output.result() : output);
      expect(response.stopReason).toBe("stop");
      expect(f.provider.state.callCount).toBe(1);
      expect(f.reserve).toHaveBeenCalledExactlyOnceWith({ method, model: f.model, options });
      expect(f.settle).toHaveBeenCalledExactlyOnceWith(response);
      if ("result" in output) {
        expect((await collect(output)).at(-1)?.type).toBe("done");
        expect(await output.result()).toBe(response);
        expect(f.settle).toHaveBeenCalledTimes(1);
      }
    },
  );

  it.each(["stream", "streamSimple", "complete", "completeSimple"] as const)(
    "does not reserve or dispatch pre-aborted %s", async (method) => {
      const f = fixture();
      const abort = new AbortController(); abort.abort(new Error("Caller stopped"));
      if (method === "stream" || method === "streamSimple") {
        expect(() => f.models[method](f.model, context, { signal: abort.signal })).toThrow("Caller stopped");
      } else {
        await expect(f.models[method](f.model, context, { signal: abort.signal })).rejects.toThrow("Caller stopped");
      }
      expect(f.reserve).not.toHaveBeenCalled();
      expect(f.provider.state.callCount).toBe(0);
    },
  );

  it("retains the lease after iterator closure and caller abort until the provider result actually settles", async () => {
    const f = fixture();
    const source = createAssistantMessageEventStream();
    const message = fauxAssistantMessage("eventual result");
    f.raw.streamSimple = () => source;
    const abort = new AbortController();
    const output = f.models.streamSimple(f.model, context, { signal: abort.signal });
    source.push({ type: "start", partial: message });
    const iterator = output[Symbol.asyncIterator]();
    expect((await iterator.next()).value?.type).toBe("start");
    await iterator.return?.(); abort.abort();
    expect(f.settle).not.toHaveBeenCalled();
    source.push({ type: "done", reason: "stop", message });
    expect(await output.result()).toBe(message);
    expect(f.settle).toHaveBeenCalledExactlyOnceWith(message);
  });

  it("freezes detached admission model data before provider code can mutate the request", async () => {
    const f = fixture();
    const source = createAssistantMessageEventStream();
    const options = { maxTokens: 27, maxRetries: 2 };
    f.raw.streamSimple = (model, _context, requestOptions) => {
      model.cost.input = 99;
      model.maxTokens = 777;
      requestOptions!.maxTokens = 333;
      return source;
    };
    const output = f.models.streamSimple(f.model, context, options);
    const snapshot = f.reserve.mock.calls[0]![0];
    expect(snapshot.model.maxTokens).toBe(100);
    expect(snapshot.model.cost.input).not.toBe(99);
    expect(snapshot.options?.maxTokens).toBe(27);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.model.cost)).toBe(true);
    expect(Object.isFrozen(snapshot.options)).toBe(true);
    const message = fauxAssistantMessage("done");
    source.push({ type: "done", reason: "stop", message });
    await output.result();
  });

  it.each(["streamSimple", "completeSimple"] as const)("retains uncertainty when physical %s throws", async (method) => {
    const f = fixture();
    const failure = new Error("Physical dispatch failed");
    if (method === "streamSimple") {
      f.raw.streamSimple = () => { throw failure; };
      expect(() => f.models.streamSimple(f.model, context)).toThrow(failure);
    } else {
      f.raw.completeSimple = async () => { throw failure; };
      await expect(f.models.completeSimple(f.model, context)).rejects.toBe(failure);
    }
    expect(f.settle).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  it("settles a rejected physical result independently of consumer iteration", async () => {
    const f = fixture();
    const source = createAssistantMessageEventStream();
    const failure = new Error("Provider result failed");
    source.result = async () => { throw failure; };
    f.raw.stream = () => source;
    const output = f.models.stream(f.model, context);
    await expect(output.result()).rejects.toBe(failure);
    await expect(collect(output)).rejects.toBe(failure);
    expect(f.settle).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  it("withholds successful terminal and result when durable settlement fails", async () => {
    const cause = new Error("database unavailable");
    const f = fixture(vi.fn(() => { throw cause; }));
    const output = f.models.streamSimple(f.model, context);
    const events: AssistantMessageEvent[] = [];
    const consumed = (async () => { for await (const event of output) events.push(event); })();
    await expect(output.result()).rejects.toMatchObject({ code: "accounting", cause });
    await expect(consumed).rejects.toBeInstanceOf(ModelCallAdmissionError);
    expect(events.some((event) => event.type === "done")).toBe(false);
    expect(f.settle).toHaveBeenCalledTimes(1);
  });

  it("does not return a complete response when durable settlement fails", async () => {
    const f = fixture(vi.fn(() => { throw new Error("disk failure"); }));
    await expect(f.models.completeSimple(f.model, context)).rejects.toMatchObject({ code: "accounting" });
    expect(f.settle).toHaveBeenCalledTimes(1);
  });

  it("denies capacity before provider dispatch and does not turn host failures into provider retries", async () => {
    const f = fixture();
    const denied = new ModelCallAdmissionError("capacity", { cause: new Error("network timeout during database access") });
    f.reserve.mockImplementation(() => { throw denied; });
    expect(() => f.models.streamSimple(f.model, context)).toThrow(denied);
    expect(f.provider.state.callCount).toBe(0);
    expect(f.settle).not.toHaveBeenCalled();
    for (const error of [denied, preserveModelAdmissionFailure(denied, fauxAssistantMessage("", { stopReason: "error", errorMessage: denied.message }))]) {
      const failureClass = classifyRouteFailure(error);
      expect(failureClass).toBe("unknown");
      expect(routeCanFallback({ failureClass, visibleOutputProduced: false, sideEffectState: "none", hasNextCandidate: true, aborted: false })).toBe(false);
      expect(routeCanRetrySameCandidate({ failureClass, visibleOutputProduced: false, sideEffectState: "none", hasRetryAttempt: true, aborted: false })).toBe(false);
    }
  });

  it("normalizes unexpected admission storage failures without dispatching", () => {
    const f = fixture();
    const cause = new Error("socket timeout in admission storage");
    f.reserve.mockImplementation(() => { throw cause; });
    expect(() => f.models.streamSimple(f.model, context)).toThrow(expect.objectContaining({ code: "accounting", cause }));
    expect(f.provider.state.callCount).toBe(0);
  });

  it.each(["capacity", "budget", "accounting", "closed"] as const)(
    "preserves host-owned %s failures through the admission classifier", (code) => {
      const f = fixture();
      const cause = new Error("Host-local failure with provider timeout wording");
      f.reserve.mockImplementation(() => { throw cause; });
      const errorCode = vi.fn((error: unknown) => error === cause ? code : undefined);
      const models = createAdmittedModels(f.raw, { reserve: f.reserve, errorCode });
      let failure: unknown;
      try { models.streamSimple(f.model, context); } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(ModelCallAdmissionError);
      expect(failure).toMatchObject({ code, cause });
      expect(classifyRouteFailure(failure)).toBe("unknown");
      expect(errorCode).toHaveBeenCalledExactlyOnceWith(cause);
      expect(f.provider.state.callCount).toBe(0);
      expect(f.settle).not.toHaveBeenCalled();
    },
  );

  it("fails closed when the host classifier throws or returns an unsupported code", () => {
    const f = fixture();
    const cause = new Error("Host storage failure");
    f.reserve.mockImplementation(() => { throw cause; });
    for (const errorCode of [
      () => { throw new Error("Classifier failed"); },
      () => "timeout" as never,
      () => undefined,
    ]) {
      const models = createAdmittedModels(f.raw, { reserve: f.reserve, errorCode });
      expect(() => models.streamSimple(f.model, context))
        .toThrow(expect.objectContaining({ code: "accounting", cause }));
    }
    expect(f.provider.state.callCount).toBe(0);
  });

  it("always treats settlement failure as accounting without invoking the reserve classifier", async () => {
    const cause = new Error("Settlement failed");
    const f = fixture(vi.fn(() => { throw cause; }));
    const errorCode = vi.fn(() => "capacity" as const);
    const models = createAdmittedModels(f.raw, { reserve: f.reserve, errorCode });
    await expect(models.completeSimple(f.model, context)).rejects.toMatchObject({ code: "accounting", cause });
    expect(errorCode).not.toHaveBeenCalled();
    expect(f.settle).toHaveBeenCalledTimes(1);
  });

  it("preserves accounting failure through the existing cancellation stream", async () => {
    const f = fixture(vi.fn(() => { throw new Error("disk failure"); }));
    const output = modelStream({
      budget: { remainingTimeoutMs: () => 30_000 },
      registry: { models: f.models }, store: {}, run: { id: "run_admission", threadId: "thread_admission" },
      onEvent: undefined,
    } as Parameters<typeof modelStream>[0], f.model, context, undefined);
    const events = await collect(output);
    const terminal = await output.result();
    expect(events.at(-1)?.type).toBe("error");
    expect(terminal.stopReason).toBe("error");
    expect(classifyRouteFailure(terminal)).toBe("unknown");
    expect(f.settle).toHaveBeenCalledTimes(1);
  });

  it("does not release admission when the outer Runtime cancellation has already returned", async () => {
    const f = fixture();
    const source = createAssistantMessageEventStream();
    f.raw.streamSimple = () => source;
    const abort = new AbortController();
    const output = modelStream({
      budget: { remainingTimeoutMs: () => 30_000 },
      registry: { models: f.models }, store: {}, run: { id: "run_admission", threadId: "thread_admission" },
      onEvent: undefined,
    } as Parameters<typeof modelStream>[0], f.model, context, { signal: abort.signal });
    abort.abort();
    expect((await output.result()).stopReason).toBe("aborted");
    expect(f.settle).not.toHaveBeenCalled();
    const message = fauxAssistantMessage("Provider ignored caller abort");
    source.push({ type: "done", reason: "stop", message });
    await vi.waitFor(() => expect(f.settle).toHaveBeenCalledExactlyOnceWith(message));
  });

  it("injects at ModelRegistry below adapter normalization and preserves actual provider options", async () => {
    const settle = vi.fn();
    const reserve = vi.fn((_input: Parameters<ModelCallAdmission["reserve"]>[0]) => ({ settle }));
    const registry = new ModelRegistry(undefined, { reserve });
    const provider = fauxProvider({ provider: "admission-registry", models: [{ id: "tiny", maxTokens: 100 }] });
    let observed: unknown;
    provider.setResponses([(_context, options) => { observed = options; return fauxAssistantMessage("done"); }]);
    registry.registerProvider(provider.provider);
    await registry.models.completeSimple(provider.getModel(), context, { maxTokens: 200, maxRetries: 3 });
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(reserve.mock.calls[0]?.[0].options).toMatchObject({ maxTokens: 100, maxRetries: 3 });
    expect(observed).toMatchObject({ maxTokens: 100, maxRetries: 3 });
    expect(provider.state.callCount).toBe(1);
    expect(settle).toHaveBeenCalledTimes(1);
  });
});
