import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type Context,
} from "@earendil-works/pi-ai";
import { afterEach, expect, it } from "vitest";
import { AgentRuntime } from "../src/agent-runtime.js";
import { ModelRegistry } from "../src/models.js";
import { ModelInvocationCapsuleStore } from "../src/model-invocation-capsule-store.js";
import {
  createHarnessPolicyProfile,
  presetHarnessPolicy,
} from "../src/harness-policy-profile.js";
import { createModelHarnessExperimentProfile } from "../src/model-harness-experiment-profile.js";
import { projectTaskRequirementRevisions } from "../src/task-requirement-revisions.js";
import {
  cleanupProgressFixtures,
  createFixture,
} from "./run-progress-vector-test-support.js";
import type { createRunBudgetContext } from "../src/run-budget-context.js";

afterEach(cleanupProgressFixtures);

function snapshots(context: Context) {
  return context.messages.flatMap((message) => {
    if (message.role !== "user" || typeof message.content !== "string")
      return [];
    let packet;
    try {
      packet = JSON.parse(message.content);
    } catch {
      return [];
    }
    if (packet.kind !== "napier.runtime-context") return [];
    return (packet.sources as { sourceId: string; content: string }[])
      .filter((source) => source.sourceId === "workspace.run_budget")
      .map(
        (source) =>
          JSON.parse(source.content) as ReturnType<
            typeof createRunBudgetContext
          >,
      );
  });
}

it.each(["request-aware-v1", "request-aware-v2"] as const)(
  "delivers fresh captured budgets only for %s without revising user requirements",
  async (finalization) => {
    const f = await createFixture(`budget-context-${finalization}`);
    const seen: ReturnType<typeof createRunBudgetContext>[][] = [];
    const prompts: (string | undefined)[] = [];
    const observe = (context: Context) => {
      seen.push(snapshots(context));
      prompts.push(context.systemPrompt);
    };
    try {
      await f.store.updateAgent(f.agentId, {
        enabledTools: ["read_file"],
        enabledSkills: [],
        runLimits: {
          maxTurns: 8,
          maxTotalTokens: 250000,
          maxCostUsd: 3,
          timeoutMs: 900000,
        },
      });
      const provider = fauxProvider({
        provider: `budget-context-${finalization}`,
      });
      provider.setResponses([
        (context) => {
          observe(context);
          return fauxAssistantMessage(
            fauxToolCall("read_file", { path: "missing-a.txt" }),
            { stopReason: "toolUse" },
          );
        },
        (context) => {
          observe(context);
          return fauxAssistantMessage(
            fauxToolCall("read_file", { path: "missing-b.txt" }),
            { stopReason: "toolUse" },
          );
        },
        (context) => {
          observe(context);
          return fauxAssistantMessage(
            "Neither required input exists; no files were changed.",
          );
        },
        fauxAssistantMessage('{"facts":[]}'),
      ]);
      const models = new ModelRegistry();
      models.registerProvider(provider.provider);
      const {
        contentSha256: _hash,
        schemaVersion: _schema,
        ...base
      } = presetHarnessPolicy("coding-node.v1");
      const profile = createModelHarnessExperimentProfile({
        id: `budget-context-${finalization}`,
        maxActiveTools: 16,
        policies: createHarnessPolicyProfile({
          ...base,
          context: { ...base.context, delivery: "tail-v1", finalization },
        }),
      });
      const run = await new AgentRuntime(f.store, models).runPrompt({
        threadId: f.threadId,
        text: "Read missing-a.txt and missing-b.txt; preserve both missing files and report the limitation.",
        model: { provider: provider.provider.id, id: "faux-1" },
        harnessExperimentProfile: profile,
      });
      expect(run.status, run.error).toBe("completed");
      expect(seen).toHaveLength(3);
      if (finalization === "request-aware-v2") {
        expect(seen.map((items) => items.length)).toEqual([1, 1, 1]);
        expect(seen.map((items) => items[0]!.remaining.primaryTurns)).toEqual([
          7, 6, 5,
        ]);
        expect(seen.map((items) => items[0]!.observed.inFlightPrimaryTurns)).toEqual([1, 1, 1]);
        expect(seen[2]![0]!.remaining.accountedTokens).toBeLessThan(
          seen[1]![0]!.remaining.accountedTokens,
        );
        expect(seen[2]![0]!.phase).toBe("finalization");
        expect(new Set(prompts).size).toBe(1);
      } else expect(seen).toEqual([[], [], []]);
      const events = await f.store.listRunEvents(run.id);
      expect(projectTaskRequirementRevisions(events).instructionRevision).toBe(
        1,
      );
      const invocations = events.filter(
        (e) =>
          e.type === "context.model_invocation" &&
          e.payload.purpose === "agent_turn",
      );
      const capsules = new ModelInvocationCapsuleStore(f.store.dataRoot);
      expect(invocations).toHaveLength(3);
      for (const [index, event] of invocations.entries()) {
        const capsule = await capsules.read(
          event.payload.capsuleSha256 as string,
        );
        expect(snapshots(capsule.context)).toEqual(seen[index]);
      }
    } finally {
      await f.store.close();
    }
  },
);
