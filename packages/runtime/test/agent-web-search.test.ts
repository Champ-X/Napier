import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createLocalAgentRuntime } from "../src/index.js";
import type { WebSearchExecutor } from "../src/web-search.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("default Agent web search integration", () => {
  it("executes live-search semantics from the full default and keeps query/results out of the Ledger", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-agent-search-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const query = "LATEST_PRIVATE_QUERY_MARKER";
    const resultUrl = "https://official.example/current?private=RESULT_MARKER";
    const executor: WebSearchExecutor = {
      search: vi.fn(async () => ({
        provider: "bing" as const,
        results: [
          {
            title: "Official current result",
            url: resultUrl,
            snippet: "UNTRUSTED_RESULT_SNIPPET_MARKER",
            publishedAt: "2026-08-04",
            source: "Bing",
          },
        ],
        attempts: [
          {
            provider: "brave" as const,
            status: "unavailable" as const,
            diagnostic: "brave credentials are not configured",
          },
          { provider: "bing" as const, status: "succeeded" as const },
        ],
        retrievedAt: "2026-08-04T12:00:00.000Z",
      })),
    };
    const services = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot: path.join(root, "state"),
      env: {},
      webSearch: executor,
    });
    try {
      const agent = services.store.listAgents()[0]!;
      expect(agent.toolPolicy).toBe("workspace");
      expect(agent.enabledTools).toContain("web_search");
      const thread = await services.store.createThread({
        title: "Default Agent live search",
        agentId: agent.id,
      });
      const provider = fauxProvider({ provider: "faux-web-search" });
      provider.setResponses([
        fauxAssistantMessage(
          fauxToolCall("web_search", {
            query,
            timeRange: "day",
            count: 5,
          }),
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage("SEARCH_PATH_COMPLETED"),
        fauxAssistantMessage('{"facts":[]}'),
      ]);
      services.models.registerProvider(provider.provider);

      const run = await services.runtime.runPrompt({
        threadId: thread.id,
        text: "Find the current official result.",
        model: { provider: "faux-web-search", id: "faux-1" },
      });

      expect(run.status, run.error).toBe("completed");
      expect(executor.search).toHaveBeenCalledWith(
        expect.objectContaining({
          query,
          category: "general",
          count: 5,
          provider: "auto",
          timeRange: "day",
        }),
        expect.any(AbortSignal),
        expect.objectContaining({ operation: expect.any(Function) }),
      );
      const events = await services.store.listEvents(thread.id);
      expect(
        events.find(
          (event) =>
            event.type === "tool.started" &&
            record(event.payload)?.["toolName"] === "web_search",
        )?.payload,
      ).toEqual(
        expect.objectContaining({
          effect: "read",
          inputRedacted: true,
        }),
      );
      expect(
        events.find(
          (event) =>
            event.type === "tool.completed" &&
            record(event.payload)?.["toolName"] === "web_search",
        )?.payload,
      ).toEqual(
        expect.objectContaining({
          outputRedacted: true,
          details: expect.objectContaining({
            kind: "napier.web-search",
            provider: "bing",
            resultCount: 1,
            attemptedProviderCount: 2,
            unavailableProviderCount: 1,
          }),
        }),
      );
      const durable = JSON.stringify(events);
      expect(durable).not.toContain(query);
      expect(durable).not.toContain(resultUrl);
      expect(durable).not.toContain("UNTRUSTED_RESULT_SNIPPET_MARKER");
      expect(durable).toContain("SEARCH_PATH_COMPLETED");
    } finally {
      await services.shutdown();
    }
  });
});

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
