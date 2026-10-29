import {
  createAssistantMessageEventStream,
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  type AssistantMessageEventStream,
  type Context,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAdmittedModels } from "../src/model-call-admission.js";
import { createModelContextEnvelopeReceipt } from "../src/model-context-envelope.js";
import { ModelSession, type ModelSessionCaptureRequest } from "../src/model-session.js";

const context: Context = {
  systemPrompt: "Only this role prompt.",
  messages: [{ role: "user", content: "Only this task context.", timestamp: 1 }],
  tools: [],
};

afterEach(() => vi.useRealTimers());

function fixture() {
  const provider = fauxProvider({ provider: "session-test" });
  provider.setResponses([fauxAssistantMessage("done")]);
  const raw = createModels();
  raw.setProvider(provider.provider);
  const settle = vi.fn();
  const reserve = vi.fn(() => ({ settle }));
  const models = createAdmittedModels(raw, { reserve });
  const assertActive = vi.fn();
  const session = new ModelSession({
    models,
    lifetime: { remainingMs: () => 60_000, assertActive },
  });
  let index = 0;
  const capture = vi.fn(async (request: ModelSessionCaptureRequest) => ({
    context: request.context,
    envelope: createModelContextEnvelopeReceipt({
      turnIndex: index++,
      systemPrompt: request.context.systemPrompt ?? "",
      messages: request.context.messages,
      tools: request.context.tools ?? [],
    }),
  }));
  const request = { phase: "subagent_turn", model: provider.getModel(), context, options: undefined, capture };
  return { provider, raw, models, reserve, settle, assertActive, session, capture, request };
}

async function consume(source: AssistantMessageEventStream) {
  for await (const _event of source) { /* Consume the real provider stream. */ }
  return source.result();
}

describe("shared model session", () => {
  it("captures the exact request before the invoke hook and reserves the physical call once", async () => {
    const f = fixture();
    const order: string[] = [];
    const options: SimpleStreamOptions = { maxTokens: 73, temperature: 0, metadata: { fixture: "preserved" } };
    f.provider.setResponses([(actualContext, actualOptions) => {
      order.push("provider");
      expect(actualContext).toEqual(context);
      expect(actualOptions).toMatchObject(options);
      return fauxAssistantMessage("done");
    }]);
    const opened = await f.session.open({
      ...f.request,
      options,
      capture: async (request) => {
        order.push("capture");
        expect(request.context).toEqual(context);
        expect(request.context).not.toBe(context);
        expect(request.options).toEqual(options);
        return f.capture(request);
      },
      invoke: (captured, next) => {
        order.push("invoke");
        expect(captured.context).toEqual(context);
        expect(captured.envelope.turnIndex).toBe(0);
        return next();
      },
    });
    await consume(opened.source);
    expect(order).toEqual(["capture", "invoke", "provider"]);
    expect(f.reserve).toHaveBeenCalledTimes(1);
    expect(f.settle).toHaveBeenCalledTimes(1);
    expect(f.provider.state.callCount).toBe(1);
  });

  it.each(["lifetime", "request"] as const)("rejects a pre-aborted %s signal before capture and dispatch", async (owner) => {
    const f = fixture();
    const abort = new AbortController();
    abort.abort(new Error("session cancelled"));
    const session = owner === "lifetime"
      ? new ModelSession({ models: f.models, lifetime: { signal: abort.signal, remainingMs: () => 60_000, assertActive: () => undefined } })
      : f.session;
    await expect(session.open({
      ...f.request,
      options: owner === "request" ? { signal: abort.signal } : undefined,
    })).rejects.toThrow("session cancelled");
    expect(f.capture).not.toHaveBeenCalled();
    expect(f.reserve).not.toHaveBeenCalled();
    expect(f.provider.state.callCount).toBe(0);
  });

  it("checks cancellation after awaited capture and before invoking extensions", async () => {
    const f = fixture();
    const abort = new AbortController();
    const invoke = vi.fn((_captured, next: () => AssistantMessageEventStream) => next());
    await expect(f.session.open({
      ...f.request,
      options: { signal: abort.signal },
      capture: async (request) => {
        const captured = await f.capture(request);
        abort.abort(new Error("cancelled during capture"));
        return captured;
      },
      invoke,
    })).rejects.toThrow("cancelled during capture");
    expect(invoke).not.toHaveBeenCalled();
    expect(f.reserve).not.toHaveBeenCalled();
  });

  it("rechecks lifetime after capture and at the extension dispatch boundary", async () => {
    const f = fixture();
    let active = true;
    f.assertActive.mockImplementation(() => { if (!active) throw new Error("expired lifetime"); });
    await expect(f.session.open({
      ...f.request,
      capture: async (request) => {
        const captured = await f.capture(request);
        active = false;
        return captured;
      },
    })).rejects.toThrow("expired lifetime");
    active = true;
    await expect(f.session.open({
      ...f.request,
      invoke: (_captured, next) => { active = false; return next(); },
    })).rejects.toThrow("expired lifetime");
    expect(f.reserve).not.toHaveBeenCalled();
  });

  it("retains the physical lease after logical abort and binds a delayed failure to its invocation", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const hanging = createAssistantMessageEventStream();
    f.raw.streamSimple = () => hanging;
    const cancelled = new AbortController();
    const failure = vi.fn();
    const first = await f.session.open({
      ...f.request,
      options: { signal: cancelled.signal },
      onCancellationFailure: failure,
    });
    const waiting = consume(first.source);
    cancelled.abort();
    expect((await waiting).stopReason).toBe("aborted");
    expect(f.settle).not.toHaveBeenCalled();

    const laterSource = createAssistantMessageEventStream();
    const laterMessage = fauxAssistantMessage("later call");
    laterSource.push({ type: "done", reason: "stop", message: laterMessage });
    f.raw.streamSimple = () => laterSource;
    const later = await f.session.open({ ...f.request, phase: "typed_repair" });
    await consume(later.source);
    expect(f.settle).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(failure).toHaveBeenCalledExactlyOnceWith(
      { provider: f.request.model.provider, model: f.request.model.id, graceMs: 5_000 },
      expect.objectContaining({ phase: "subagent_turn", envelope: first.envelope }),
    );
    const late = fauxAssistantMessage("quarantined");
    hanging.push({ type: "done", reason: "stop", message: late });
    await hanging.result();
    await Promise.resolve();
    await Promise.resolve();
    expect(f.settle).toHaveBeenCalledTimes(2);
    expect((await first.source.result()).stopReason).toBe("aborted");
  });
});
