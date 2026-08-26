import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyKernelPluginState,
  createLocalAgentRuntime,
  LocalStore,
  previewKernelPluginState,
  UnsupportedSandboxAdapter,
} from "../src/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("local Agent Runtime bootstrap", () => {
  it.each(["base", "web", "cli"] as const)(
    "exposes the resolved %s Kernel profile",
    async (kernelProfile) => {
      const root = await mkdtemp(path.join(tmpdir(), "napier-kernel-profile-"));
      temporaryRoots.push(root);
      const workspaceRoot = path.join(root, "workspace");
      await mkdir(workspaceRoot);
      const services = await createLocalAgentRuntime({
        workspaceRoot,
        dataRoot: path.join(root, "state"),
        kernelProfile,
        sandbox: new UnsupportedSandboxAdapter(`kernel-${kernelProfile}`),
      });
      try {
        expect(services.kernel.inspect().profile).toEqual(
          expect.objectContaining({
            id: kernelProfile,
            lineage:
              kernelProfile === "base" ? ["base"] : ["base", kernelProfile],
          }),
        );
      } finally {
        await services.shutdown();
      }
    },
  );

  it("runs one Agent through shared services and shuts down idempotently", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-local-runtime-"));
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const dataRoot = path.join(root, "state");
    await mkdir(workspaceRoot);
    const services = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot,
      env: { TEST_PROVIDER_KEY: "PRIVATE_BOOTSTRAP_SECRET" },
      sandbox: new UnsupportedSandboxAdapter("bootstrap-test"),
    });
    await services.store.createCredentialReference({
      providerId: "test-provider",
      label: "Test provider",
      source: { type: "environment", variable: "TEST_PROVIDER_KEY" },
    });
    await expect(services.credentials.read("test-provider")).resolves.toEqual({
      type: "api_key",
      key: "PRIVATE_BOOTSTRAP_SECRET",
    });
    const agent = services.store.listAgents()[0]!;
    const thread = await services.store.createThread({
      title: "Shared bootstrap",
      agentId: agent.id,
    });

    const run = await services.runtime.runPrompt({
      threadId: thread.id,
      text: "Run the deterministic local bootstrap path.",
      model: { provider: "napier", id: "demo" },
    });

    expect(run.status).toBe("completed");
    expect(
      (await services.store.listEvents(thread.id)).map((event) => event.type),
    ).toEqual(expect.arrayContaining(["run.started", "run.completed"]));
    expect(
      JSON.stringify(await services.store.getDetail(thread.id)),
    ).not.toContain("PRIVATE_BOOTSTRAP_SECRET");
    await services.shutdown();
    await services.shutdown();
    await expect(services.store.listEvents(thread.id)).rejects.toThrow(
      "SQLite ledger is not initialized",
    );
  });

  it("reconciles persisted optional plugin state across Runtime restarts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-plugin-state-"));
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const dataRoot = path.join(root, "state");
    await mkdir(workspaceRoot);
    const disable = await previewKernelPluginState(
      dataRoot,
      "plugin.browser",
      false,
    );
    await applyKernelPluginState({
      dataRoot,
      pluginId: "plugin.browser",
      enabled: false,
      expectedPreviewSha256: disable.contentSha256,
    });

    const first = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot,
      sandbox: new UnsupportedSandboxAdapter("plugin-state-first"),
    });
    expect(first.kernel.plugins.inspect()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "plugin.artifact",
          status: "enabled",
        }),
        expect.objectContaining({
          id: "plugin.browser",
          status: "disabled",
        }),
        expect.objectContaining({
          id: "plugin.search",
          status: "enabled",
        }),
      ]),
    );
    await first.shutdown();

    const second = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot,
      sandbox: new UnsupportedSandboxAdapter("plugin-state-second"),
    });
    try {
      expect(
        second.kernel.plugins
          .inspect()
          .find((plugin) => plugin.id === "plugin.browser")?.status,
      ).toBe("disabled");
    } finally {
      await second.shutdown();
    }
  });

  it("fails startup closed when persisted plugin state is invalid", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-plugin-invalid-"));
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const dataRoot = path.join(root, "state");
    await Promise.all([mkdir(workspaceRoot), mkdir(dataRoot)]);
    await writeFile(
      path.join(dataRoot, "kernel-plugins.json"),
      '{"kind":"invalid"}\n',
      { mode: 0o600 },
    );

    await expect(
      createLocalAgentRuntime({
        workspaceRoot,
        dataRoot,
        sandbox: new UnsupportedSandboxAdapter("plugin-state-invalid"),
      }),
    ).rejects.toThrow("desired state");
  });

  it("attempts every shutdown step before reporting a cleanup failure", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-local-shutdown-"));
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const services = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot: path.join(root, "state"),
      sandbox: new UnsupportedSandboxAdapter("bootstrap-shutdown-test"),
    });
    const thread = await services.store.createThread({
      title: "Shutdown cleanup",
      agentId: services.store.listAgents()[0]!.id,
    });
    await services.store.appendCompatibilityEvent({
      threadId: thread.id,
      runId: "runctl_shutdown",
      type: "shutdown.pending",
      category: "system",
      payload: {},
      compatibility: {
        boundary: "test_fixture",
        reason: "Synthetic shutdown fixture",
      },
    });
    const statePath = path.join(root, "state", "workspace.json");
    expect(
      projectedThreadEventCount(await readFile(statePath, "utf8"), thread.id),
    ).toBe(0);
    vi.spyOn(services.workspaceProcesses, "shutdown").mockRejectedValueOnce(
      new Error("process cleanup failed"),
    );
    const extensionShutdown = vi.spyOn(services.extensions, "shutdown");
    const storeClose = vi.spyOn(services.store, "close");

    await expect(services.shutdown()).rejects.toThrow("process cleanup failed");

    expect(extensionShutdown).toHaveBeenCalledOnce();
    expect(storeClose).toHaveBeenCalledOnce();
    expect(
      projectedThreadEventCount(await readFile(statePath, "utf8"), thread.id),
    ).toBe(1);
    await expect(services.store.listEvents(thread.id)).rejects.toThrow(
      "SQLite ledger is not initialized",
    );
    await expect(services.shutdown()).resolves.toBeUndefined();
  });

  it("interrupts an unexpired orphan Run lease before exposing the workspace", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-local-restart-"));
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const dataRoot = path.join(root, "state");
    await mkdir(workspaceRoot);
    const abandoned = new LocalStore({ workspaceRoot, dataRoot });
    await abandoned.initialize();
    const agent = abandoned.listAgents()[0]!;
    const thread = await abandoned.createThread({
      title: "Orphan Run restart",
      agentId: agent.id,
    });
    const leased = await abandoned.createLeasedRun(
      { threadId: thread.id, agentId: agent.id },
      { ownerId: "worker_abandoned", ttlMs: 60_000 },
    );
    expect(leased.run.lease?.expiresAt).toBeDefined();
    abandoned.close();

    const services = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot,
      sandbox: new UnsupportedSandboxAdapter("restart-test"),
    });
    try {
      const recovered = services.store
        .listRuns(thread.id)
        .find((run) => run.id === leased.run.id);
      expect(recovered).toEqual(
        expect.objectContaining({
          status: "interrupted",
          interruptionReason: expect.stringContaining("runtime process exited"),
        }),
      );
      expect(recovered).not.toHaveProperty("lease");
      const recoveredThread = services.store.getThread(thread.id);
      expect(recoveredThread).toEqual(
        expect.objectContaining({ status: "waiting" }),
      );
      expect(recoveredThread).not.toHaveProperty("currentRunId");
      expect(
        (await services.store.listEvents(thread.id)).filter(
          (event) =>
            event.runId === leased.run.id && event.type === "run.interrupted",
        ),
      ).toHaveLength(1);
      await expect(
        services.store.trashThread(thread.id),
      ).resolves.toBeDefined();
      expect(
        services.store
          .listVisibleThreads()
          .some((candidate) => candidate.id === thread.id),
      ).toBe(false);
      expect((await services.store.listEvents(thread.id)).at(-1)?.type).toBe(
        "thread.trashed",
      );
    } finally {
      await services.shutdown();
    }
  });
});

function projectedThreadEventCount(
  stateJson: string,
  threadId: string,
): number | undefined {
  const state = JSON.parse(stateJson) as {
    threads: Array<{ id: string; eventCount: number }>;
  };
  return state.threads.find((thread) => thread.id === threadId)?.eventCount;
}
