import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
} from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  awaitedEventBarrier,
  cleanupModelSessionFixtures,
  createModelSessionFixture,
} from "./subagent-model-session-fixture.js";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External requests forbidden"); }));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await cleanupModelSessionFixtures();
});

describe("Child ModelSession physical and settlement lifetime", () => {
  it("retains one physical admission until an abort-ignoring provider settles, with no late completion", async () => {
    const settle = vi.fn();
    const reserve = vi.fn(() => ({ settle }));
    const fixture = await createModelSessionFixture({ admission: { reserve } });
    let notifyStarted!: () => void;
    const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
    const source = createAssistantMessageEventStream();
    const dispatch = vi.fn(() => { notifyStarted(); return source; });
    fixture.registry.registerProvider({ ...fixture.faux.provider, stream: dispatch, streamSimple: dispatch });
    const handle = await fixture.supervisor.start(fixture.request());
    await Promise.race([started, fixture.supervisor.collect(handle).then((result) => {
      throw new Error(`Task settled before provider dispatch: ${result.task.error}`);
    })]);
    fixture.parent.abort();
    const result = await fixture.supervisor.collect(handle);
    expect(result.status).toBe("cancelled");
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(settle).not.toHaveBeenCalled();
    const late = fauxAssistantMessage('{"summary":"late","items":[],"unknowns":[]}');
    source.push({ type: "done", reason: "stop", message: late });
    await vi.waitFor(() => expect(settle).toHaveBeenCalledExactlyOnceWith(late));
    const after = await fixture.supervisor.collect(handle);
    expect(after.task.status).toBe("cancelled");
    expect(after.task.outcome).toBeUndefined();
    const events = await fixture.store.listEvents(fixture.thread.id);
    expect(events.filter((event) => event.type === "subagent.completed")).toHaveLength(0);
    expect(events.filter((event) => event.type === "subagent.model.response")).toHaveLength(1);
  });

  it("cancellation during durable invocation capture dispatches no physical provider call", async () => {
    const barrier = awaitedEventBarrier((event) => event.type === "subagent.model.invocation");
    const reserve = vi.fn(() => ({ settle: vi.fn() }));
    const fixture = await createModelSessionFixture({ admission: { reserve }, onEvent: barrier.onEvent });
    fixture.faux.setResponses([fauxAssistantMessage('{"summary":"unused","items":[],"unknowns":[]}')]);
    const handle = await fixture.supervisor.start(fixture.request());
    await Promise.race([barrier.reached, fixture.supervisor.collect(handle).then((result) => {
      throw new Error(`Task settled before capture: ${result.task.error}`);
    })]);
    fixture.parent.abort();
    barrier.release();
    expect((await fixture.supervisor.collect(handle)).status).toBe("cancelled");
    expect(reserve).not.toHaveBeenCalled();
    expect(fixture.faux.state.callCount).toBe(0);
  });

  for (const typed of [false, true]) {
    it(`${typed ? "typed" : "ordinary"} repair cannot reset the absolute task deadline`, async () => {
      const barrier = awaitedEventBarrier((event) => event.type === (
        typed ? "subagent.output.repair.requested" : "subagent.outcome.repair.requested"
      ));
      const fixture = await createModelSessionFixture({ timeoutMs: 1_000, onEvent: barrier.onEvent });
      fixture.faux.setResponses([fauxAssistantMessage("invalid json"), fauxAssistantMessage('"unused"')]);
      const handle = await fixture.supervisor.start(fixture.request(typed ? { outputSchema: { type: "string" } } : {}));
      await Promise.race([barrier.reached, fixture.supervisor.collect(handle).then((result) => {
        throw new Error(`Task settled before repair: ${result.task.error}`);
      })]);
      await new Promise((resolve) => setTimeout(resolve, 1_050));
      barrier.release();
      const result = await fixture.supervisor.collect(handle);
      expect(result.task.status).toBe("timed_out");
      expect(result.task.output).toBeUndefined();
      expect(result.task.outcome).toBeUndefined();
      expect(fixture.faux.state.callCount).toBe(1);
    });
  }

  it("checks cancellation inside the queued SQLite terminal mutation", async () => {
    const fixture = await createModelSessionFixture();
    const task = await fixture.store.createSubagentTask({
      threadId: fixture.thread.id, runId: fixture.run.id, role: "researcher",
      model: { provider: fixture.model.provider, id: fixture.model.id },
      description: "Queue boundary", prompt: "test",
    });
    await fixture.store.startSubagentTask(task.id);
    const finish = fixture.store.finishSubagentTask(task.id, {
      status: "completed", stopReason: "completed", output: "must not commit",
    }, () => fixture.parent.signal.throwIfAborted());
    fixture.parent.abort(new Error("Cancelled while completion queued"));
    await expect(finish).rejects.toThrow("Cancelled while completion queued");
    expect(fixture.store.listSubagentTasks(fixture.thread.id)[0]).toMatchObject({ status: "running" });
    await fixture.store.finishSubagentTask(task.id, { status: "cancelled", stopReason: "cancelled" });
    fixture.store.close();
    await fixture.store.initialize();
    const restored = fixture.store.listSubagentTasks(fixture.thread.id)[0]!;
    expect(restored.status).toBe("cancelled");
    expect(restored.output).toBeUndefined();
  });

  it("reserves each initial and repair invocation once", async () => {
    const settle = vi.fn();
    const reserve = vi.fn(() => ({ settle }));
    const fixture = await createModelSessionFixture({ admission: { reserve } });
    fixture.faux.setResponses([
      fauxAssistantMessage("invalid json"),
      fauxAssistantMessage('{"summary":"done","items":[],"unknowns":[]}'),
    ]);
    const handle = await fixture.supervisor.start(fixture.request());
    const result = await fixture.supervisor.collect(handle);
    expect(result.status, result.task.error).toBe("completed");
    expect(fixture.faux.state.callCount).toBe(2);
    expect(reserve).toHaveBeenCalledTimes(2);
    expect(settle).toHaveBeenCalledTimes(2);
  });

  for (const phase of ["subagent_turn", "typed_repair"] as const) {
    it(`accounts the ${phase} response once when cancellation arrives during its durable receipt`, async () => {
      const barrier = awaitedEventBarrier((event) => event.type === "subagent.model.response" &&
        (event.payload as Record<string, unknown>)["phase"] === phase);
      const fixture = await createModelSessionFixture({ onEvent: barrier.onEvent });
      fixture.faux.setResponses([
        ...(phase === "typed_repair" ? [fauxAssistantMessage("invalid json")] : []),
        fauxAssistantMessage('"valid output"'),
      ]);
      const handle = await fixture.supervisor.start(fixture.request({ outputSchema: { type: "string" } }));
      await Promise.race([barrier.reached, fixture.supervisor.collect(handle).then((result) => {
        throw new Error(`Task settled before response: ${result.task.error}`);
      })]);
      fixture.parent.abort();
      barrier.release();
      const result = await fixture.supervisor.collect(handle);
      expect(result.status).toBe("cancelled");
      expect(result.task.output).toBeUndefined();
      const responses = (await fixture.store.listEvents(fixture.thread.id))
        .filter((event) => event.type === "subagent.model.response");
      expect(responses).toHaveLength(phase === "typed_repair" ? 2 : 1);
      const sum = responses.reduce((total, event) => {
        const usage = (event.payload as unknown as { usage: { input: number; output: number } }).usage;
        return { input: total.input + usage.input, output: total.output + usage.output };
      }, { input: 0, output: 0 });
      expect(result.task.usage.inputTokens).toBe(sum.input);
      expect(result.task.usage.outputTokens).toBe(sum.output);
    });
  }

  it("retains committed completion when publishing its delivery event fails", async () => {
    const fixture = await createModelSessionFixture();
    fixture.faux.setResponses([fauxAssistantMessage('"committed"')]);
    const append = fixture.store.appendEvent.bind(fixture.store);
    vi.spyOn(fixture.store, "appendEvent").mockImplementation((input) =>
      input.type === "subagent.output.accepted"
        ? Promise.reject(new Error("Delivery event store failure after commit"))
        : append(input),
    );
    const handle = await fixture.supervisor.start(fixture.request({ outputSchema: { type: "string" } }));
    const result = await fixture.supervisor.collect(handle);
    expect(result.status).toBe("completed");
    expect(result.task.output).toBe("committed");
    const events = await fixture.store.listEvents(fixture.thread.id);
    expect(events.some((event) => ["subagent.failed", "subagent.cancelled"].includes(event.type))).toBe(false);
    fixture.store.close();
    await fixture.store.initialize();
    expect(fixture.store.listSubagentTasks(fixture.thread.id)[0]).toMatchObject({ status: "completed", output: "committed" });
  });
});
