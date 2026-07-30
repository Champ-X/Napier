import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  LocalStore,
  parsePythonKernelResult,
  PYTHON_KERNEL_MEMORY_LIMIT_MARKER,
  PYTHON_KERNEL_TIMEOUT_MARKER,
  PythonKernelManager,
  type OsSandboxAdapter,
  WorkspaceProcessManager,
} from "../src/index.js";

const temporaryRoots: string[] = [];
const openProcesses: WorkspaceProcessManager[] = [];
const openStores: LocalStore[] = [];

afterEach(async () => {
  await Promise.allSettled(
    openProcesses.splice(0).map((processes) => processes.shutdown()),
  );
  for (const store of openStores.splice(0)) store.close();
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("persistent Python kernel", () => {
  it("keeps synchronous state while restricting imports and private access", async () => {
    const fixture = await createFixture();
    const kernel = await fixture.kernels.start({
      threadId: fixture.threadId,
      runId: fixture.runId,
      timeoutMs: 20_000,
    });
    const seeded = await fixture.kernels.evaluate({
      threadId: fixture.threadId,
      runId: fixture.runId,
      processId: kernel.id,
      code: "values = [2, 4, 6]\nvalues",
    });
    const restricted = await fixture.kernels.evaluate({
      threadId: fixture.threadId,
      runId: fixture.runId,
      processId: kernel.id,
      code: "import os",
    });
    const privateAccess = await fixture.kernels.evaluate({
      threadId: fixture.threadId,
      runId: fixture.runId,
      processId: kernel.id,
      code: "values.__class__",
    });
    const frameAccess = await fixture.kernels.evaluate({
      threadId: fixture.threadId,
      runId: fixture.runId,
      processId: kernel.id,
      code: [
        "holder = {}",
        'frame_reader = (holder["reader"].gi_frame.f_back.f_globals for item in [0])',
        'holder["reader"] = frame_reader',
        "next(frame_reader)",
      ].join("\n"),
    });
    const reduced = await fixture.kernels.evaluate({
      threadId: fixture.threadId,
      runId: fixture.runId,
      processId: kernel.id,
      code: 'print("PRIVATE_PYTHON_CONSOLE")\nsum(values)',
    });
    const cancelled = await fixture.kernels.cancel({
      threadId: fixture.threadId,
      runId: fixture.runId,
      processId: kernel.id,
    });

    expect(kernel).toEqual(
      expect.objectContaining({
        runtime: "python",
        status: "running",
        outputAvailable: false,
        stdinOpen: false,
      }),
    );
    expect(seeded).toEqual(
      expect.objectContaining({
        status: "ok",
        terminal: false,
        processStatus: "running",
        valueType: "list",
        preview: "[2, 4, 6]",
        pythonVersion: expect.stringMatching(/^\d+\.\d+\.\d+$/u),
      }),
    );
    expect(restricted).toEqual(
      expect.objectContaining({
        status: "error",
        terminal: false,
        preview: expect.stringContaining("Import"),
      }),
    );
    expect(privateAccess.preview).toContain("private attributes");
    expect(frameAccess).toEqual(
      expect.objectContaining({
        status: "error",
        terminal: false,
        preview: expect.stringContaining("unavailable"),
      }),
    );
    expect(reduced).toEqual(
      expect.objectContaining({
        status: "ok",
        preview: "12",
        console: ["PRIVATE_PYTHON_CONSOLE"],
      }),
    );
    expect(cancelled.status).toBe("cancelled");
    const durable = JSON.stringify(
      await fixture.store.listEvents(fixture.threadId),
    );
    expect(durable).not.toContain("values =");
    expect(durable).not.toContain("PRIVATE_PYTHON_CONSOLE");
    expect(durable).not.toContain("[2, 4, 6]");
  }, 20_000);

  it("terminates the complete kernel on evaluation timeout", async () => {
    const fixture = await createFixture();
    const kernel = await fixture.kernels.start({
      threadId: fixture.threadId,
      runId: fixture.runId,
      timeoutMs: 20_000,
    });

    const startedAt = Date.now();
    await expect(
      fixture.kernels.evaluate({
        threadId: fixture.threadId,
        runId: fixture.runId,
        processId: kernel.id,
        code: "while True:\n    pass",
        timeoutMs: 50,
      }),
    ).rejects.toThrow("timed out");
    expect(Date.now() - startedAt).toBeLessThan(750);
    expect(
      (await fixture.processes.list(fixture.threadId)).find(
        (session) => session.id === kernel.id,
      ),
    ).toEqual(expect.objectContaining({ status: "cancelled" }));
    await expect(
      fixture.kernels.evaluate({
        threadId: fixture.threadId,
        runId: fixture.runId,
        processId: kernel.id,
        code: "1 + 1",
      }),
    ).rejects.toThrow("does not belong");
    expect(
      JSON.stringify(await fixture.store.listEvents(fixture.threadId)),
    ).not.toContain(PYTHON_KERNEL_TIMEOUT_MARKER);
  }, 20_000);

  it("serializes private protocol input and isolates Run ownership", async () => {
    const fixture = await createFixture();
    const kernel = await fixture.kernels.start({
      threadId: fixture.threadId,
      runId: fixture.runId,
      timeoutMs: 20_000,
    });
    const otherRun = await fixture.store.createRun({
      threadId: fixture.threadId,
      agentId: fixture.agentId,
    });
    const [left, right] = await Promise.all([
      fixture.kernels.evaluate({
        threadId: fixture.threadId,
        runId: fixture.runId,
        processId: kernel.id,
        code: "sum(range(10))",
      }),
      fixture.kernels.evaluate({
        threadId: fixture.threadId,
        runId: fixture.runId,
        processId: kernel.id,
        code: "max([3, 9, 4])",
      }),
    ]);

    expect([left.preview, right.preview].sort()).toEqual(["45", "9"]);
    await expect(
      fixture.kernels.evaluate({
        threadId: fixture.threadId,
        runId: otherRun.id,
        processId: kernel.id,
        code: "1",
      }),
    ).rejects.toThrow("does not belong");
    expect(await fixture.processes.output(fixture.threadId, kernel.id)).toEqual(
      expect.objectContaining({
        outputAvailable: false,
        chunks: [],
      }),
    );
  }, 20_000);

  it("caps preview, console, and cumulative protocol output", async () => {
    const fixture = await createFixture();
    const kernel = await fixture.kernels.start({
      threadId: fixture.threadId,
      runId: fixture.runId,
      timeoutMs: 20_000,
    });
    const consoleResult = await fixture.kernels.evaluate({
      threadId: fixture.threadId,
      runId: fixture.runId,
      processId: kernel.id,
      code: "for index in range(20):\n    print(index)\nNone",
    });
    const first = await fixture.kernels.evaluate({
      threadId: fixture.threadId,
      runId: fixture.runId,
      processId: kernel.id,
      code: 'raise ValueError("x" * 5000)',
    });
    const second = await fixture.kernels.evaluate({
      threadId: fixture.threadId,
      runId: fixture.runId,
      processId: kernel.id,
      code: 'raise ValueError("y" * 5000)',
    });
    const exhausted = await fixture.kernels.evaluate({
      threadId: fixture.threadId,
      runId: fixture.runId,
      processId: kernel.id,
      code: 'raise ValueError("z" * 5000)',
    });

    expect(consoleResult.console).toHaveLength(12);
    expect(consoleResult.consoleTruncated).toBe(true);
    expect(first.preview).toHaveLength(4_096);
    expect(first.previewTruncated).toBe(true);
    expect(second.previewTruncated).toBe(true);
    expect(exhausted).toEqual(
      expect.objectContaining({
        status: "error",
        terminal: true,
        processStatus: "cancelled",
        preview: "Python kernel output budget exhausted",
      }),
    );
  }, 20_000);

  it("rejects oversized input before write and cancels an active evaluation", async () => {
    const fixture = await createFixture();
    const kernel = await fixture.kernels.start({
      threadId: fixture.threadId,
      runId: fixture.runId,
      timeoutMs: 20_000,
    });
    await expect(
      fixture.kernels.evaluate({
        threadId: fixture.threadId,
        runId: fixture.runId,
        processId: kernel.id,
        code: "x".repeat(16 * 1024 + 1),
      }),
    ).rejects.toThrow("1-16384 UTF-8 bytes");
    expect(
      (await fixture.processes.list(fixture.threadId)).find(
        (session) => session.id === kernel.id,
      )?.status,
    ).toBe("running");

    const controller = new AbortController();
    const evaluation = fixture.kernels.evaluate({
      threadId: fixture.threadId,
      runId: fixture.runId,
      processId: kernel.id,
      code: "while True:\n    pass",
      timeoutMs: 2_000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 20);
    await expect(evaluation).rejects.toThrow("aborted");
    expect(
      (await fixture.processes.list(fixture.threadId)).find(
        (session) => session.id === kernel.id,
      )?.status,
    ).toBe("cancelled");
  }, 20_000);

  it("terminates when persistent Python allocations exceed the traced heap budget", async () => {
    const fixture = await createFixture();
    const kernel = await fixture.kernels.start({
      threadId: fixture.threadId,
      runId: fixture.runId,
      timeoutMs: 20_000,
    });
    await expect(
      fixture.kernels.evaluate({
        threadId: fixture.threadId,
        runId: fixture.runId,
        processId: kernel.id,
        code: [
          "memory_values = []",
          "while True:",
          "    try:",
          '        memory_values.append(str(len(memory_values)) + "x" * 1024)',
          "    except:",
          "        pass",
        ].join("\n"),
        timeoutMs: 2_000,
      }),
    ).rejects.toThrow("traced memory limit exceeded");
    expect(
      (await fixture.processes.list(fixture.threadId)).find(
        (session) => session.id === kernel.id,
      )?.status,
    ).not.toBe("running");
    await expect(
      fixture.kernels.evaluate({
        threadId: fixture.threadId,
        runId: fixture.runId,
        processId: kernel.id,
        code: "1",
      }),
    ).rejects.toThrow("does not belong");
    expect(
      JSON.stringify(await fixture.store.listEvents(fixture.threadId)),
    ).not.toContain(PYTHON_KERNEL_MEMORY_LIMIT_MARKER);
  }, 20_000);

  it("strictly validates protocol identity and canonical text encoding", () => {
    const requestId = "pykernelrequest_aaaaaaaaaaaaaaaaaaaa";
    const valid = JSON.stringify({
      kind: "napier.python-kernel-result",
      schemaVersion: 1,
      id: requestId,
      status: "ok",
      terminal: false,
      valueType: "integer",
      previewUtf16Base64: Buffer.from("42", "utf16le").toString("base64"),
      previewTruncated: false,
      consoleUtf16Base64: [],
      consoleTruncated: false,
      durationMs: 1,
      pythonVersion: "3.9.6",
      memoryPeakBytes: 1_024,
      memoryLimitBytes: 32 * 1024 * 1024,
    });

    expect(
      parsePythonKernelResult(`NAPIER_PY_RESULT ${valid}`, requestId),
    ).toEqual(expect.objectContaining({ preview: "42", valueType: "integer" }));
    expect(
      parsePythonKernelResult(`NAPIER_PY_RESULT ${valid}`, `${requestId}x`),
    ).toBeUndefined();
    expect(
      parsePythonKernelResult(
        `NAPIER_PY_RESULT ${JSON.stringify({
          ...JSON.parse(valid),
          previewUtf16Base64: "not canonical",
        })}`,
        requestId,
      ),
    ).toBeUndefined();
  });
});

async function createFixture(): Promise<{
  store: LocalStore;
  processes: WorkspaceProcessManager;
  kernels: PythonKernelManager;
  threadId: string;
  runId: string;
  agentId: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-python-kernel-"));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot, { recursive: true });
  const store = new LocalStore({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
  });
  await store.initialize();
  openStores.push(store);
  const processes = new WorkspaceProcessManager({
    store,
    workspaceRoot,
    sandbox: directSandbox(),
  });
  await processes.initialize();
  openProcesses.push(processes);
  const thread = store.listThreads()[0]!;
  const run = store.listRuns(thread.id)[0]!;
  return {
    store,
    processes,
    kernels: new PythonKernelManager(processes),
    threadId: thread.id,
    runId: run.id,
    agentId: run.agentId,
  };
}

function directSandbox(): OsSandboxAdapter {
  return {
    id: "direct-python-kernel-test",
    async launch(request) {
      const child = spawn(request.command, request.args, {
        cwd: request.cwd,
        env: { ...request.env },
        detached: true,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const exit = new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve) =>
        child.once("exit", (code, signal) => resolve({ code, signal })),
      );
      return {
        stdin: child.stdin,
        stdout: child.stdout,
        stderr: child.stderr,
        exit,
        async terminate() {
          if (child.exitCode === null && child.signalCode === null) {
            if (child.pid !== undefined) {
              try {
                process.kill(-child.pid, "SIGTERM");
              } catch {
                child.kill("SIGTERM");
              }
            }
          }
          await exit;
        },
      };
    },
  };
}
