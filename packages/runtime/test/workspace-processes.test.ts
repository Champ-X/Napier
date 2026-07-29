import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LocalStore,
  MAX_ACTIVE_WORKSPACE_PROCESSES,
  MAX_ACTIVE_WORKSPACE_PROCESSES_PER_THREAD,
  UnsupportedSandboxAdapter,
  WorkspaceProcessManager,
  createWorkspaceProcessTool,
  type OsSandboxAdapter,
  type SandboxedProcess,
  type SandboxLaunchRequest,
} from "../src/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

interface ControlledProcess {
  request: SandboxLaunchRequest;
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  terminate: ReturnType<typeof vi.fn>;
  settle(code: number | null, signal?: NodeJS.Signals | null): void;
}

function createControlledSandbox() {
  const processes: ControlledProcess[] = [];
  const sandbox: OsSandboxAdapter = {
    id: "controlled-sandbox",
    async launch(request) {
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      let settled = false;
      let resolveExit:
        | ((value: {
            code: number | null;
            signal: NodeJS.Signals | null;
          }) => void)
        | undefined;
      const exit = new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve) => {
        resolveExit = resolve;
      });
      const settle = (
        code: number | null,
        signal: NodeJS.Signals | null = null,
      ): void => {
        if (settled) return;
        settled = true;
        stdout.end();
        stderr.end();
        resolveExit?.({ code, signal });
      };
      const terminate = vi.fn(async () => settle(null, "SIGTERM"));
      processes.push({
        request: structuredClone(request),
        stdin,
        stdout,
        stderr,
        terminate,
        settle,
      });
      return {
        stdin,
        stdout,
        stderr,
        exit,
        terminate,
      } satisfies SandboxedProcess;
    },
  };
  return { sandbox, processes };
}

async function createHarness(options?: {
  dataRoot?: string;
  sandbox?: OsSandboxAdapter;
}) {
  const root = await mkdtemp(path.join(tmpdir(), "napier-process-test-"));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = options?.dataRoot ?? path.join(root, "data");
  await mkdir(workspaceRoot, { recursive: true });
  const store = new LocalStore({ workspaceRoot, dataRoot });
  await store.initialize();
  const controlled = createControlledSandbox();
  const manager = new WorkspaceProcessManager({
    store,
    workspaceRoot,
    sandbox: options?.sandbox ?? controlled.sandbox,
  });
  await manager.initialize();
  const thread = store.listThreads()[0]!;
  const run = store.listRuns(thread.id)[0]!;
  return {
    root,
    workspaceRoot,
    dataRoot,
    store,
    manager,
    thread,
    run,
    controlled,
  };
}

async function startProcess(
  harness: Awaited<ReturnType<typeof createHarness>>,
  command = "setInterval(() => {}, 1000)",
  timeoutMs = 30_000,
) {
  return harness.manager.start({
    threadId: harness.thread.id,
    runId: harness.run.id,
    command: {
      runtime: "node",
      args: ["-e", command],
      timeoutMs,
    },
  });
}

describe("Workspace Process Manager", () => {
  it("starts, streams cursor output, and settles without persisting text", async () => {
    const harness = await createHarness();
    const listEvents = vi.spyOn(harness.store, "listEvents");
    const session = await startProcess(harness);
    expect(session).toEqual(
      expect.objectContaining({
        status: "running",
        outputAvailable: true,
        nextCursor: 0,
        workspaceAccess: "read_only",
        networkAccess: "denied",
      }),
    );
    expect(harness.controlled.processes[0]?.request).toEqual(
      expect.objectContaining({
        command: process.execPath,
        approvedCapabilities: ["process.spawn", "workspace.read"],
      }),
    );

    harness.controlled.processes[0]!.stdout.write("first\n");
    harness.controlled.processes[0]!.stderr.write("warning\n");
    await vi.waitFor(async () => {
      expect(
        (
          await harness.manager.output(harness.thread.id, session.id, {
            afterCursor: 0,
          })
        ).chunks,
      ).toHaveLength(2);
    });
    const first = await harness.manager.output(harness.thread.id, session.id, {
      afterCursor: 0,
    });
    expect(first.chunks.map((chunk) => chunk.text)).toEqual([
      "first\n",
      "warning\n",
    ]);
    const second = await harness.manager.output(harness.thread.id, session.id, {
      afterCursor: first.nextCursor,
    });
    expect(second.chunks).toEqual([]);
    const concurrent = await Promise.all([
      harness.manager.output(harness.thread.id, session.id, {
        afterCursor: 0,
      }),
      harness.manager.output(harness.thread.id, session.id, {
        afterCursor: 0,
      }),
    ]);
    expect(concurrent[0]?.chunks).toEqual(concurrent[1]?.chunks);
    expect(listEvents).not.toHaveBeenCalled();

    harness.controlled.processes[0]!.settle(0);
    const settled = await harness.manager.waitForSettlement(
      harness.thread.id,
      session.id,
    );
    expect(settled).toEqual(
      expect.objectContaining({
        status: "succeeded",
        stdoutChars: 6,
        stderrChars: 8,
        stdoutSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        stderrSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    const events = await harness.store.listEvents(harness.thread.id);
    const processEvents = events.filter((event) =>
      event.type.startsWith("workspace.process."),
    );
    expect(processEvents.map((event) => event.type)).toEqual([
      "workspace.process.started",
      "workspace.process.settled",
    ]);
    expect(JSON.stringify(processEvents)).not.toContain("first");
    expect(JSON.stringify(processEvents)).not.toContain("warning");
    harness.store.close();
  });

  it("settles cancellation, timeout, output cap, and parent abort", async () => {
    const failedHarness = await createHarness();
    const failed = await startProcess(failedHarness);
    failedHarness.controlled.processes[0]!.stderr.write("failed\n");
    failedHarness.controlled.processes[0]!.settle(7);
    expect(
      (
        await failedHarness.manager.waitForSettlement(
          failedHarness.thread.id,
          failed.id,
        )
      ).status,
    ).toBe("failed");
    failedHarness.store.close();

    const cancelledHarness = await createHarness();
    const cancelled = await startProcess(cancelledHarness);
    expect(
      (
        await cancelledHarness.manager.cancel(
          cancelledHarness.thread.id,
          cancelled.id,
        )
      ).status,
    ).toBe("cancelled");
    expect(
      cancelledHarness.controlled.processes[0]!.terminate,
    ).toHaveBeenCalledOnce();
    cancelledHarness.store.close();

    vi.useFakeTimers();
    const timeoutHarness = await createHarness();
    const timed = await startProcess(timeoutHarness, "hang", 1_000);
    await vi.advanceTimersByTimeAsync(1_001);
    expect(
      (
        await timeoutHarness.manager.waitForSettlement(
          timeoutHarness.thread.id,
          timed.id,
        )
      ).status,
    ).toBe("timed_out");
    timeoutHarness.store.close();
    vi.useRealTimers();

    const capHarness = await createHarness();
    const capped = await startProcess(capHarness);
    capHarness.controlled.processes[0]!.stdout.write("x".repeat(40_000));
    expect(
      (
        await capHarness.manager.waitForSettlement(
          capHarness.thread.id,
          capped.id,
        )
      ).status,
    ).toBe("output_capped");
    capHarness.store.close();

    const abortHarness = await createHarness();
    const controller = new AbortController();
    const aborted = await abortHarness.manager.start({
      threadId: abortHarness.thread.id,
      runId: abortHarness.run.id,
      command: { runtime: "node", args: ["-e", "hang"] },
      signal: controller.signal,
    });
    controller.abort();
    expect(
      (
        await abortHarness.manager.waitForSettlement(
          abortHarness.thread.id,
          aborted.id,
        )
      ).status,
    ).toBe("cancelled");
    abortHarness.store.close();
  });

  it("enforces Thread ownership and the active-session concurrency bound", async () => {
    const harness = await createHarness();
    const secondThread = await harness.store.createThread({
      title: "Other",
      agentId: harness.store.listAgents()[0]!.id,
    });
    const starts = await Promise.allSettled(
      Array.from(
        { length: MAX_ACTIVE_WORKSPACE_PROCESSES_PER_THREAD + 1 },
        () => startProcess(harness),
      ),
    );
    expect(
      starts.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(MAX_ACTIVE_WORKSPACE_PROCESSES_PER_THREAD);
    expect(
      starts.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    const sessions = starts.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    await expect(
      harness.manager.start({
        threadId: harness.thread.id,
        runId: "run_1234567890abcdef1234",
        command: { runtime: "node", args: [] },
      }),
    ).rejects.toThrow("does not belong");
    await expect(
      harness.manager.output(secondThread.id, sessions[0]!.id),
    ).rejects.toThrow("not found");
    await expect(
      harness.manager.cancel(secondThread.id, sessions[0]!.id),
    ).rejects.toThrow("not found");
    await Promise.all(
      sessions.map((session) =>
        harness.manager.cancel(harness.thread.id, session.id),
      ),
    );
    harness.store.close();
  });

  it("enforces a global active-session bound across Threads", async () => {
    const harness = await createHarness();
    const agent = harness.store.listAgents()[0]!;
    const owners = [{ thread: harness.thread, run: harness.run }];
    for (const title of ["Second", "Third"]) {
      const thread = await harness.store.createThread({
        title,
        agentId: agent.id,
      });
      const run = await harness.store.createRun({
        threadId: thread.id,
        agentId: agent.id,
      });
      owners.push({ thread, run });
    }
    const starts = await Promise.allSettled(
      Array.from({ length: MAX_ACTIVE_WORKSPACE_PROCESSES + 1 }, (_, index) => {
        const owner = owners[index % owners.length]!;
        return harness.manager.start({
          threadId: owner.thread.id,
          runId: owner.run.id,
          command: { runtime: "node", args: ["-e", "hang"] },
        });
      }),
    );
    const sessions = starts.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    expect(sessions).toHaveLength(MAX_ACTIVE_WORKSPACE_PROCESSES);
    expect(
      starts.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    await Promise.all(
      sessions.map((session) =>
        harness.manager.cancel(session.threadId, session.id),
      ),
    );
    harness.store.close();
  });

  it("interrupts active evidence on restart and exposes no stale output", async () => {
    const harness = await createHarness();
    const session = await startProcess(harness);
    harness.controlled.processes[0]!.stdout.write("ephemeral\n");
    await vi.waitFor(async () => {
      expect(
        (await harness.manager.output(harness.thread.id, session.id)).chunks,
      ).toHaveLength(1);
    });
    harness.store.close();

    const restartedStore = new LocalStore({
      workspaceRoot: harness.workspaceRoot,
      dataRoot: harness.dataRoot,
    });
    await restartedStore.initialize();
    const restarted = new WorkspaceProcessManager({
      store: restartedStore,
      workspaceRoot: harness.workspaceRoot,
      sandbox: createControlledSandbox().sandbox,
    });
    await restarted.initialize();
    const [reconciled] = await restarted.list(harness.thread.id);
    expect(reconciled).toEqual(
      expect.objectContaining({
        id: session.id,
        status: "interrupted",
        outputAvailable: false,
        interruptionReason: expect.stringContaining("outcome is unknown"),
      }),
    );
    const output = await restarted.output(harness.thread.id, session.id);
    expect(output).toEqual(
      expect.objectContaining({
        status: "interrupted",
        outputAvailable: false,
        chunks: [],
      }),
    );
    expect(
      JSON.stringify(await restartedStore.listEvents(harness.thread.id)),
    ).not.toContain("ephemeral");
    restartedStore.close();
    harness.controlled.processes[0]!.settle(null, "SIGKILL");
  });

  it("gracefully settles every active session during shutdown", async () => {
    const harness = await createHarness();
    const sessions = await Promise.all([
      startProcess(harness),
      startProcess(harness),
    ]);
    await harness.manager.shutdown();
    expect(
      await Promise.all(
        sessions.map(
          async (session) =>
            (await harness.manager.list(harness.thread.id)).find(
              (candidate) => candidate.id === session.id,
            )?.status,
        ),
      ),
    ).toEqual(["interrupted", "interrupted"]);
    expect(
      harness.controlled.processes.map(
        (process) => process.terminate.mock.calls.length,
      ),
    ).toEqual([1, 1]);
    harness.store.close();
  });

  it("terminates a process whose launch races with Runtime shutdown", async () => {
    const controlled = createControlledSandbox();
    let releaseLaunch: (() => void) | undefined;
    const launchGate = new Promise<void>((resolve) => {
      releaseLaunch = resolve;
    });
    const delayedSandbox: OsSandboxAdapter = {
      id: "delayed-sandbox",
      async launch(request) {
        await launchGate;
        return controlled.sandbox.launch(request);
      },
    };
    const harness = await createHarness({ sandbox: delayedSandbox });
    const starting = startProcess(harness);
    await vi.waitFor(() => expect(releaseLaunch).toBeDefined());
    await harness.manager.shutdown();
    releaseLaunch!();
    await expect(starting).rejects.toThrow("shutting down");
    expect(controlled.processes[0]?.terminate).toHaveBeenCalledOnce();
    expect(await harness.manager.list(harness.thread.id)).toEqual([]);
    harness.store.close();
  });

  it("does not persist or expose settlement error text", async () => {
    const harness = await createHarness();
    const session = await startProcess(harness);
    vi.spyOn(harness.store, "appendEvent").mockRejectedValue(
      new Error("TOP_SECRET_DATABASE_DIAGNOSTIC"),
    );
    harness.controlled.processes[0]!.settle(0);
    const interrupted = await harness.manager.waitForSettlement(
      harness.thread.id,
      session.id,
    );
    expect(interrupted.status).toBe("interrupted");
    expect(interrupted.interruptionReason).toContain("outcome is unknown");
    expect(JSON.stringify(interrupted)).not.toContain("TOP_SECRET");
    harness.store.close();
  });

  it("fails closed when no supported sandbox backend is available", async () => {
    const harness = await createHarness({
      sandbox: new UnsupportedSandboxAdapter("test-platform"),
    });
    await expect(startProcess(harness)).rejects.toThrow(
      "No OS sandbox adapter is available",
    );
    expect(await harness.manager.list(harness.thread.id)).toEqual([]);
    harness.store.close();
  });

  it("exposes start, poll, and cancel through one Agent tool", async () => {
    const harness = await createHarness();
    const tool = createWorkspaceProcessTool(harness.manager, {
      threadId: harness.thread.id,
      runId: harness.run.id,
    });
    const started = await tool.execute("call-start", {
      action: "start",
      runtime: "node",
      args: ["-e", "setInterval(() => {}, 1000)"],
    });
    const processId = started.details.processId;
    harness.controlled.processes[0]!.stdout.write("agent-visible\n");
    await vi.waitFor(async () => {
      const polled = await tool.execute("call-poll", {
        action: "poll",
        processId,
        afterCursor: 0,
      });
      expect(polled.content[0]?.text).toContain("agent-visible");
    });
    const cancelled = await tool.execute("call-cancel", {
      action: "cancel",
      processId,
    });
    expect(cancelled.details.status).toBe("cancelled");
    harness.store.close();
  });
});
