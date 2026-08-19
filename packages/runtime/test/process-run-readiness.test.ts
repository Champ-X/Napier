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
import { SwitchableSandboxAdapter } from "../src/sandbox-switchable.js";
import { processRunReadinessMessage } from "../src/process-run-readiness.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Process Run readiness", () => {
  it("negotiates the full-capability default to a receipt-bound read-only Run", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-process-gate-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const services = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot: path.join(root, "state"),
      sandbox: new SwitchableSandboxAdapter(
        new UnsupportedSandboxAdapter("default-mode-test"),
      ),
    });
    try {
      const agent = services.store.listAgents()[0]!;
      const thread = await services.store.createThread({
        title: "Default full-capability Run",
        agentId: agent.id,
      });

      await expect(
        services.runtime.runPrompt({
          threadId: thread.id,
          text: "Answer without invoking a process tool.",
        }),
      ).resolves.toEqual(expect.objectContaining({ status: "completed" }));
      const run = services.store.listRuns(thread.id)[0]!;
      expect(run.configuration).toEqual(
        expect.objectContaining({
          executionMode: "environment_degraded_read_only",
          toolPolicy: "observe",
          enabledSubagents: [],
          enabledTools: expect.arrayContaining([
            "read_file",
            "web_search",
            "web_fetch",
          ]),
        }),
      );
      expect(run.configuration?.enabledTools).not.toEqual(
        expect.arrayContaining([
          "apply_patch",
          "run_command",
          "workspace_process",
        ]),
      );
      const receipt = (await services.store.listEvents(thread.id)).find(
        (event) => event.type === "run.environment.negotiated",
      );
      expect(receipt).toEqual(
        expect.objectContaining({
          visibility: "user",
          payload: expect.objectContaining({
            kind: "napier.environment-capability-negotiation",
            status: "degraded_read_only",
            activeToolNames: expect.arrayContaining([
              "read_file",
              "web_search",
              "web_fetch",
            ]),
            omittedToolNames: expect.arrayContaining([
              "apply_patch",
              "run_command",
            ]),
            contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          }),
        }),
      );
    } finally {
      await services.shutdown();
    }
  });

  it("degrades an explicit process-capable mode instead of failing the task", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-process-gate-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const services = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot: path.join(root, "state"),
      sandbox: new SwitchableSandboxAdapter(
        new UnsupportedSandboxAdapter("process-gate-test"),
      ),
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

      const run = await services.runtime.runPrompt({
        threadId: thread.id,
        text: "Inspect what is available without mutating the workspace.",
        capabilityPreset: "safe_automation",
      });
      expect(run.status).toBe("completed");
      expect(run.configuration).toEqual(
        expect.objectContaining({
          executionMode: "environment_degraded_read_only",
          toolPolicy: "observe",
        }),
      );
      expect(services.store.listRuns(thread.id)).toHaveLength(1);
      expect(
        (await services.store.listEvents(thread.id)).map((event) => event.type),
      ).toContain("run.environment.negotiated");
    } finally {
      await services.shutdown();
    }
  });

  it("settles a pre-aborted negotiated Run as durable cancellation evidence", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-process-gate-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const services = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot: path.join(root, "state"),
      sandbox: new UnsupportedSandboxAdapter("pre-aborted-run"),
    });
    try {
      const agent = services.store.listAgents()[0]!;
      const thread = await services.store.createThread({
        title: "Pre-aborted negotiated Run",
        agentId: agent.id,
      });
      const controller = new AbortController();
      controller.abort();

      await expect(
        services.runtime.runPrompt({
          threadId: thread.id,
          text: "Preserve terminal cancellation evidence.",
          signal: controller.signal,
        }),
      ).resolves.toEqual(expect.objectContaining({ status: "cancelled" }));
      expect(services.store.listRuns(thread.id)).toEqual([
        expect.objectContaining({
          status: "cancelled",
          configuration: expect.objectContaining({
            executionMode: "environment_degraded_read_only",
            toolPolicy: "observe",
          }),
        }),
      ]);
      expect(
        (await services.store.listEvents(thread.id)).map((event) => event.type),
      ).toContain("run.cancelled");
    } finally {
      await services.shutdown();
    }
  });

  it("lets Automation complete within the negotiated read-only boundary", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-process-gate-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const services = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot: path.join(root, "state"),
      sandbox: new SwitchableSandboxAdapter(
        new UnsupportedSandboxAdapter("automation-gate-test"),
      ),
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
        expect.objectContaining({ claimed: 1, failed: 0, completed: 1 }),
      );
      expect(services.store.listRuns(thread.id)[0]?.configuration).toEqual(
        expect.objectContaining({
          executionMode: "environment_degraded_read_only",
        }),
      );
      const eventTypes = (await services.store.listEvents(thread.id)).map(
        (event) => event.type,
      );
      expect(eventTypes).toContain("run.environment.negotiated");
      expect(eventTypes).toContain("schedule.completed");
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
