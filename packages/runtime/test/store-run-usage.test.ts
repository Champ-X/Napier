import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { LocalStore } from "../src/store.js";
import { aggregateRunUsage } from "../src/run-replay.js";

it("reconciles discarded usage through the SQLite query after reopening without mirrors or foreign Runs", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "napier-run-usage-"));
  const options = {
    dataRoot: path.join(root, "data"),
    workspaceRoot: path.join(root, "workspace"),
  };
  let store = new LocalStore(options);
  try {
    await store.initialize();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Usage",
      agentId: agent.id,
    });
    const run = await store.createRun({
      threadId: thread.id,
      agentId: agent.id,
    });
    const foreignThread = await store.createThread({
      title: "Foreign",
      agentId: agent.id,
    });
    const foreign = await store.createRun({
      threadId: foreignThread.id,
      agentId: agent.id,
    });
    for (const [type, count] of [
      ["model.response", 100],
      ["message.assistant", 100],
      ["model.thinking_loop.detected", 30],
      ["model.context.overflow", 40],
      ["memory.extraction.completed", 20],
    ] as const) {
      for (const owner of [run, foreign]) {
        await store.appendEvent({
          threadId: owner.threadId,
          runId: owner.id,
          type,
          category:
            type === "message.assistant"
              ? "message"
              : type === "memory.extraction.completed"
                ? "memory"
                : "model",
          payload: {
            ...(type === "message.assistant"
              ? { role: "assistant", text: "Mirrored answer" }
              : {}),
            usage: {
              inputTokens: count,
              outputTokens: count,
              cacheReadTokens: count,
              cacheWriteTokens: 0,
              costUsd: count / 1000,
            },
          },
        });
      }
    }
    const expected = {
      inputTokens: 190,
      outputTokens: 190,
      cacheReadTokens: 190,
      cacheWriteTokens: 0,
      costUsd: 0.19,
    };
    expect(await store.aggregateRunUsage(run.id)).toEqual(expected);
    store.close();
    store = new LocalStore(options);
    await store.initialize();
    expect(await store.aggregateRunUsage(run.id)).toEqual(expected);
    expect(aggregateRunUsage(await store.listRunEvents(run.id), [])).toEqual(
      expected,
    );
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
