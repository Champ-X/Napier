import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { afterEach, expect, it } from "vitest";
import { ModelRegistry } from "../src/models.js";
import { createThreadBranch } from "../src/thread-branches.js";
import { projectTaskRequirementRevisions } from "../src/task-requirement-revisions.js";
import {
  cleanupProgressFixtures,
  createFixture,
} from "./run-progress-vector-test-support.js";
import { processReadyAgentRuntime } from "./process-run-readiness-test-fixture.js";

afterEach(cleanupProgressFixtures);

it.each(["steering", "follow_up"] as const)(
  "continues a branch containing historical %s without rewriting either ledger",
  async (mode) => {
    const f = await createFixture(`branch-control-${mode}`);
    await f.store.updateAgent(f.agentId, {
      enabledTools: ["read_file"],
      enabledSkills: [],
      enabledSubagents: [],
    });
    const source = await f.store.createRun({
      threadId: f.threadId,
      agentId: f.agentId,
      model: { provider: "branch-control-source", id: "faux-1" },
    });
    await f.store.appendEvent({
      threadId: f.threadId,
      runId: source.id,
      type: "message.user",
      category: "message",
      visibility: "user",
      payload: { role: "user", text: "Review pricing arithmetic." },
    });
    await f.store.queueRunControlMessage({
      threadId: f.threadId,
      runId: source.id,
      mode,
      text: "Preserve integer cents arithmetic.",
    });
    await f.store.deliverNextRunControlMessage(f.threadId, source.id, mode);
    await f.store.finishRun(source.id, "completed");
    const sourceEvents = await f.store.listRunEvents(source.id);
    const amendment = sourceEvents.findLast(
      (event) => event.type === "message.user",
    )!;
    expect(amendment.payload.controlMode).toBe(mode);
    const branch = await createThreadBranch(f.store, f.threadId, {
      fromSeq: amendment.seq,
    });
    const copiedEvents = await f.store.listRunEvents(branch.run.id);
    const copied = copiedEvents.findLast(
      (event) => event.type === "message.user",
    )!;
    expect(copied.payload).toEqual(amendment.payload);
    expect(() => projectTaskRequirementRevisions(copiedEvents)).toThrow(
      "Task requirement control delivery is not validated",
    );
    expect(
      copiedEvents.some((event) => event.type === "run.control.delivered"),
    ).toBe(false);
    const provider = fauxProvider({ provider: `branch-control-${mode}` });
    let calls = 0;
    provider.setResponses([
      () => {
        calls++;
        return fauxAssistantMessage("Reviewed the accepted branch history.");
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const models = new ModelRegistry();
    models.registerProvider(provider.provider);
    const run = await processReadyAgentRuntime(f.store, models).runPrompt({
      threadId: branch.run.threadId,
      text: "Continue using those rules.",
      model: { provider: provider.provider.id, id: "faux-1" },
      harnessPolicyPreset: "coding-node.v1",
    });
    expect(run.status, run.error).toBe("completed");
    expect(calls).toBe(1);
    const events = await f.store.listRunEvents(run.id);
    const memory = events.find(
      (event) =>
        event.type === "context.memory" &&
        event.payload.phase === "model_invocation",
    )!;
    expect(memory.payload.query).toMatchObject({
      sourceEventIds: expect.arrayContaining([copied.id]),
      branchCopies: expect.arrayContaining([
        {
          eventId: copied.id,
          kind: "branch_copy",
          branchRunId: branch.run.id,
          branchEventId: copiedEvents[0]!.id,
          sourceThreadId: f.threadId,
          sourceSeq: amendment.seq,
        },
      ]),
    });
    expect(await f.store.listRunEvents(source.id)).toEqual(sourceEvents);
    expect(await f.store.listRunEvents(branch.run.id)).toEqual(copiedEvents);
  },
);
