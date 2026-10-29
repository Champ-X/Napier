import { createAssistantMessageEventStream, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupModelSessionFixtures, createModelSessionFixture } from "./subagent-model-session-fixture.js";

afterEach(async () => { vi.restoreAllMocks(); await cleanupModelSessionFixtures(); });

describe("child canonical usage budget", () => {
  it.each(["tokens", "cost"] as const)("stops the next physical model turn at the inherited %s ceiling", async (kind) => {
    const fixture = await createModelSessionFixture({ runLimits: {
      maxTotalTokens: kind === "tokens" ? 1_000 : 0, maxCostUsd: kind === "cost" ? 0.01 : 25,
    } });
    const message = fauxAssistantMessage(fauxToolCall("unavailable_tool", {}), { stopReason: "toolUse" });
    message.usage = { input: 1_000, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 1_010,
      cost: { input: 0.02, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.02 } };
    const physical = vi.spyOn(fixture.registry.models, "streamSimple").mockImplementation(() => {
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "done", reason: "toolUse", message });
      return stream;
    });
    const handle = await fixture.supervisor.start(fixture.request());
    const result = await fixture.supervisor.collect(handle);
    expect(result.status).toBe("failed");
    expect(result.task.error).toContain(kind);
    expect(physical).toHaveBeenCalledTimes(1);
    expect(result.task.turnCount).toBe(1);
    expect(result.task.usage.inputTokens).toBe(1_000);
    expect(result.task.usage.costUsd).toBe(0.02);
    const events = await fixture.store.listRunEvents(result.task.childRunId!);
    expect(events.filter((event) => event.type === "subagent.child.invocation_reserved")).toHaveLength(1);
    expect(events.filter((event) => event.type === "model.response")).toHaveLength(1);
  });

  it.each([false, true])("refuses repair without consuming another turn when the known token budget is exhausted (typed=%s)", async (typed) => {
    const fixture = await createModelSessionFixture({ runLimits: { maxTotalTokens: 1_000 } });
    const message = fauxAssistantMessage("malformed result");
    message.usage = { input: 1_000, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 1_010,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
    const physical = vi.spyOn(fixture.registry.models, "streamSimple").mockImplementation(() => {
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "done", reason: "stop", message });
      return stream;
    });
    const handle = await fixture.supervisor.start(fixture.request(typed ? { outputSchema: { type: "string" } } : {}));
    const result = await fixture.supervisor.collect(handle);
    expect(result.status).toBe("failed");
    expect(result.task.error).toContain("tokens");
    expect(physical).toHaveBeenCalledTimes(1);
    expect(result.task.turnCount).toBe(1);
    expect(result.task.usage.inputTokens).toBe(1_000);
  });
});
