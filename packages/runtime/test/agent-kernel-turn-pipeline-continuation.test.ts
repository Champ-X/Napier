import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAgentKernel } from "../src/agent-kernel.js";
import { createAgentPromptBuilder } from "../src/agent-prompt-builder.js";
import { AgentRuntime } from "../src/agent-runtime.js";
import { ModelRegistry } from "../src/models.js";
import { LocalStore } from "../src/store.js";
import {
  processReadySandbox,
  settledProcess,
} from "./process-run-readiness-test-fixture.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Agent Kernel Turn Pipeline continuations", () => {
  it("reuses the same Turn Pipeline for operator-decision continuation", async () => {
    const fixture = await createFixture("operator");
    const promptCreate = markerPromptAdapter();
    const select = vi.fn((candidates) => candidates);
    const kernel = await createAgentKernel({
      profile: "base",
      runtime: fixture.runtime,
      models: fixture.models,
      turnAdapters: {
        prompt: { id: "test.prompt.continuation", create: promptCreate },
        tool: { id: "test.tool.continuation", select },
      },
    });
    try {
      const provider = fauxProvider({ provider: "faux-turn-continuation" });
      provider.setResponses([
        (context) => {
          expect(context.systemPrompt).toContain(TURN_MARKER);
          return fauxAssistantMessage(
            fauxToolCall("request_operator_decision", {
              header: "Scope",
              question: "Which scope should continue?",
              options: [
                { label: "Runtime", description: "Continue Runtime work." },
                { label: "Stop", description: "Stop here." },
              ],
              multiSelect: false,
            }),
            { stopReason: "toolUse" },
          );
        },
        (context) => {
          expect(context.systemPrompt).toContain(TURN_MARKER);
          expect(JSON.stringify(context.messages)).toContain("Runtime");
          return fauxAssistantMessage("Kernel continuation completed.");
        },
        fauxAssistantMessage('{"facts":[]}'),
      ]);
      fixture.models.registerProvider(provider.provider);
      const origin = await kernel.runPrompt({
        threadId: fixture.threadId,
        text: "Ask for the implementation scope.",
        model: { provider: provider.provider.id, id: "faux-1" },
      });
      const decision = (
        await fixture.store.listOperatorDecisions(fixture.threadId)
      )[0]!;
      await fixture.store.answerOperatorDecision(
        fixture.threadId,
        decision.id,
        { selectedOptionIds: ["option_1"] },
      );

      const continuation = await kernel.continueOperatorDecision({
        threadId: fixture.threadId,
        decisionId: decision.id,
      });

      expect(origin.status).toBe("completed");
      expect(continuation).toEqual(
        expect.objectContaining({
          status: "completed",
          parentRunId: origin.id,
        }),
      );
      expect(select).toHaveBeenCalledTimes(2);
      const pipelineHashes = await turnPipelineHashes(
        fixture.store,
        fixture.threadId,
      );
      expect(pipelineHashes).toHaveLength(2);
      expect(new Set(pipelineHashes).size).toBe(1);
    } finally {
      await kernel.shutdown();
      fixture.store.close();
    }
  });

  it("reuses the same Turn Pipeline for manual recovery", async () => {
    const fixture = await createFixture("recovery");
    const select = vi.fn((candidates) => candidates);
    const kernel = await createAgentKernel({
      profile: "base",
      runtime: fixture.runtime,
      models: fixture.models,
      turnAdapters: {
        prompt: {
          id: "test.prompt.recovery",
          create: markerPromptAdapter(),
        },
        tool: { id: "test.tool.recovery", select },
      },
    });
    try {
      const agent = fixture.store.getThread(fixture.threadId).agentId;
      const interrupted = await fixture.store.createRun({
        threadId: fixture.threadId,
        agentId: agent,
        model: { provider: "faux-prior", id: "faux-1" },
      });
      await fixture.store.appendEvent({
        threadId: fixture.threadId,
        runId: interrupted.id,
        type: "message.user",
        category: "message",
        visibility: "user",
        payload: { role: "user", text: "Recover the verified checkpoint." },
      });
      await fixture.store.finishRun(interrupted.id, "failed", {
        outcome: "paused_budget",
        error: "Paused at the verified checkpoint.",
      });
      const provider = fauxProvider({ provider: "faux-turn-recovery" });
      provider.setResponses([
        (context) => {
          expect(context.systemPrompt).toContain(TURN_MARKER);
          expect(JSON.stringify(context.messages)).toContain("<run-recovery>");
          return fauxAssistantMessage("Kernel recovery completed.");
        },
        fauxAssistantMessage('{"facts":[]}'),
      ]);
      fixture.models.registerProvider(provider.provider);

      const recovered = await kernel.resumeInterruptedRun({
        threadId: fixture.threadId,
        runId: interrupted.id,
        model: { provider: provider.provider.id, id: "faux-1" },
      });

      expect(recovered).toEqual(
        expect.objectContaining({
          status: "completed",
          parentRunId: interrupted.id,
          source: "recovery",
        }),
      );
      expect(select).toHaveBeenCalledOnce();
      expect(
        await turnPipelineHashes(fixture.store, fixture.threadId),
      ).toHaveLength(1);
    } finally {
      await kernel.shutdown();
      fixture.store.close();
    }
  });

  it("does not call the additional Policy adapter after built-in Policy rejects", async () => {
    const fixture = await createFixture("policy", ["read_file"]);
    const additionalPolicy = vi.fn(() => undefined);
    const kernel = await createAgentKernel({
      profile: "base",
      runtime: fixture.runtime,
      models: fixture.models,
      turnAdapters: {
        policy: { id: "test.policy.must-not-run", preflight: additionalPolicy },
      },
    });
    try {
      const provider = fauxProvider({ provider: "faux-built-in-policy" });
      provider.setResponses([
        fauxAssistantMessage(
          fauxToolCall("read_file", { path: "../outside.txt" }),
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage("Built-in Policy remained authoritative."),
        fauxAssistantMessage('{"facts":[]}'),
      ]);
      fixture.models.registerProvider(provider.provider);

      const run = await kernel.runPrompt({
        threadId: fixture.threadId,
        text: "Attempt a read outside the workspace.",
        model: { provider: provider.provider.id, id: "faux-1" },
      });

      expect(run.status, run.error).toBe("completed");
      expect(additionalPolicy).not.toHaveBeenCalled();
      expect(
        (await fixture.store.listEvents(fixture.threadId)).map((event) => ({
          type: event.type,
          payload: event.payload,
        })),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "tool.blocked",
            payload: expect.objectContaining({ toolName: "read_file" }),
          }),
        ]),
      );
    } finally {
      await kernel.shutdown();
      fixture.store.close();
    }
  });
});

const TURN_MARKER = "Kernel continuation prompt marker.";

function markerPromptAdapter(): typeof createAgentPromptBuilder {
  return (sources, active) =>
    createAgentPromptBuilder(
      {
        ...sources,
        resolvedSystemPrompt: `${sources.resolvedSystemPrompt}\n${TURN_MARKER}`,
      },
      active,
    );
}

async function createFixture(
  name: string,
  enabledTools: string[] = ["read_file"],
) {
  const root = await mkdtemp(path.join(tmpdir(), `napier-turn-${name}-`));
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
    enabledTools,
  });
  const thread = await store.createThread({
    title: `Turn Pipeline ${name}`,
    agentId: agent.id,
  });
  const models = new ModelRegistry();
  return {
    workspaceRoot,
    store,
    models,
    threadId: thread.id,
    runtime: new AgentRuntime(
      store,
      models,
      undefined,
      processReadySandbox(`turn-${name}`, async () => settledProcess("ok\n")),
    ),
  };
}

async function turnPipelineHashes(
  store: LocalStore,
  threadId: string,
): Promise<string[]> {
  return (await store.listEvents(threadId))
    .filter((event) => event.type === "context.prepared")
    .flatMap((event) => {
      const payload = event.payload;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return [];
      }
      const hash = payload["turnPipelineSha256"];
      return typeof hash === "string" ? [hash] : [];
    });
}
