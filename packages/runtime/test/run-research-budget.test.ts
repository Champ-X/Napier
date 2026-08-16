import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import { AgentRuntime } from "../src/agent-runtime.js";
import { ModelRegistry } from "../src/models.js";
import { RunResearchBudget } from "../src/run-research-budget.js";
import { LocalStore } from "../src/store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Run research budget", () => {
  it("caps distinct research turns and elapsed time at 25 percent", async () => {
    const fixture = await createFixture("direct");
    const run = await fixture.store.createRun({
      threadId: fixture.threadId,
      agentId: fixture.agentId,
    });
    const budget = new RunResearchBudget({
      store: fixture.store,
      run,
      limits: {
        maxTurns: 8,
        maxTotalTokens: 1_000,
        maxCostUsd: 1,
        timeoutMs: 400,
      },
    });

    expect(await budget.preflight("web_search", 1, 1_000)).toBeUndefined();
    expect(await budget.preflight("web_fetch", 1, 1_050)).toBeUndefined();
    budget.completeTurn(1, new Date(1_060).toISOString());
    expect(await budget.preflight("web_search", 2, 1_070)).toBeUndefined();
    budget.completeTurn(2, new Date(1_110).toISOString());
    expect(budget.snapshot(1_110)).toEqual({
      researchTurnCount: 2,
      researchElapsedMs: 100,
      maxResearchTurns: 2,
      maxResearchElapsedMs: 100,
    });

    await expect(budget.preflight("web_search", 3, 1_120)).resolves.toEqual(
      expect.objectContaining({
        block: true,
        reason: expect.stringContaining("Research budget exhausted"),
      }),
    );
    await expect(budget.preflight("web_fetch", 4, 1_130)).resolves.toEqual(
      expect.objectContaining({ block: true }),
    );
    expect(
      (await fixture.store.listEvents(fixture.threadId)).filter(
        (event) => event.type === "run.research.budget_exhausted",
      ),
    ).toHaveLength(1);
    fixture.store.close();
  });

  it("blocks excess Agent research but still permits delivery", async () => {
    const fixture = await createFixture("agent");
    await fixture.store.updateAgent(fixture.agentId, {
      enabledTools: ["web_search"],
      runLimits: {
        maxTurns: 4,
        maxTotalTokens: 1_000_000,
        maxCostUsd: 25,
        timeoutMs: 600_000,
      },
    });
    const provider = fauxProvider({ provider: "research-budget-provider" });
    provider.setResponses([
      fauxAssistantMessage(fauxToolCall("web_search", { query: "first" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage(fauxToolCall("web_search", { query: "second" }), {
        stopReason: "toolUse",
      }),
      (context) => {
        expect(JSON.stringify(context.messages)).toContain(
          "Research budget exhausted",
        );
        return fauxAssistantMessage("Delivered from the existing evidence.");
      },
    ]);
    const models = new ModelRegistry();
    models.registerProvider(provider.provider);
    const runtime = new AgentRuntime(fixture.store, models);

    const run = await runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Research briefly, then deliver.",
      model: { provider: "research-budget-provider", id: "faux-1" },
    });

    expect(run.status).toBe("completed");
    const events = await fixture.store.listEvents(fixture.threadId);
    expect(
      events.filter((event) => event.type === "run.research.budget_exhausted"),
    ).toEqual([
      expect.objectContaining({
        visibility: "user",
        payload: expect.objectContaining({
          kind: "napier.run-research-budget",
          status: "exhausted",
          reason: "turns",
          turnIndex: 2,
          observed: expect.objectContaining({
            researchTurnCount: 1,
            maxResearchTurns: 1,
            maxResearchElapsedMs: 150_000,
          }),
          toolNameSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
      }),
    ]);
    expect(
      events.filter(
        (event) =>
          event.type === "tool.completed" &&
          event.payload["toolName"] === "web_search",
      ),
    ).toHaveLength(1);
    expect(
      events.filter(
        (event) =>
          event.type === "tool.failed" &&
          event.payload["toolName"] === "web_search",
      ),
    ).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain('"query":"first"');
    expect(JSON.stringify(events)).not.toContain('"query":"second"');
    fixture.store.close();
  });
});

async function createFixture(label: string) {
  const root = await mkdtemp(path.join(tmpdir(), `napier-research-${label}-`));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  const store = new LocalStore({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
  });
  await store.initialize();
  const agentId = store.listAgents()[0]!.id;
  const thread = await store.createThread({
    title: "Run research budget",
    agentId,
  });
  return { store, threadId: thread.id, agentId };
}
