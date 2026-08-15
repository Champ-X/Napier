import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createPlanTools } from "../src/plan-tools.js";
import { LocalStore } from "../src/store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Plan tool transitions", () => {
  it("records start before concurrent direct completions", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-plan-transition-"));
    roots.push(root);
    const store = new LocalStore({
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    });
    await store.initialize();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Plan transition repair",
      agentId: agent.id,
    });
    const run = await store.createRun({
      threadId: thread.id,
      agentId: agent.id,
    });
    const tools = createPlanTools(store, run);
    const createPlan = tools.find((tool) => tool.name === "create_plan")!;
    const transition = tools.find((tool) => tool.name === "update_plan_step")!;
    const created = await createPlan.execute("create-plan", {
      objective: "Complete two bounded steps.",
      steps: [
        {
          id: "verify",
          title: "Verify",
          description: "Verify the evidence.",
          verification: "Verification evidence is recorded.",
        },
        {
          id: "curate",
          title: "Curate",
          description: "Curate the evidence.",
          verification: "Curation evidence is recorded.",
        },
      ],
    });

    const completed = await Promise.all([
      transition.execute("complete-verify", {
        planId: created.details.planId,
        stepId: "verify",
        action: "complete",
        evidence: "The evidence was checked.",
      }),
      transition.execute("complete-curate", {
        planId: created.details.planId,
        stepId: "curate",
        action: "complete",
        evidence: "The evidence was curated.",
      }),
    ]);

    expect(completed.map((result) => result.details.status)).toEqual([
      "completed",
      "completed",
    ]);
    expect(
      (await store.listEvents(thread.id))
        .filter((event) => event.type.startsWith("plan.step."))
        .map((event) => ({
          type: event.type,
          stepId:
            event.payload &&
            !Array.isArray(event.payload) &&
            typeof event.payload === "object"
              ? event.payload["stepId"]
              : undefined,
        })),
    ).toEqual(
      expect.arrayContaining([
        { type: "plan.step.started", stepId: "verify" },
        { type: "plan.step.completed", stepId: "verify" },
        { type: "plan.step.started", stepId: "curate" },
        { type: "plan.step.completed", stepId: "curate" },
      ]),
    );
  });
});
