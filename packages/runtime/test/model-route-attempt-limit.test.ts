import type { Api, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import type { ModelRouteSession } from "../src/model-route.js";
import { createSubagentStream } from "../src/subagent-model-stream.js";
import {
  cleanupModelRouteFixtures, collectModelRouteStream, createModelRouteFixture, terminalStream,
} from "./model-route-test-support.js";

afterEach(cleanupModelRouteFixtures);

describe("per-invocation route attempt limits", () => {
  it.each([0, -1, 0.5, NaN, Infinity])("rejects invalid physical attempt cap %s before invocation", async (physicalAttemptLimit) => {
    const fixture = await createModelRouteFixture();
    const session = await fixture.router.createSession({ run: fixture.run, primary: fixture.primary });
    let invoked = false;
    expect(() => session.stream({ physicalAttemptLimit, signal: new AbortController().signal,
      invoke: async (model) => { invoked = true; return terminalStream(model, "stop", "never"); } }))
      .toThrow("physical attempt limit");
    expect(invoked).toBe(false);
  });

  it.each(["retry", "fallback"])("caps repair dispatch at one physical call even when %s is available", async (continuation) => {
    const fixture = await createModelRouteFixture({ noRetryDelay: true });
    const session = await fixture.router.createSession({ run: fixture.run, primary: fixture.primary,
      ...(continuation === "fallback" ? { request: { role: "reasoning" as const, fallbackModels: [{ provider: "route-fixture", id: "fallback" }] } } : {}) });
    const invoked: string[] = [];
    const input = {
      signal: new AbortController().signal,
      physicalAttemptLimit: 1,
      invoke: async (model: Model<Api>) => {
        invoked.push(model.id);
        return terminalStream(model, invoked.length === 1 ? "error" : "stop", invoked.length === 1 ? "HTTP 503 service unavailable" : "must not be consumed");
      },
    };
    const stream = session.stream(input);
    await collectModelRouteStream(stream);
    expect(invoked).toEqual(["primary"]);
    expect((await stream.result()).stopReason).toBe("error");
    const ended = (await fixture.store.listEvents(fixture.thread.id)).filter((event) => event.type === "route_attempt_ended");
    expect(ended).toHaveLength(1);
    expect(ended[0]?.payload).toMatchObject({ outcome: "terminal" });
  });

  it("forwards route credentials, headers, environment and response hooks while retaining caller options", async () => {
    const fixture = await createModelRouteFixture();
    const calls: string[] = [];
    let observed: SimpleStreamOptions | undefined;
    const models = { streamSimple: (_model: Model<Api>, _context: unknown, options?: SimpleStreamOptions) => {
      observed = options;
      return terminalStream(fixture.primary, "stop", "ok");
    } } as Parameters<typeof createSubagentStream>[0];
    const route = { stream: (input: Parameters<ModelRouteSession["stream"]>[0]) => input.invoke(fixture.primary, {
      descriptor: {} as never,
      streamOptions: { apiKey: "route-fixture-key", headers: { "x-route": "r" }, env: { ROUTE_FIXTURE: "r" },
        onResponse: () => { calls.push("route"); } },
    }) } as unknown as ModelRouteSession;
    const stream = await createSubagentStream(models, route)(fixture.primary, { messages: [] }, {
      sessionId: "repair-session", maxRetries: 0, headers: { "x-base": "b" }, env: { BASE_FIXTURE: "b" },
      onResponse: () => { calls.push("base"); },
    });
    await collectModelRouteStream(stream);
    expect(observed).toMatchObject({ apiKey: "route-fixture-key", sessionId: "repair-session", maxRetries: 0,
      headers: { "x-base": "b", "x-route": "r" }, env: { BASE_FIXTURE: "b", ROUTE_FIXTURE: "r" } });
    await observed?.onResponse?.({ status: 200, headers: {} }, fixture.primary);
    expect(calls).toEqual(["base", "route"]);
  });
});
