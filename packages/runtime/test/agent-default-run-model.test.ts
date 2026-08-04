import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  type CredentialStore,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import { AgentRuntime } from "../src/agent-runtime.js";
import { LocalStore } from "../src/store.js";
import { ModelRegistry } from "../src/models.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Agent default Run model", () => {
  it("uses an explicitly configured live model without revising the seed Agent", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-live-ready-run-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const store = new LocalStore({
      dataRoot: path.join(root, "data"),
      workspaceRoot,
    });
    await store.initialize();
    const agent = store.listAgents()[0]!;
    await store.createCredentialReference({
      providerId: "live-ready",
      label: "Live ready",
      source: { type: "environment", variable: "LIVE_READY_API_KEY" },
    });
    const models = new ModelRegistry(credentials());
    const provider = fauxProvider({ provider: "live-ready" });
    provider.setResponses([
      fauxAssistantMessage("LIVE_READY_DEFAULT_OK"),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    models.registerProvider(provider.provider);
    const thread = await store.createThread({
      title: "Live-ready default",
      agentId: agent.id,
    });

    const run = await new AgentRuntime(store, models).runPrompt({
      threadId: thread.id,
      text: "Use the live-ready default.",
    });

    expect(run.status, run.error).toBe("completed");
    expect(run.configuration?.model).toEqual({
      provider: "live-ready",
      id: "faux-1",
    });
    expect(provider.state.callCount).toBe(2);
    expect(store.getAgent(agent.id)).toEqual(agent);
    expect(store.listAgentRevisions(agent.id)).toHaveLength(1);
    await store.close();
  });
});

function credentials(): CredentialStore {
  return {
    async read(providerId) {
      return providerId === "live-ready"
        ? { type: "api_key", key: "PRIVATE_LIVE_READY_KEY" }
        : undefined;
    },
    async list() {
      return [{ providerId: "live-ready", type: "api_key" }];
    },
    async modify() {
      return undefined;
    },
    async delete() {},
  };
}
