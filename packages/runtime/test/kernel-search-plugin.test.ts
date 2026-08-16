import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createLocalAgentRuntime } from "../src/local-agent-runtime.js";
import { SEARCH_KERNEL_PLUGIN_ID } from "../src/kernel-search-plugin.js";
import type { WebSearchExecutor } from "../src/web-search-model.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Search Kernel plugin", () => {
  it("removes web_search from new Runs while disabled and restores it on enable", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-search-plugin-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const executor: WebSearchExecutor = {
      search: vi.fn(async () => ({
        provider: "bing" as const,
        results: [
          {
            title: "Current official result",
            url: "https://official.example/current",
            source: "Bing",
          },
        ],
        attempts: [{ provider: "bing" as const, status: "succeeded" as const }],
        retrievedAt: "2026-08-16T00:00:00.000Z",
      })),
    };
    const services = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot: path.join(root, "state"),
      env: {},
      webSearch: executor,
    });
    try {
      expect(
        services.kernel.plugins
          .inspect()
          .find((plugin) => plugin.id === SEARCH_KERNEL_PLUGIN_ID),
      ).toEqual(
        expect.objectContaining({
          status: "enabled",
          capabilities: ["tool"],
          permissions: ["network.public"],
          contributions: expect.objectContaining({ tools: ["web_search"] }),
        }),
      );
      const agent = services.store.listAgents()[0]!;

      await services.kernel.plugins.disable(SEARCH_KERNEL_PLUGIN_ID);
      const disabledProvider = fauxProvider({ provider: "faux-search-off" });
      disabledProvider.setResponses([
        (context) => {
          expect(context.tools?.map((tool) => tool.name)).not.toContain(
            "web_search",
          );
          return fauxAssistantMessage("SEARCH_PLUGIN_DISABLED");
        },
        fauxAssistantMessage('{"facts":[]}'),
      ]);
      services.models.registerProvider(disabledProvider.provider);
      const disabledThread = await services.store.createThread({
        title: "Search disabled",
        agentId: agent.id,
      });
      const disabledRun = await services.kernel.runPrompt({
        threadId: disabledThread.id,
        text: "Report the Search plugin state.",
        model: { provider: "faux-search-off", id: "faux-1" },
      });
      expect(disabledRun.status).toBe("completed");
      expect(executor.search).not.toHaveBeenCalled();
      expect(
        services.kernel.plugins
          .inspect()
          .find((plugin) => plugin.id === SEARCH_KERNEL_PLUGIN_ID)?.status,
      ).toBe("disabled");

      await services.kernel.plugins.enable(SEARCH_KERNEL_PLUGIN_ID);
      const enabledProvider = fauxProvider({ provider: "faux-search-on" });
      enabledProvider.setResponses([
        (context) => {
          expect(context.tools?.map((tool) => tool.name)).toContain(
            "web_search",
          );
          return fauxAssistantMessage(
            fauxToolCall("web_search", { query: "current official result" }),
            { stopReason: "toolUse" },
          );
        },
        fauxAssistantMessage("SEARCH_PLUGIN_ENABLED"),
        fauxAssistantMessage('{"facts":[]}'),
      ]);
      services.models.registerProvider(enabledProvider.provider);
      const enabledThread = await services.store.createThread({
        title: "Search enabled",
        agentId: agent.id,
      });
      const enabledRun = await services.kernel.runPrompt({
        threadId: enabledThread.id,
        text: "Search for the current official result.",
        model: { provider: "faux-search-on", id: "faux-1" },
      });
      expect(enabledRun.status).toBe("completed");
      expect(executor.search).toHaveBeenCalledOnce();
      expect(
        services.kernel.plugins
          .inspect()
          .find((plugin) => plugin.id === SEARCH_KERNEL_PLUGIN_ID)?.status,
      ).toBe("enabled");
    } finally {
      await services.shutdown();
    }
  });
});
