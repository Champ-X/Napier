import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { agentCapabilityPresetUpdate } from "@napier/contracts/agent-capabilities";
import { afterEach, describe, expect, it } from "vitest";

import {
  AutomationService,
  createLocalAgentRuntime,
  UnsupportedSandboxAdapter,
} from "../src/index.js";
import {
  processRunReadinessMessage,
  ProcessRunReadinessError,
} from "../src/process-run-readiness.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Process Run readiness", () => {
  it("blocks process-capable Runtime calls before creating a Run", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-process-gate-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const services = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot: path.join(root, "state"),
      sandbox: new UnsupportedSandboxAdapter("process-gate-test"),
    });
    try {
      const agent = services.store.listAgents()[0]!;
      const processAgent = await services.store.updateAgent(
        agent.id,
        agentCapabilityPresetUpdate("safe_automation"),
      );
      const thread = await services.store.createThread({
        title: "Blocked process Run",
        agentId: processAgent.id,
      });

      await expect(
        services.runtime.runPrompt({
          threadId: thread.id,
          text: "Do not create this Run.",
        }),
      ).rejects.toBeInstanceOf(ProcessRunReadinessError);
      expect(services.store.listRuns(thread.id)).toHaveLength(0);
      expect(await services.store.listEvents(thread.id)).toHaveLength(0);
    } finally {
      await services.shutdown();
    }
  });

  it("settles Automation as failed without creating a process-capable Run", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-process-gate-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const services = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot: path.join(root, "state"),
      sandbox: new UnsupportedSandboxAdapter("automation-gate-test"),
    });
    try {
      const seeded = services.store.listAgents()[0]!;
      const agent = await services.store.updateAgent(
        seeded.id,
        agentCapabilityPresetUpdate("safe_automation"),
      );
      const thread = await services.store.createThread({
        title: "Blocked Automation",
        agentId: agent.id,
      });
      const schedule = await services.store.createSchedule({
        name: "Blocked schedule",
        threadId: thread.id,
        prompt: "Do not create this Run.",
        trigger: { type: "interval", everyMs: 60_000 },
      });

      const result = await new AutomationService(
        services.store,
        services.runtime,
      ).tick(new Date(schedule.nextRunAt));

      expect(result).toEqual(
        expect.objectContaining({ claimed: 1, failed: 1, completed: 0 }),
      );
      expect(services.store.listRuns(thread.id)).toHaveLength(0);
      expect(
        (await services.store.listEvents(thread.id)).map((event) => event.type),
      ).toEqual(["schedule.claimed", "schedule.failed"]);
    } finally {
      await services.shutdown();
    }
  });

  it("projects exact uninstall recovery only for an invalid persisted binding", () => {
    expect(
      processRunReadinessMessage({
        id: "sandbox:configured-sandbox-invalid",
      }),
    ).toContain("--component sandbox --uninstall");
    expect(
      processRunReadinessMessage({ id: "sandbox:unsupported" }),
    ).not.toContain("--uninstall");
  });
});
