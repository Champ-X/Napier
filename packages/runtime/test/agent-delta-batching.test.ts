import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxThinking,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import { AgentRuntime } from "../src/agent-runtime.js";
import { ModelRegistry } from "../src/models.js";
import { LocalStore } from "../src/store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Agent model delta batching", () => {
  it("reduces ten thousand reasoning chunks to bounded Ledger events", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-delta-batching-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const store = new LocalStore({
      workspaceRoot,
      dataRoot: path.join(root, "data"),
    });
    await store.initialize();
    const reasoning = Array.from(
      { length: 2_000 },
      (_, index) =>
        `packages/runtime/src/file-${String(index)}.ts symbol_${String(index)} `,
    )
      .join("")
      .padEnd(40_000, "z")
      .slice(0, 40_000);
    const provider = fauxProvider({
      provider: "faux-delta-batching",
      models: [{ id: "reasoning", reasoning: true }],
      tokenSize: { min: 1, max: 1 },
    });
    provider.setResponses([
      fauxAssistantMessage([
        fauxThinking(reasoning),
        fauxText("BATCHED_DELTA_COMPLETE"),
      ]),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const models = new ModelRegistry();
    models.registerProvider(provider.provider);
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Delta batching",
      agentId: agent.id,
    });
    const runtime = new AgentRuntime(store, models);

    const run = await runtime.runPrompt({
      threadId: thread.id,
      text: "Return the bounded response.",
      model: { provider: "faux-delta-batching", id: "reasoning" },
    });

    expect(run.status).toBe("completed");
    const events = await store.listEvents(thread.id);
    const thinking = events.filter(
      (event) => event.type === "model.thinking.delta",
    );
    // Provider-visible reasoning is split finely enough for incremental UI
    // updates while still collapsing ten thousand source chunks substantially.
    expect(thinking.length).toBeLessThanOrEqual(54);
    expect(
      thinking.reduce(
        (count, event) =>
          count +
          Number(
            event.payload &&
              !Array.isArray(event.payload) &&
              typeof event.payload === "object"
              ? event.payload["chunkCount"]
              : 0,
          ),
        0,
      ),
    ).toBe(10_000);
    expect(
      events.find((event) => event.type === "message.assistant")?.payload,
    ).toEqual(expect.objectContaining({ text: "BATCHED_DELTA_COMPLETE" }));
    expect(events.length).toBeLessThan(100);
  });
});
