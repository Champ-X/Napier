import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { LocalStore } from "../src/store.js";

const roots: string[] = [];
const stores: LocalStore[] = [];

afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Operator-decision event admission", () => {
  it("records answer and continuation audit facts on the terminal origin Run", async () => {
    const store = await openStore();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Terminal origin decision audit",
      agentId: agent.id,
    });
    const model = { provider: "faux-decision", id: "faux-1" } as const;
    const origin = await store.createRun({
      threadId: thread.id,
      agentId: agent.id,
      model,
    });
    const requested = await store.requestOperatorDecision({
      threadId: thread.id,
      runId: origin.id,
      header: "Scope",
      question: "Which scope should continue?",
      options: [
        { label: "Runtime", description: "Continue with runtime scope." },
        { label: "Stop", description: "Leave the work stopped." },
      ],
      multiSelect: false,
    });

    await store.finishRun(origin.id, "completed", {
      waitForOperatorDecisionId: requested.decision.id,
    });
    await store.answerOperatorDecision(thread.id, requested.decision.id, {
      selectedOptionIds: ["option_1"],
    });
    const continuation = await store.createRun({
      threadId: thread.id,
      agentId: agent.id,
      agentRevision: origin.agentRevision!,
      model,
      parentRunId: origin.id,
      operatorDecisionId: requested.decision.id,
    });
    await store.continueOperatorDecision(
      thread.id,
      requested.decision.id,
      continuation.id,
    );

    expect(
      (await store.listRunEvents(origin.id))
        .filter((event) =>
          [
            "operator.decision.answered",
            "operator.decision.continued",
          ].includes(event.type),
        )
        .map((event) => ({ type: event.type, runId: event.runId })),
    ).toEqual([
      { type: "operator.decision.answered", runId: origin.id },
      { type: "operator.decision.continued", runId: origin.id },
    ]);
  });
});

async function openStore(): Promise<LocalStore> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-decision-admission-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  const store = new LocalStore({
    dataRoot: path.join(root, "data"),
    workspaceRoot,
  });
  stores.push(store);
  await store.initialize();
  return store;
}
