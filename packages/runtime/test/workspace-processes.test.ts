import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  rm,
  truncate,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LocalStore,
  MAX_ACTIVE_WORKSPACE_PROCESSES,
  MAX_ACTIVE_WORKSPACE_PROCESSES_PER_THREAD,
  MAX_WORKSPACE_SNAPSHOT_BYTES,
  UnsupportedSandboxAdapter,
  WorkspaceProcessManager,
  createWorkspaceProcessInputReceipt,
  createWorkspaceProcessSession,
  createWorkspaceProcessTool,
  parseWorkspaceProcessInputReceipt,
  projectWorkspaceProcessSessions,
  type OsSandboxAdapter,
  type SandboxedProcess,
  type SandboxLaunchRequest,
  workspaceProcessToolCallArgumentsLedgerProjection,
  workspaceProcessSessionPayload,
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
  interactive = false,
) {
  return harness.manager.start({
    threadId: harness.thread.id,
    runId: harness.run.id,
    command: {
      runtime: "node",
      args: ["-e", command],
      timeoutMs,
    },
    ...(interactive ? { interactive: true } : {}),
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
        stdinMode: "closed",
        stdinOpen: false,
        stdinWriteCount: 0,
        stdinBytes: 0,
      }),
    );
    expect(harness.controlled.processes[0]?.stdin.writableEnded).toBe(true);
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
        workspaceDeltaStatus: "unchanged",
        workspaceChangedFileCount: 0,
        workspaceDeltaAvailable: true,
      }),
    );
    expect(await harness.manager.delta(harness.thread.id, session.id)).toEqual(
      expect.objectContaining({
        status: "unchanged",
        available: true,
        entriesTruncated: false,
        entries: [],
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

  it("serializes bounded interactive input and persists only hash receipts", async () => {
    const harness = await createHarness();
    const session = await startProcess(
      harness,
      "process.stdin.resume()",
      30_000,
      true,
    );
    expect(session).toEqual(
      expect.objectContaining({
        schemaVersion: 3,
        stdinMode: "interactive",
        stdinOpen: true,
        stdinWriteCount: 0,
        stdinBytes: 0,
        stdinSha256: createHash("sha256").update("").digest("hex"),
      }),
    );
    const received: string[] = [];
    harness.controlled.processes[0]!.stdin.setEncoding("utf8");
    harness.controlled.processes[0]!.stdin.on("data", (chunk: string) => {
      received.push(chunk);
    });
    const first = harness.manager.writeInput({
      threadId: harness.thread.id,
      runId: harness.run.id,
      processId: session.id,
      text: "FIRST_SECRET_INPUT",
      appendNewline: true,
      initiatedBy: "agent",
    });
    const second = harness.manager.writeInput({
      threadId: harness.thread.id,
      runId: harness.run.id,
      processId: session.id,
      text: "SECOND_SECRET_INPUT",
      close: true,
      initiatedBy: "agent",
    });
    const receipts = await Promise.all([first, second]);
    expect(received.join("")).toBe("FIRST_SECRET_INPUT\nSECOND_SECRET_INPUT");
    expect(receipts).toEqual([
      expect.objectContaining({
        sequence: 1,
        initiatedBy: "agent",
        stdinClosed: false,
      }),
      expect.objectContaining({
        sequence: 2,
        initiatedBy: "agent",
        stdinClosed: true,
      }),
    ]);
    const [current] = await harness.manager.list(harness.thread.id);
    expect(current).toEqual(
      expect.objectContaining({
        id: session.id,
        stdinOpen: false,
        stdinWriteCount: 2,
        stdinBytes: Buffer.byteLength(
          "FIRST_SECRET_INPUT\nSECOND_SECRET_INPUT",
        ),
        stdinSha256: createHash("sha256")
          .update("FIRST_SECRET_INPUT\nSECOND_SECRET_INPUT")
          .digest("hex"),
      }),
    );
    await expect(
      harness.manager.writeInput({
        threadId: harness.thread.id,
        processId: session.id,
        text: "late",
        initiatedBy: "operator",
      }),
    ).rejects.toThrow("not open");
    const events = await harness.store.listEvents(harness.thread.id);
    expect(
      events
        .filter((event) => event.type === "workspace.process.input")
        .map((event) => event.payload["sequence"]),
    ).toEqual([1, 2]);
    expect(JSON.stringify(events)).not.toContain("FIRST_SECRET_INPUT");
    expect(JSON.stringify(events)).not.toContain("SECOND_SECRET_INPUT");
    harness.controlled.processes[0]!.settle(0);
    expect(
      (await harness.manager.waitForSettlement(harness.thread.id, session.id))
        .stdinOpen,
    ).toBe(false);
    harness.store.close();
  });

  it("binds close-only input to the empty digest and rejects impossible input evidence", async () => {
    const harness = await createHarness();
    const session = await startProcess(
      harness,
      "process.stdin.resume()",
      30_000,
      true,
    );
    const emptySha256 = createHash("sha256").update("").digest("hex");
    const receipt = await harness.manager.writeInput({
      threadId: harness.thread.id,
      processId: session.id,
      text: "",
      close: true,
      initiatedBy: "operator",
    });
    expect(receipt).toEqual(
      expect.objectContaining({
        sequence: 1,
        inputBytes: 0,
        inputSha256: emptySha256,
        totalInputBytes: 0,
        cumulativeInputSha256: emptySha256,
        stdinClosed: true,
      }),
    );
    const {
      kind: _receiptKind,
      schemaVersion: _receiptSchemaVersion,
      contentSha256: _receiptContentSha256,
      ...receiptInput
    } = receipt;
    const inconsistentReceipt = createWorkspaceProcessInputReceipt({
      ...receiptInput,
      inputSha256: "a".repeat(64),
    });
    expect(
      parseWorkspaceProcessInputReceipt(inconsistentReceipt),
    ).toBeUndefined();

    const {
      kind: _kind,
      schemaVersion: _schemaVersion,
      outputAvailable: _outputAvailable,
      workspaceDeltaAvailable: _workspaceDeltaAvailable,
      contentSha256: _contentSha256,
      ...sessionInput
    } = session;
    const impossibleSession = createWorkspaceProcessSession({
      ...sessionInput,
      schemaVersion: 3,
      stdinWriteCount: 0,
      stdinBytes: 1,
      stdinSha256: "b".repeat(64),
    });
    const [startedEvent] = (
      await harness.store.listEvents(harness.thread.id)
    ).filter((event) => event.type === "workspace.process.started");
    expect(
      projectWorkspaceProcessSessions([
        {
          ...startedEvent!,
          payload: workspaceProcessSessionPayload(impossibleSession),
        },
      ]),
    ).toEqual([]);
    const prematurelyClosedSession = createWorkspaceProcessSession({
      ...sessionInput,
      schemaVersion: 3,
      stdinOpen: false,
    });
    expect(
      projectWorkspaceProcessSessions([
        {
          ...startedEvent!,
          payload: workspaceProcessSessionPayload(prematurelyClosedSession),
        },
      ]),
    ).toEqual([]);
    harness.controlled.processes[0]!.settle(0);
    await harness.manager.waitForSettlement(harness.thread.id, session.id);
    harness.store.close();
  });

  it("enforces interactive input Run ownership and total bounds", async () => {
    const harness = await createHarness();
    const session = await startProcess(
      harness,
      "process.stdin.resume()",
      30_000,
      true,
    );
    harness.controlled.processes[0]!.stdin.resume();
    const otherRun = await harness.store.createRun({
      threadId: harness.thread.id,
      agentId: harness.store.listAgents()[0]!.id,
    });
    await expect(
      harness.manager.writeInput({
        threadId: harness.thread.id,
        runId: otherRun.id,
        processId: session.id,
        text: "foreign",
        initiatedBy: "agent",
      }),
    ).rejects.toThrow("does not belong");
    await expect(
      harness.manager.writeInput({
        threadId: harness.thread.id,
        processId: session.id,
        text: "x".repeat(32 * 1024 + 1),
        initiatedBy: "operator",
      }),
    ).rejects.toThrow("message limit");
    const chunk = "x".repeat(32 * 1024);
    for (let index = 0; index < 8; index += 1) {
      await harness.manager.writeInput({
        threadId: harness.thread.id,
        processId: session.id,
        text: chunk,
        initiatedBy: "operator",
      });
    }
    await expect(
      harness.manager.writeInput({
        threadId: harness.thread.id,
        processId: session.id,
        text: "overflow",
        initiatedBy: "operator",
      }),
    ).rejects.toThrow("total-byte limit");
    await harness.manager.cancel(harness.thread.id, session.id);
    harness.store.close();
  });

  it("continues projecting durable schema v1 sessions after upgrade", async () => {
    const harness = await createHarness();
    const session = await startProcess(harness);
    const [startedEvent] = (
      await harness.store.listEvents(harness.thread.id)
    ).filter((event) => event.type === "workspace.process.started");
    expect(startedEvent).toBeDefined();
    const {
      kind: _kind,
      schemaVersion: _schemaVersion,
      outputAvailable: _outputAvailable,
      workspaceDeltaAvailable: _workspaceDeltaAvailable,
      workspaceBeforeSha256: _workspaceBeforeSha256,
      workspaceBeforeTruncated: _workspaceBeforeTruncated,
      stdinMode: _stdinMode,
      stdinOpen: _stdinOpen,
      stdinWriteCount: _stdinWriteCount,
      stdinBytes: _stdinBytes,
      stdinSha256: _stdinSha256,
      contentSha256: _contentSha256,
      ...legacyInput
    } = session;
    const legacy = createWorkspaceProcessSession({
      ...legacyInput,
      schemaVersion: 1,
    });
    await harness.store.appendEvent({
      threadId: harness.thread.id,
      runId: harness.run.id,
      type: startedEvent!.type,
      category: startedEvent!.category,
      visibility: startedEvent!.visibility,
      payload: workspaceProcessSessionPayload(legacy),
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
    expect(await restarted.list(harness.thread.id)).toEqual([
      expect.objectContaining({
        id: session.id,
        schemaVersion: 1,
        status: "interrupted",
        outputAvailable: false,
      }),
    ]);
    expect(
      (await restarted.list(harness.thread.id))[0]?.workspaceBeforeSha256,
    ).toBeUndefined();
    restartedStore.close();
    harness.controlled.processes[0]!.settle(null, "SIGKILL");
  });

  it("continues projecting durable schema v2 sessions after upgrade", async () => {
    const harness = await createHarness();
    const session = await startProcess(harness);
    const [startedEvent] = (
      await harness.store.listEvents(harness.thread.id)
    ).filter((event) => event.type === "workspace.process.started");
    const {
      kind: _kind,
      schemaVersion: _schemaVersion,
      outputAvailable: _outputAvailable,
      workspaceDeltaAvailable: _workspaceDeltaAvailable,
      stdinMode: _stdinMode,
      stdinOpen: _stdinOpen,
      stdinWriteCount: _stdinWriteCount,
      stdinBytes: _stdinBytes,
      stdinSha256: _stdinSha256,
      contentSha256: _contentSha256,
      ...legacyInput
    } = session;
    const legacy = createWorkspaceProcessSession({
      ...legacyInput,
      schemaVersion: 2,
    });
    await harness.store.appendEvent({
      threadId: harness.thread.id,
      runId: harness.run.id,
      type: startedEvent!.type,
      category: startedEvent!.category,
      visibility: startedEvent!.visibility,
      payload: workspaceProcessSessionPayload(legacy),
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
    const restored = await restarted.list(harness.thread.id);
    expect(restored).toEqual([
      expect.objectContaining({
        id: session.id,
        schemaVersion: 2,
        status: "interrupted",
        workspaceBeforeSha256: session.workspaceBeforeSha256,
      }),
    ]);
    expect(restored[0]).not.toHaveProperty("stdinMode");
    restartedStore.close();
    harness.controlled.processes[0]!.settle(null, "SIGKILL");
  });

  it("reports external workspace drift locally without persisting paths", async () => {
    const harness = await createHarness();
    const modified = path.join(harness.workspaceRoot, "modified.txt");
    const removed = path.join(harness.workspaceRoot, "removed.txt");
    const added = path.join(harness.workspaceRoot, "added.txt");
    await Promise.all([
      writeFile(modified, "before"),
      writeFile(removed, "remove"),
    ]);
    const session = await startProcess(harness);
    await Promise.all([
      writeFile(modified, "after"),
      writeFile(added, "add"),
      unlink(removed),
    ]);
    harness.controlled.processes[0]!.settle(0);
    const settled = await harness.manager.waitForSettlement(
      harness.thread.id,
      session.id,
    );
    expect(settled).toEqual(
      expect.objectContaining({
        workspaceDeltaStatus: "changed",
        workspaceChangedFileCount: 3,
        workspaceChangedPathSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        workspaceDeltaAvailable: true,
      }),
    );
    const delta = await harness.manager.delta(harness.thread.id, session.id);
    expect(delta.entriesTruncated).toBe(false);
    expect(delta.entries.map((entry) => [entry.kind, entry.path])).toEqual([
      ["added", "added.txt"],
      ["modified", "modified.txt"],
      ["removed", "removed.txt"],
    ]);
    const events = await harness.store.listEvents(harness.thread.id);
    expect(JSON.stringify(events)).not.toContain("modified.txt");
    expect(JSON.stringify(events)).not.toContain("removed.txt");
    expect(JSON.stringify(events)).not.toContain("added.txt");
    harness.store.close();
  });

  it("keeps the process outcome and fails the delta closed when the post-snapshot is unavailable", async () => {
    const harness = await createHarness();
    const session = await startProcess(harness);
    await rm(harness.workspaceRoot, { recursive: true, force: true });
    harness.controlled.processes[0]!.settle(0);

    const settled = await harness.manager.waitForSettlement(
      harness.thread.id,
      session.id,
    );
    expect(settled).toEqual(
      expect.objectContaining({
        status: "succeeded",
        workspaceAfterTruncated: true,
        workspaceDeltaStatus: "indeterminate",
        workspaceChangedFileCount: 0,
        workspaceDeltaAvailable: true,
      }),
    );
    expect(await harness.manager.delta(harness.thread.id, session.id)).toEqual(
      expect.objectContaining({
        status: "indeterminate",
        available: true,
        entriesTruncated: false,
        entries: [],
      }),
    );
    harness.store.close();
  });

  it("classifies a snapshot-limit overflow as indeterminate", async () => {
    const harness = await createHarness();
    const oversized = path.join(harness.workspaceRoot, "oversized.bin");
    await writeFile(oversized, "");
    await truncate(oversized, MAX_WORKSPACE_SNAPSHOT_BYTES + 1);
    const session = await startProcess(harness);
    expect(session.workspaceBeforeTruncated).toBe(true);
    harness.controlled.processes[0]!.settle(0);

    const settled = await harness.manager.waitForSettlement(
      harness.thread.id,
      session.id,
    );
    expect(settled).toEqual(
      expect.objectContaining({
        status: "succeeded",
        workspaceBeforeTruncated: true,
        workspaceAfterTruncated: true,
        workspaceDeltaStatus: "indeterminate",
        workspaceChangedFileCount: 0,
      }),
    );
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
    const session = await startProcess(
      harness,
      "process.stdin.resume()",
      30_000,
      true,
    );
    harness.controlled.processes[0]!.stdin.resume();
    await harness.manager.writeInput({
      threadId: harness.thread.id,
      processId: session.id,
      text: "RESTART_SECRET_INPUT",
      initiatedBy: "operator",
    });
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
        workspaceDeltaAvailable: false,
        stdinOpen: false,
        stdinWriteCount: 1,
        stdinBytes: Buffer.byteLength("RESTART_SECRET_INPUT"),
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
    expect(await restarted.delta(harness.thread.id, session.id)).toEqual({
      kind: "napier.workspace-process-delta",
      schemaVersion: 1,
      processId: session.id,
      available: false,
      entriesTruncated: false,
      entries: [],
    });
    expect(
      JSON.stringify(await restartedStore.listEvents(harness.thread.id)),
    ).not.toContain("ephemeral");
    expect(
      JSON.stringify(await restartedStore.listEvents(harness.thread.id)),
    ).not.toContain("RESTART_SECRET_INPUT");
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
    let markLaunchEntered: (() => void) | undefined;
    const launchEntered = new Promise<void>((resolve) => {
      markLaunchEntered = resolve;
    });
    const launchGate = new Promise<void>((resolve) => {
      releaseLaunch = resolve;
    });
    const delayedSandbox: OsSandboxAdapter = {
      id: "delayed-sandbox",
      async launch(request) {
        markLaunchEntered!();
        await launchGate;
        return controlled.sandbox.launch(request);
      },
    };
    const harness = await createHarness({ sandbox: delayedSandbox });
    const starting = startProcess(harness);
    await launchEntered;
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
    expect(interrupted.workspaceDeltaAvailable).toBe(false);
    expect(JSON.stringify(interrupted)).not.toContain("TOP_SECRET");
    harness.store.close();
  });

  it("terminates after an accepted input cannot be bound to the Ledger", async () => {
    const harness = await createHarness();
    const session = await startProcess(
      harness,
      "process.stdin.resume()",
      30_000,
      true,
    );
    harness.controlled.processes[0]!.stdin.resume();
    const appendEvent = harness.store.appendEvent.bind(harness.store);
    vi.spyOn(harness.store, "appendEvent").mockImplementation(async (input) => {
      if (input.type === "workspace.process.input") {
        throw new Error("TOP_SECRET_INPUT_LEDGER_FAILURE");
      }
      return appendEvent(input);
    });
    await expect(
      harness.manager.writeInput({
        threadId: harness.thread.id,
        processId: session.id,
        text: "UNBOUND_SECRET_INPUT",
        initiatedBy: "operator",
      }),
    ).rejects.toThrow("outcome is unknown");
    const interrupted = await harness.manager.waitForSettlement(
      harness.thread.id,
      session.id,
    );
    expect(interrupted).toEqual(
      expect.objectContaining({
        status: "interrupted",
        stdinOpen: false,
        stdinWriteCount: 1,
        interruptionReason: expect.stringContaining("outcome is unknown"),
      }),
    );
    expect(JSON.stringify(interrupted)).not.toContain("TOP_SECRET");
    expect(
      JSON.stringify(await harness.store.listEvents(harness.thread.id)),
    ).not.toContain("UNBOUND_SECRET_INPUT");
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
      interactive: true,
    });
    const processId = started.details.processId;
    const input = await tool.execute("call-input", {
      action: "input",
      processId,
      text: "AGENT_SECRET_INPUT",
      appendNewline: true,
    });
    expect(input.details).toEqual(
      expect.objectContaining({
        action: "input",
        stdinOpen: true,
        stdinWriteCount: 1,
        inputReceiptSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(input.content[0]?.text).not.toContain("AGENT_SECRET_INPUT");
    expect(
      workspaceProcessToolCallArgumentsLedgerProjection({
        action: "input",
        processId,
        text: "AGENT_SECRET_INPUT",
        appendNewline: true,
      }),
    ).toEqual(
      expect.objectContaining({
        inputBytes: Buffer.byteLength("AGENT_SECRET_INPUT\n"),
        appendNewline: true,
      }),
    );
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
    expect(cancelled.details.workspaceDeltaStatus).toBe("unchanged");
    expect(cancelled.content[0]?.text).toContain("Workspace delta: unchanged");
    harness.store.close();
  });
});
