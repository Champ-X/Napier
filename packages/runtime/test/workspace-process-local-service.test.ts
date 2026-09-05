import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createWorkspaceProcessTool,
  LocalStore,
  type OsSandboxAdapter,
  type SandboxedProcess,
  type SandboxLaunchRequest,
  WorkspaceProcessManager,
  workspaceProcessToolCallArgumentsLedgerProjection,
} from "../src/index.js";
import { createActiveTestRun } from "./active-run-test-fixture.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Workspace Process local service", () => {
  it("projects the ready URL, redacts health data, closes it, and replays the closed session", async () => {
    const harness = await createHarness();
    const tool = createWorkspaceProcessTool(harness.manager, {
      threadId: harness.threadId,
      runId: harness.runId,
    });
    const input = {
      action: "start" as const,
      runtime: "node" as const,
      args: ["-e", "setInterval(() => {}, 1000)"],
      service: {
        containerPort: 31_879,
        healthPath: "/PRIVATE_AGENT_READY_PATH",
      },
    };

    const started = await tool.execute("call-start-service", input);
    expect(started.details).toEqual(
      expect.objectContaining({
        action: "start",
        status: "running",
        networkAccess: "outbound_denied_loopback_service",
        localServiceStatus: "ready",
        localServiceUrl: "http://127.0.0.1:45678/",
        localServiceContainerPort: 31_879,
        localServiceHostPort: 45_678,
        localServiceIdentitySha256: "8".repeat(64),
      }),
    );
    expect(started.content[0]?.text).toContain(
      "Local service: ready / http://127.0.0.1:45678/",
    );
    expect(harness.controlled.requests).toEqual([
      expect.objectContaining({
        approvedCapabilities: [
          "process.spawn",
          "workspace.read",
          "network.listen",
        ],
        parentDeathGuard: true,
        localService: {
          protocol: "http",
          containerPort: 31_879,
          healthPath: "/PRIVATE_AGENT_READY_PATH",
        },
      }),
    ]);
    const [running] = await harness.manager.list(harness.threadId);
    expect(running).toEqual(
      expect.objectContaining({
        schemaVersion: 8,
        status: "running",
        workspaceAccess: "read_only",
        networkAccess: "outbound_denied_loopback_service",
        localService: expect.objectContaining({ status: "ready" }),
      }),
    );

    const ledger = workspaceProcessToolCallArgumentsLedgerProjection(input);
    expect(ledger).toEqual(
      expect.objectContaining({
        localService: true,
        serviceContainerPort: 31_879,
        serviceHealthPathSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(JSON.stringify(ledger)).not.toContain("PRIVATE_AGENT_READY_PATH");
    expect(
      JSON.stringify(await harness.store.listEvents(harness.threadId)),
    ).not.toContain("PRIVATE_AGENT_READY_PATH");

    const cancelled = await tool.execute("call-cancel-service", {
      action: "cancel",
      processId: started.details.processId!,
    });
    expect(cancelled.details).toEqual(
      expect.objectContaining({
        status: "cancelled",
        localServiceStatus: "closed",
      }),
    );
    expect(cancelled.details).not.toHaveProperty("localServiceUrl");
    expect(cancelled.content[0]?.text).toContain("Local service: closed");
    expect(cancelled.content[0]?.text).not.toContain("http://127.0.0.1:45678/");
    expect(harness.controlled.terminate).toHaveBeenCalledOnce();
    expect(cancelled.details).not.toHaveProperty("workspaceRollbackAvailable");
    harness.store.close();

    const restartedStore = new LocalStore({
      workspaceRoot: harness.workspaceRoot,
      dataRoot: harness.dataRoot,
    });
    await restartedStore.initialize();
    const restarted = new WorkspaceProcessManager({
      store: restartedStore,
      workspaceRoot: harness.workspaceRoot,
      dataRoot: harness.dataRoot,
      sandbox: controlledServiceSandbox().sandbox,
    });
    await restarted.initialize();
    expect(await restarted.list(harness.threadId)).toEqual([
      expect.objectContaining({
        id: started.details.processId,
        schemaVersion: 8,
        status: "cancelled",
        localService: expect.objectContaining({ status: "closed" }),
      }),
    ]);
    restartedStore.close();
  });
});

async function createHarness() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-process-service-"));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  await mkdir(workspaceRoot);
  const store = new LocalStore({ workspaceRoot, dataRoot });
  await store.initialize();
  const controlled = controlledServiceSandbox();
  const manager = new WorkspaceProcessManager({
    store,
    workspaceRoot,
    dataRoot,
    sandbox: controlled.sandbox,
  });
  await manager.initialize();
  const { thread, run } = await createActiveTestRun(
    store,
    "Workspace local service fixture",
  );
  return {
    workspaceRoot,
    dataRoot,
    store,
    manager,
    controlled,
    threadId: thread.id,
    runId: run.id,
  };
}

function controlledServiceSandbox(): {
  sandbox: OsSandboxAdapter;
  requests: SandboxLaunchRequest[];
  terminate: ReturnType<typeof vi.fn>;
} {
  const requests: SandboxLaunchRequest[] = [];
  let settle:
    | ((value: { code: number | null; signal: NodeJS.Signals | null }) => void)
    | undefined;
  const exit = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve) => {
    settle = resolve;
  });
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const terminate = vi.fn(async () => {
    stdout.end();
    stderr.end();
    settle?.({ code: null, signal: "SIGTERM" });
  });
  const sandbox: OsSandboxAdapter = {
    id: "controlled-service",
    async launch(request): Promise<SandboxedProcess> {
      requests.push(structuredClone(request));
      return {
        stdin: new PassThrough(),
        stdout,
        stderr,
        exit,
        localService: {
          protocol: "http",
          containerPort: request.localService!.containerPort,
          host: "127.0.0.1",
          hostPort: 45_678,
          url: "http://127.0.0.1:45678/",
          healthPathSha256: "7".repeat(64),
          identitySha256: "8".repeat(64),
          readyAt: "2026-08-10T00:00:00.000Z",
        },
        terminate,
      };
    },
  };
  return { sandbox, requests, terminate };
}
