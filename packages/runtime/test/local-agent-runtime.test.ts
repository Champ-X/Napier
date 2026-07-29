import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createLocalAgentRuntime,
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
    vi.spyOn(services.workspaceProcesses, "shutdown").mockRejectedValueOnce(
      new Error("process cleanup failed"),
    );
    const extensionShutdown = vi.spyOn(services.extensions, "shutdown");
    const storeClose = vi.spyOn(services.store, "close");

    await expect(services.shutdown()).rejects.toThrow("process cleanup failed");

    expect(extensionShutdown).toHaveBeenCalledOnce();
    expect(storeClose).toHaveBeenCalledOnce();
    await expect(services.store.listEvents(thread.id)).rejects.toThrow(
      "SQLite ledger is not initialized",
    );
    await expect(services.shutdown()).resolves.toBeUndefined();
  });
});
