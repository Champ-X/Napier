import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { createLocalAgentRuntime } from "../../../packages/runtime/src/local-agent-runtime.js";
import type { ExecutionResourceLease } from "../../../packages/runtime/src/execution-resource-admission.js";
import { WorkspaceResourceAdmission } from "../src/workspace-resource-admission.js";

const workspaceId = `workspace_${"a".repeat(64)}`;
const released = {
  status: "released", scope: "sandbox_execution", reason: "fixture_created_no_process",
} as const;

describe("workspace resource shutdown with a real event store", () => {
  it("shares cleanup failure and preserves the SQLite store after an unknown launch", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-resource-shutdown-"));
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const admission = await WorkspaceResourceAdmission.open(path.join(root, "host"));
    const bound = admission.forWorkspace(workspaceId);
    let lease: ExecutionResourceLease | undefined;
    const local = await createLocalAgentRuntime({
      workspaceRoot, dataRoot: path.join(root, "state"),
      resourceAdmission: {
        ...bound,
        reserve(request) { lease = bound.reserve(request); return lease; },
      },
      // This fixture creates no process. A plain post-dispatch exception must
      // nevertheless fail closed because the coordinator has no cleanup proof.
      sandbox: {
        id: "unknown-launch-fixture",
        async launch() { throw new Error("fixture dispatch observation lost"); },
      },
    });
    const thread = await local.store.createThread({
      title: "Retained store", agentId: local.store.listAgents()[0]!.id,
    });
    const closeStore = vi.spyOn(local.store, "shutdown");
    try {
      await expect(local.sandbox.launch({
        command: process.execPath, args: [], cwd: workspaceRoot, env: {},
        workspaceRoot, approvedCapabilities: ["process.spawn"],
      })).rejects.toThrow("fixture dispatch observation lost");
      expect(admission.hasPending(workspaceId)).toBe(true);
      expect(admission.snapshot()[0]).toMatchObject({ occupied: 1, quarantined: 1 });

      const first = local.shutdown();
      const second = local.shutdown();
      expect(second).toBe(first);
      await expect(first).rejects.toMatchObject({ code: "cleanup" });
      await expect(second).rejects.toMatchObject({ code: "cleanup" });
      expect(closeStore).not.toHaveBeenCalled();
      // listAgents is cached; listEvents executes an actual SQLite read.
      await expect(local.store.listEvents(thread.id)).resolves.toEqual([]);
      expect(admission.hasPending(workspaceId)).toBe(true);
    } finally {
      lease?.settle(released);
      await local.shutdown().catch(() => undefined);
      await local.store.shutdown();
      admission.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("waits for affirmative lease settlement before closing the SQLite store", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-resource-drain-"));
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const admission = await WorkspaceResourceAdmission.open(path.join(root, "host"));
    const bound = admission.forWorkspace(workspaceId);
    let enteredDrain!: () => void;
    const draining = new Promise<void>((resolve) => { enteredDrain = resolve; });
    const local = await createLocalAgentRuntime({
      workspaceRoot, dataRoot: path.join(root, "state"),
      resourceAdmission: {
        ...bound,
        drain() { enteredDrain(); return bound.drain!(); },
      },
      sandbox: {
        id: "no-launch-fixture",
        async launch() { throw new Error("Unexpected fixture launch"); },
      },
    });
    const thread = await local.store.createThread({
      title: "Pending drain", agentId: local.store.listAgents()[0]!.id,
    });
    const lease = bound.reserve({ kind: "sandbox_execution", backend: "fixture" });
    lease.dispatched();
    const closeStore = vi.spyOn(local.store, "shutdown");
    const shutdown = local.shutdown();
    try {
      await draining;
      expect(closeStore).not.toHaveBeenCalled();
      await expect(local.store.listEvents(thread.id)).resolves.toEqual([]);
      expect(admission.hasPending(workspaceId)).toBe(true);
      lease.settle(released);
      await shutdown;
      expect(closeStore).toHaveBeenCalledOnce();
      expect(admission.hasPending(workspaceId)).toBe(false);
      await expect(local.store.listEvents(thread.id)).rejects.toThrow("SQLite ledger is not initialized");
    } finally {
      lease.settle(released);
      await shutdown;
      admission.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
