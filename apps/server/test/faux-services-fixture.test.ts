import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import { createFauxServices } from "./faux-services-fixture.js";

describe("HTTP faux provider pricing fixture", () => {
  it.each([
    { api: "faux:fixture", explicitPolicy: false, completed: true },
    { api: "openai-completions", explicitPolicy: false, completed: false },
    { api: "faux:fixture", explicitPolicy: true, completed: false },
  ])("declares only faux models free and preserves explicit policy: $api, $explicitPolicy", async ({ api, explicitPolicy, completed }) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "napier-faux-pricing-"));
    let services: Awaited<ReturnType<typeof createFauxServices>> | undefined;
    try {
      const workspaceRoot = path.join(root, "workspace");
      await mkdir(workspaceRoot);
      services = await createFauxServices({
        workspaceRoot, dataRoot: path.join(root, "data"), env: {},
        ...(explicitPolicy ? { modelCallAdmission: {
          isDeclaredZeroCost: () => false,
          reserve: () => ({ settle: () => undefined }),
        } } : {}),
      });
      const provider = fauxProvider({ api, provider: "fixture-provider" });
      provider.setResponses([
        fauxAssistantMessage("Fixture response."),
        fauxAssistantMessage('{"facts":[]}'),
      ]);
      services.models.registerProvider(provider.provider);
      const thread = await services.store.createThread({
        title: "Pricing policy", agentId: services.store.listAgents()[0]!.id,
      });
      const run = await services.runtime.runPrompt({
        threadId: thread.id, text: "Return a short answer.",
        model: { provider: "fixture-provider", id: "faux-1" },
      });
      expect(run.status).toBe(completed ? "completed" : "failed");
      if (completed) expect(provider.state.callCount).toBeGreaterThan(0);
      else expect(provider.state.callCount).toBe(0);
    } finally {
      await services?.shutdownLocalRuntime();
      await rm(root, { recursive: true, force: true });
    }
  });
});
