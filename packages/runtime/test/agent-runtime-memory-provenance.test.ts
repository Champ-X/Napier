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

describe("AgentRuntime memory provenance", () => {
  it("persists extractor rationale and selected Run message IDs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-memory-source-"));
    temporaryRoots.push(root);
    const store = new LocalStore({
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    });
    await store.initialize();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Memory provenance extraction",
      agentId: agent.id,
    });
    const provider = fauxProvider({ provider: "faux-memory-provenance" });
    provider.setResponses([
      fauxAssistantMessage("Future migrations must remain reversible."),
      (context) => {
        const request = JSON.stringify(context.messages);
        const sourceMessageId = request.match(/\[(event_[a-z0-9]+)\]/u)?.[1];
        return fauxAssistantMessage(
          JSON.stringify({
            facts: [
              {
                content: "Migrations must remain reversible.",
                category: "constraint",
                confidence: 0.98,
                persistenceReason: "The constraint applies to future changes.",
                differenceSummary: "Adds a verified migration constraint.",
                sourceMessageIds: sourceMessageId ? [sourceMessageId] : [],
              },
            ],
          }),
        );
      },
    ]);
    const registry = new ModelRegistry();
    registry.registerProvider(provider.provider);

    await processReadyAgentRuntime(store, registry).runPrompt({
      threadId: thread.id,
      text: "Verified policy: all migrations must remain reversible.",
      model: { provider: "faux-memory-provenance", id: "faux-1" },
    });

    expect(store.listMemories({ agentId: agent.id })[0]?.source).toEqual(
      expect.objectContaining({
        type: "conversation",
        threadId: thread.id,
        taskTitle: thread.title,
        persistenceReason: "The constraint applies to future changes.",
        differenceSummary: "Adds a verified migration constraint.",
        repositoryEvidence: { status: "unavailable" },
        messageIds: [expect.stringMatching(/^event_/u)],
      }),
    );
    store.close();
  });
});
