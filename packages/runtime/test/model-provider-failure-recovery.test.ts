import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import { ModelRegistry } from "../src/models.js";
import { LocalStore } from "../src/store.js";
import { processReadyAgentRuntime } from "./process-run-readiness-test-fixture.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Model provider failure recovery", () => {
  it("recovers a terminated provider stream inline before interrupting the Run", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-provider-recovery-"),
    );
    temporaryRoots.push(root);
    const store = new LocalStore({
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    });
    await store.initialize();
    const thread = await store.createThread({
      title: "Provider stream recovery",
      agentId: store.listAgents()[0]!.id,
    });
    const provider = fauxProvider({ provider: "faux-runtime-stream" });
    provider.setResponses([
      fauxAssistantMessage("", {
        stopReason: "error",
        errorMessage: "terminated",
      }),
      fauxAssistantMessage("Recovered after the provider stream reconnected."),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const registry = new ModelRegistry();
    registry.registerProvider(provider.provider);

    const run = await processReadyAgentRuntime(store, registry).runPrompt({
      threadId: thread.id,
      text: "Exercise a provider stream failure.",
      model: { provider: "faux-runtime-stream", id: "faux-1" },
    });

    expect(run.status, run.error).toBe("completed");
    expect(provider.state.callCount).toBe(3);
    expect(store.getThread(thread.id).status).toBe("idle");
    const events = await store.listRunEvents(run.id);
    expect(
      events.filter((event) => event.type === "route_attempt_ended"),
    ).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          outcome: "retryable",
          failureClass: "network",
          visibleOutputProduced: false,
        }),
      }),
      expect.objectContaining({
        payload: expect.objectContaining({ outcome: "success" }),
      }),
    ]);
    expect(
      events.find((event) => event.type === "message.assistant")?.payload,
    ).toEqual(
      expect.objectContaining({
        text: "Recovered after the provider stream reconnected.",
      }),
    );
    expect(events.some((event) => event.type === "run.failed")).toBe(false);
    expect(JSON.stringify(events)).not.toContain("terminated");
    store.close();
  });

  it("settles repeated terminated streams as a resumable Run", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-provider-recovery-exhausted-"),
    );
    temporaryRoots.push(root);
    const store = new LocalStore({
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    });
    await store.initialize();
    const thread = await store.createThread({
      title: "Provider stream recovery exhausted",
      agentId: store.listAgents()[0]!.id,
    });
    const provider = fauxProvider({
      provider: "faux-runtime-stream-exhausted",
    });
    provider.setResponses([
      fauxAssistantMessage("", {
        stopReason: "error",
        errorMessage: "terminated",
      }),
      fauxAssistantMessage("", {
        stopReason: "error",
        errorMessage: "terminated",
      }),
    ]);
    const registry = new ModelRegistry();
    registry.registerProvider(provider.provider);

    const run = await processReadyAgentRuntime(store, registry).runPrompt({
      threadId: thread.id,
      text: "Exercise an exhausted provider stream retry.",
      model: { provider: "faux-runtime-stream-exhausted", id: "faux-1" },
    });

    expect(provider.state.callCount).toBe(2);
    expect(run).toEqual(
      expect.objectContaining({
        status: "failed",
        outcome: "paused_budget",
        error:
          "The model response stream ended unexpectedly. Safely resume the Run; select another configured model if the connection keeps failing.",
      }),
    );
    const events = await store.listRunEvents(run.id);
    expect(
      events.find((event) => event.type === "run.settlement.recorded")?.payload,
    ).toEqual(expect.objectContaining({ outcome: "paused_budget" }));
    expect(JSON.stringify(events)).not.toContain("terminated");
    store.close();
  });

  it("settles repeated provider aborts as resumable without treating them as user cancellation", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-provider-abort-recovery-exhausted-"),
    );
    temporaryRoots.push(root);
    const store = new LocalStore({
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    });
    await store.initialize();
    const thread = await store.createThread({
      title: "Provider abort recovery exhausted",
      agentId: store.listAgents()[0]!.id,
    });
    const provider = fauxProvider({ provider: "faux-runtime-aborted" });
    provider.setResponses([
      fauxAssistantMessage("", {
        stopReason: "aborted",
        errorMessage: "provider stream aborted",
      }),
      fauxAssistantMessage("", {
        stopReason: "aborted",
        errorMessage: "provider stream aborted",
      }),
    ]);
    const registry = new ModelRegistry();
    registry.registerProvider(provider.provider);

    const run = await processReadyAgentRuntime(store, registry).runPrompt({
      threadId: thread.id,
      text: "Exercise an exhausted provider abort retry.",
      model: { provider: "faux-runtime-aborted", id: "faux-1" },
    });

    expect(provider.state.callCount).toBe(2);
    expect(run).toEqual(
      expect.objectContaining({
        status: "failed",
        outcome: "paused_budget",
        error:
          "The model provider or network failed temporarily. Retry the same Run; select another configured model if the failure persists.",
      }),
    );
    expect(store.getThread(thread.id).status).toBe("idle");
    store.close();
  });
});
