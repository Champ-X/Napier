import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { createPlanTools } from "../src/plan-tools.js";
import { LocalStore } from "../src/store.js";
import { parseTaskPlanSnapshot } from "../src/task-plan-snapshot.js";

it("returns hash-valid current plan snapshots from actual plan mutations", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "napier-plan-snapshot-"));
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  const store = new LocalStore({
    dataRoot: path.join(root, "data"),
    workspaceRoot,
  });
  try {
    await store.initialize();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Plan snapshot",
      agentId: agent.id,
    });
    const run = await store.createRun({
      threadId: thread.id,
      agentId: agent.id,
    });
    const tools = createPlanTools(store, run);
    const create = tools.find((tool) => tool.name === "create_plan")!;
    const transition = tools.find((tool) => tool.name === "update_plan_step")!;
    const created = await create.execute("create", {
      objective: "Produce the requested report",
      steps: [
        {
          id: "write",
          title: "Write",
          description: "Produce report",
          verification: "Inspect report bytes",
        },
      ],
      artifacts: [
        { id: "report", path: "report.json", description: "Requested report" },
      ],
    });
    const planId = created.details.planId;
    const initial = parseTaskPlanSnapshot(created.details.planState);
    expect(initial).toMatchObject({
      planId,
      threadId: thread.id,
      revision: store.getPlan(planId).revision,
      artifacts: [{ id: "report", path: "report.json", status: "expected" }],
    });
    const started = await transition.execute("start", {
      planId,
      stepId: "write",
      action: "start",
    });
    const current = parseTaskPlanSnapshot(started.details.planState);
    expect(current).toMatchObject({
      planId,
      revision: store.getPlan(planId).revision,
      steps: [{ id: "write", status: "running" }],
    });
    expect(current!.revision).toBeGreaterThan(initial!.revision);
    expect(initial!.steps[0]!.status).not.toBe("running");
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});
