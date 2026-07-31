import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AgentRuntime } from "../src/agent-runtime.js";
import { CredentialReferenceStore } from "../src/credentials.js";
import { ModelRegistry } from "../src/models.js";
import { LocalStore } from "../src/store.js";

const LIVE_DEEPSEEK_ENABLED = process.env.NAPIER_LIVE_DEEPSEEK_SMOKE === "1";
const describeLive = LIVE_DEEPSEEK_ENABLED ? describe : describe.skip;
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describeLive("live DeepSeek smoke", () => {
  it("runs a low-cost live model through the ledger without persisting secrets", async () => {
    const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
    if (!apiKey) {
      throw new Error(
        "Set DEEPSEEK_API_KEY before running the live DeepSeek smoke test",
      );
    }
    const modelId = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-v4-flash";
    const root = await mkdtemp(path.join(tmpdir(), "napier-live-deepseek-"));
    temporaryRoots.push(root);
    const store = new LocalStore({
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    });
    await store.initialize();
    await store.createCredentialReference({
      providerId: "deepseek",
      label: "DeepSeek live smoke env",
      source: { type: "environment", variable: "DEEPSEEK_API_KEY" },
    });
    const credentials = new CredentialReferenceStore({
      store,
      env: { DEEPSEEK_API_KEY: apiKey },
    });
    const registry = new ModelRegistry(credentials);

    await expect(
      registry.isConfigured({ provider: "deepseek", id: modelId }),
    ).resolves.toBe(true);

    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Live DeepSeek smoke",
      agentId: agent.id,
    });
    const runtime = new AgentRuntime(store, registry);
    const run = await runtime.runPrompt({
      threadId: thread.id,
      text: "Reply with exactly the token NAPIER_LIVE_SMOKE_OK.",
      model: { provider: "deepseek", id: modelId },
    });

    expect(run.status, run.error).toBe("completed");
    const events = await store.listEvents(thread.id);
    expect(
      events.some((event) => event.type === "context.model_envelope"),
    ).toBe(true);
    expect(events.some((event) => event.type === "model.response")).toBe(true);
    expect(events.some((event) => event.type === "message.assistant")).toBe(
      true,
    );
    expect(events.some((event) => event.type === "run.completed")).toBe(true);
    expect(JSON.stringify(events)).not.toContain(apiKey);
  }, 60_000);
});
