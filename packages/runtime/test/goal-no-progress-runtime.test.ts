import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import { AgentRuntime } from "../src/agent-runtime.js";
import { createGoal } from "../src/goals.js";
import { ModelRegistry } from "../src/models.js";
import { LocalStore } from "../src/store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("durable Goal no-progress execution", () => {
  it("blocks repeated evidence after two continuations and survives reopen", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-goal-progress-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const dataRoot = path.join(root, "state");
    await mkdir(workspaceRoot);
    const store = new LocalStore({ dataRoot, workspaceRoot });
    await store.initialize();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "No-progress breaker",
      agentId: agent.id,
    });
    await store.setGoal(
      thread.id,
      createGoal("Produce evidence that cannot be produced in this fixture."),
    );

    const provider = fauxProvider({
      provider: "faux-goal-progress",
      tokenSize: { min: 10_000, max: 10_000 },
    });
    provider.setResponses([
      repeatedEvidence(),
      continueEvaluation(),
      repeatedEvidence(),
      continueEvaluation(),
      repeatedEvidence(),
      continueEvaluation(),
      fauxAssistantMessage('{"proposals":[]}'),
    ]);
    const models = new ModelRegistry();
    models.registerProvider(provider.provider);
    const runtime = new AgentRuntime(store, models);

    const run = await runtime.runPrompt({
      threadId: thread.id,
      text: "Return the fixed evidence marker.",
      model: { provider: "faux-goal-progress", id: "faux-1" },
    });

    expect(run.status).toBe("completed");
    expect(provider.state.callCount).toBe(7);
    const detail = await store.getDetail(thread.id);
    expect(detail.thread.goal).toEqual(
      expect.objectContaining({
        status: "blocked",
        blocker: "goal_not_met_yet",
        continuationCount: 2,
        noProgressCount: 2,
        maxNoProgressContinuations: 2,
        lastEvaluatedRunId: run.id,
      }),
    );
    const goalEvents = detail.events.filter((event) =>
      event.type.startsWith("goal."),
    );
    expect(
      goalEvents.filter((event) => event.type === "goal.continuation.started"),
    ).toHaveLength(2);
    const evaluations = goalEvents.filter(
      (event) => event.type === "goal.evaluated",
    );
    expect(evaluations).toHaveLength(3);
    expect(
      evaluations.map((event) => event.payload["noProgressCount"]),
    ).toEqual([0, 1, 2]);
    expect(evaluations.at(-1)?.payload).toEqual(
      expect.objectContaining({
        status: "blocked",
        blocker: "goal_not_met_yet",
        continuationCount: 2,
        noProgressCount: 2,
      }),
    );
    expect(
      goalEvents.some(
        (event) =>
          event.type === "goal.continuation.started" &&
          event.seq > evaluations.at(-1)!.seq,
      ),
    ).toBe(false);

    await store.close();
    const reopened = new LocalStore({ dataRoot, workspaceRoot });
    await reopened.initialize();
    expect(reopened.getThread(thread.id).goal).toEqual(detail.thread.goal);
    await reopened.close();
  });
});

function repeatedEvidence() {
  return fauxAssistantMessage("NO_PROGRESS_EVIDENCE_V1");
}

function continueEvaluation() {
  return fauxAssistantMessage(
    JSON.stringify({
      satisfied: false,
      blocker: "goal_not_met_yet",
      reason: "The fixture cannot produce new evidence.",
      evidence: "NO_PROGRESS_EVIDENCE_V1",
    }),
  );
}
