import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { InProcessSubagentProvider } from "../src/in-process-subagent-provider.js";
import { ToolConcurrencyGate } from "../src/tool-concurrency-gate.js";
import { cleanupContinuationRunnerFixtures, continuationRunnerFixture } from "./subagent-continuation-runner-fixture.js";

afterEach(cleanupContinuationRunnerFixtures);

describe("logical child mailbox projection", () => {
  it.each([false, true])("reports inherited pending consumption before resume and deduplicates prior delivery=%s", async (previouslyDelivered) => {
    const f = await continuationRunnerFixture();
    const pending = await f.accept("Pending inherited requirement");
    const consumed = await f.accept("Consumed inherited requirement", true);
    for (const message of previouslyDelivered ? [pending, consumed] : [consumed]) {
      await f.sourceStore.appendEvent({ threadId: f.thread.id, runId: f.parent.run.id,
        type: "subagent.message.delivered", category: "subagent",
        payload: { taskId: f.task.id, messageId: message.id, messageKind: message.messageKind, contentSha256: message.contentSha256 } });
    }
    await f.assistant(fauxAssistantMessage('{"answer":"inherited final before pending input"}'));
    const ready = await f.interruptAndPrepare();
    let signalStarted!: () => void, releaseStarted!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const released = new Promise<void>((resolve) => { releaseStarted = resolve; });
    const provider = new InProcessSubagentProvider({ store: ready.store, models: f.registry.models, defaultModel: f.model,
      profile: f.profile, run: ready.target.run, limits: f.profile.subagentLimits!, parentSignal: new AbortController().signal,
      concurrencyGate: new ToolConcurrencyGate(), onEvent: async (event) => {
        if (event.type === "subagent.started") { signalStarted(); await released; }
      } });
    f.faux.setResponses([fauxAssistantMessage('{"answer":"continued"}')]);
    const launched = await provider.resume({ ...ready.prepared, authorization: ready.authorization });
    try {
      await started;
      const before = await provider.inspect(launched.handle);
      expect(before.mailbox).toMatchObject({ acceptedCount: 2, deliveredCount: previouslyDelivered ? 2 : 1,
        consumedCount: 1, pendingCount: previouslyDelivered ? 0 : 1, pendingConsumptionCount: 1 });
      expect(JSON.stringify(before.mailbox)).not.toContain(pending.text);
      expect(JSON.stringify(before.mailbox)).not.toContain(consumed.text);
    } finally { releaseStarted(); }
    expect((await provider.collect(launched.handle)).status).toBe("completed");
    const after = await provider.inspect(launched.handle);
    expect(after.mailbox).toMatchObject({ acceptedCount: 2, deliveredCount: 2, consumedCount: 2,
      pendingCount: 0, pendingConsumptionCount: 0 });
    const accepted = (await ready.store.listRunEvents(f.parent.run.id)).filter((event) => event.type === "subagent.message.accepted");
    expect(after.mailbox.lastAcceptedAt).toBe(accepted.at(-1)!.createdAt);
    expect(after.mailbox.lastDeliveredAt).toBeDefined();
    const receipt = (await ready.store.listRunEvents(ready.target.run.id)).find((event) => event.type === "subagent.message.delivered");
    expect(receipt?.payload).toMatchObject({ taskId: launched.handle.taskId, messageId: pending.id, contentSha256: pending.contentSha256 });
  });
});
