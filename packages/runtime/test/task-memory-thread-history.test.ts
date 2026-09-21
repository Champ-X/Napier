import {
  fauxAssistantMessage,
  fauxProvider,
  type Context,
} from "@earendil-works/pi-ai";
import { afterEach, expect, it } from "vitest";
import { ModelRegistry } from "../src/models.js";
import { createThreadBranch } from "../src/thread-branches.js";
import { createHarnessPolicyProfile } from "../src/harness-policy-profile.js";
import { createModelHarnessExperimentProfile } from "../src/model-harness-experiment-profile.js";
import {
  cleanupProgressFixtures,
  createFixture,
} from "./run-progress-vector-test-support.js";
import { processReadyAgentRuntime } from "./process-run-readiness-test-fixture.js";

afterEach(cleanupProgressFixtures);

it("keeps task-memory provenance across actual thread turns and a copied branch cutoff", async () => {
  const f = await createFixture("thread-memory-provenance");
  await f.store.updateAgent(f.agentId, {
    enabledTools: ["read_file"],
    enabledSkills: [],
    enabledSubagents: [],
  });
  const required = await f.store.proposeMemory(
    {
      content:
        "Fulfillment amounts must preserve integer-cent arithmetic. " +
        "Use the reviewed monetary rounding rule. ".repeat(7),
    },
    { type: "manual" },
  );
  await f.store.reviewMemory(required.id, { action: "approve" });
  for (let index = 0; index < 12; index++) {
    const noise = await f.store.proposeMemory(
      { content: `Observer dashboard item ${index}. `.padEnd(630, "x") },
      { type: "manual" },
    );
    await f.store.reviewMemory(noise.id, { action: "approve" });
  }
  const provider = fauxProvider({ provider: "thread-memory-provenance" });
  const seen: Context[] = [];
  provider.setResponses(
    Array.from({ length: 12 }, () => (context: Context) => {
      if (!context.tools?.length) return fauxAssistantMessage('{"facts":[]}');
      seen.push({ ...context, messages: structuredClone(context.messages) });
      return fauxAssistantMessage("Reviewed the available task context.");
    }),
  );
  const models = new ModelRegistry();
  models.registerProvider(provider.provider);
  const runtime = processReadyAgentRuntime(f.store, models);
  const profile = createModelHarnessExperimentProfile({
    id: "thread-memory-provenance",
    maxActiveTools: 20,
    policies: createHarnessPolicyProfile({
      id: "thread-memory-provenance",
      revision: 1,
      context: {
        prompt: "stable-v1",
        memory: "task-aware-grouped-v3",
        workingState: "evidence-v1",
        delivery: "tail-v1",
      },
      toolSurface: { editReferences: false },
      verification: "node-v1",
    }),
  });
  const execute = (threadId: string, text: string) =>
    runtime.runPrompt({
      threadId,
      text,
      model: { provider: provider.provider.id, id: "faux-1" },
      harnessExperimentProfile: profile,
    });
  const first = await execute(f.threadId, "Review fulfillment arithmetic.");
  expect(first.status, first.error).toBe("completed");
  const firstRequest = (await f.store.listRunEvents(first.id)).find(
    (event) => event.type === "message.user",
  )!;
  const followUp = await execute(
    f.threadId,
    "Continue using that rule. FUTURE_ONLY_MARKER",
  );
  expect(followUp.status, followUp.error).toBe("completed");
  const branch = await createThreadBranch(f.store, f.threadId, {
    fromSeq: firstRequest.seq,
  });
  expect(branch.run.parentRunId).toBe(first.id);
  const branchRequest = (await f.store.listRunEvents(branch.run.id)).find(
    (event) => event.type === "message.user",
  )!;
  const branchFollowUp = await execute(
    branch.run.threadId,
    "Continue using that rule.",
  );
  expect(branchFollowUp.status, branchFollowUp.error).toBe("completed");
  expect(seen).toHaveLength(3);
  for (const context of seen) {
    const tail = JSON.parse(String(context.messages.at(-1)!.content));
    expect(
      tail.sources.find(
        (source: { sourceId: string }) =>
          source.sourceId === "workspace.memory",
      ).content,
    ).toContain(required.content);
  }
  expect(JSON.stringify(seen[2])).not.toContain("FUTURE_ONLY_MARKER");
  for (const [record, origin] of [
    [followUp, firstRequest],
    [branchFollowUp, branchRequest],
  ] as const) {
    const events = await f.store.listRunEvents(record.id);
    const current = events.find((event) => event.type === "message.user")!;
    const query = events.find(
      (event) =>
        event.type === "context.memory" &&
        event.payload.phase === "model_invocation",
    )!.payload.query;
    expect(query).toMatchObject({
      sourceEventIds: [current.id, origin.id],
      sourceRunIds: [record.id, origin.runId],
    });
  }
});
