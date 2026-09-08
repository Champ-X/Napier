import { afterEach, describe, expect, it } from "vitest";
import { createPlanTools } from "../src/plan-tools.js";
import { RunProgressTracker } from "../src/run-progress-vector.js";
import { ToolProtocolRegistry } from "../src/tool-protocol-registry.js";
import { createWorkspaceTools } from "../src/tools.js";
import { DurableToolOperationJournal } from "../src/tool-operation-journal.js";
import { operationDescriptor } from "./tool-operation-test-support.js";
import {
  cleanupProgressFixtures,
  createFixture,
  createRun,
  declaredTool,
  event,
} from "./run-progress-vector-test-support.js";

afterEach(cleanupProgressFixtures);

describe("convergence capability availability", () => {
  it("allows an alternate acquisition strategy after compound failure and retains control tools after convergence", async () => {
    const fixture = await createFixture("compound-acquisition");
    const run = await createRun(fixture);
    const planTools = createPlanTools(fixture.store, run);
    const workspaceTools = createWorkspaceTools(
      fixture.store.workspaceRoot,
    ).filter((tool) =>
      ["read_file", "list_files", "search_files"].includes(tool.name),
    );
    const collector = declaredTool("collector", ["acquire"]);
    const tools = [...planTools, ...workspaceTools, collector];
    const registry = new ToolProtocolRegistry(tools);
    const tracker = await RunProgressTracker.create(
      fixture.store,
      run,
      undefined,
      undefined,
      undefined,
      registry,
    );
    const journal = new DurableToolOperationJournal(fixture.store, {
      threadId: run.threadId,
      runId: run.id,
    });
    await attempt(1);
    let events = await fixture.store.listRunEvents(run.id);
    expect(
      events.some((item) => item.type === "run.progress.convergence_requested"),
    ).toBe(false);
    expect(
      events.filter((item) => item.type === "run.progress.vector").at(-1)
        ?.payload,
    ).toMatchObject({
      acquisitionAttemptCount: 2,
      activity: { acquisitionTurnCountSinceProgress: 1 },
    });
    await expect(
      tracker.preflightTool("alternate", collector.name, {
        target: "https://alternate.test",
      }),
    ).resolves.toBeUndefined();
    await attempt(2);
    events = await fixture.store.listRunEvents(run.id);
    expect(
      events.filter(
        (item) => item.type === "run.progress.convergence_requested",
      ),
    ).toHaveLength(1);
    await tracker.steer(new Map(), async () => []);
    // Exhaust the generic opaque-tool lease. Declared control and retained
    // evidence tools must still be available in both schema and preflight.
    for (let index = 0; index < 2; index++) {
      const admitted = await event(fixture.store, run, "tool.admitted", {
        callId: `opaque-${index}`,
        toolName: "opaque",
        toolProtocol: {
          progress: {
            coverage: "opaque",
            operation: "neutral",
            contribution: "neutral",
          },
        },
      });
      tracker.observeEvent(admitted);
    }
    await event(fixture.store, run, "turn.completed", {});
    await tracker.recordTurn();
    expect(tracker.toolsForNextTurn(tools)?.map((tool) => tool.name)).toEqual(
      [...planTools, ...workspaceTools].map((tool) => tool.name),
    );
    for (const tool of [...planTools, ...workspaceTools]) {
      await expect(
        tracker.preflightTool(`check-${tool.name}`, tool.name, {
          planId: "plan",
          path: ".",
        }),
      ).resolves.toBeUndefined();
    }
    const create = planTools.find((tool) => tool.name === "create_plan")!;
    const plan = await create.execute("plan-after-convergence", {
      objective: "Deliver using retained evidence",
      steps: [
        {
          id: "verify",
          title: "Verify",
          description: "Inspect output",
          verification: "Record the check",
        },
      ],
    });
    const transition = planTools.find(
      (tool) => tool.name === "update_plan_step",
    )!;
    const result = await transition.execute("plan-step", {
      planId: plan.details.planId,
      stepId: "verify",
      action: "start",
    });
    expect(result.details.status).toBe("running");
    expect(registry.get(transition.name)?.progress({})).toMatchObject({
      coverage: "trusted_declared",
      contribution: "control",
    });
    await fixture.store.close();

    async function attempt(turn: number) {
      for (let index = 1; index <= 2; index++) {
        const operation = journal.observer(`fetch-${turn}`).operation({
          ...operationDescriptor(),
          ordinal: index,
          route: `route-${turn}-${index}`,
          resourceKey: { source: turn },
          failureDomainKey: { route: `route-${turn}-${index}` },
        });
        await operation.admit();
        await operation.started();
        await operation.settled({
          outcome: "failed",
          diagnostic: "request timeout",
        });
      }
      await event(fixture.store, run, "turn.completed", {});
      return tracker.recordTurn();
    }
  });
});
