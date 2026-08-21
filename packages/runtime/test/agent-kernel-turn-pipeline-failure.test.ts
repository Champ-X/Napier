import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import { createAgentKernel } from "../src/agent-kernel.js";
import { AgentRuntime } from "../src/agent-runtime.js";
import { ModelRegistry } from "../src/models.js";
import { UnsupportedSandboxAdapter } from "../src/sandbox.js";
import { LocalStore } from "../src/store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Agent Kernel Turn Pipeline failures", () => {
  it("fails before provider access when a Tool adapter injects a tool", async () => {
    const fixture = await createFixture();
    const kernel = await createAgentKernel({
      profile: "base",
      runtime: fixture.runtime,
      models: fixture.models,
      turnAdapters: {
        tool: {
          id: "test.tool.injected",
          select: () => ({
            immediate: [
              {
                name: "injected",
                label: "Injected",
                description: "Must never reach the model.",
                parameters: {} as never,
                async execute() {
                  return { content: [], details: {} };
                },
              },
            ],
            deferred: [],
          }),
        },
      },
    });
    try {
      const run = await kernel.runPrompt(fixture.runOptions);
      expect(run.status).toBe("failed");
      expect(run.error).toContain("non-candidate immediate tool");
      expect(fixture.provider.state.callCount).toBe(0);
    } finally {
      await kernel.shutdown();
      fixture.store.close();
    }
  });

  it("fails before provider access when a Prompt adapter returns invalid output", async () => {
    const fixture = await createFixture();
    const kernel = await createAgentKernel({
      profile: "base",
      runtime: fixture.runtime,
      models: fixture.models,
      turnAdapters: {
        prompt: {
          id: "test.prompt.invalid",
          create: (() => () => ({ systemPrompt: "forged" })) as never,
        },
      },
    });
    try {
      const run = await kernel.runPrompt(fixture.runOptions);
      expect(run.status).toBe("failed");
      expect(run.error).toBeTruthy();
      expect(fixture.provider.state.callCount).toBe(0);
    } finally {
      await kernel.shutdown();
      fixture.store.close();
    }
  });

  it("rejects a second Kernel attachment without leaking its Turn Pipeline", async () => {
    const fixture = await createFixture();
    const first = await createAgentKernel({
      profile: "base",
      runtime: fixture.runtime,
      models: fixture.models,
    });
    try {
      await expect(
        createAgentKernel({
          profile: "base",
          runtime: fixture.runtime,
          models: fixture.models,
        }),
      ).rejects.toThrow("already has a Kernel Turn Pipeline");
      const run = await first.runPrompt(fixture.runOptions);
      expect(run.status, run.error).toBe("completed");
      expect(fixture.provider.state.callCount).toBe(2);
    } finally {
      await first.shutdown();
      fixture.store.close();
    }
  });
});

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-turn-failure-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  const store = new LocalStore({
    workspaceRoot,
    dataRoot: path.join(root, "state"),
  });
  await store.initialize();
  const agent = await store.updateAgent(store.listAgents()[0]!.id, {
    toolPolicy: "observe",
    enabledTools: ["read_file"],
  });
  const thread = await store.createThread({
    title: "Turn Pipeline failure",
    agentId: agent.id,
  });
  const provider = fauxProvider({ provider: "faux-turn-failure" });
  provider.setResponses([
    fauxAssistantMessage("Turn Pipeline defaults intact."),
    fauxAssistantMessage('{"facts":[]}'),
  ]);
  const models = new ModelRegistry();
  models.registerProvider(provider.provider);
  return {
    store,
    models,
    provider,
    runtime: new AgentRuntime(
      store,
      models,
      undefined,
      new UnsupportedSandboxAdapter("turn-failure-test"),
    ),
    runOptions: {
      threadId: thread.id,
      text: "Exercise the Turn Pipeline.",
      model: { provider: provider.provider.id, id: "faux-1" },
    },
  };
}
