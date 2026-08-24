import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  LocalStore,
  parsePythonKernelResult,
  MAX_PYTHON_KERNEL_PROTOCOL_TOTAL_CHARS,
  PYTHON_KERNEL_MEMORY_LIMIT_MARKER,
  PYTHON_KERNEL_TIMEOUT_MARKER,
  PythonKernelManager,
  type OsSandboxAdapter,
  WorkspaceProcessManager,
} from "../src/index.js";
import { MAX_PYTHON_KERNEL_JSON_VALUE_BYTES } from "../src/python-kernel-json-worker.js";

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
        jsonValue: [2, 4, 6],
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
        jsonValue: 12,
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

  it("binds one frozen JSON input and returns exact JSON values", async () => {
    const fixture = await createFixture();
    const kernel = await fixture.kernels.start({
      threadId: fixture.threadId,
      runId: fixture.runId,
      timeoutMs: 20_000,
    });
    const input = {
      values: [3, 5, 7],
      label: "PRIVATE_PYTHON_INPUT",
    };
    const bound = await fixture.kernels.evaluate({
      threadId: fixture.threadId,
      runId: fixture.runId,
      processId: kernel.id,
      code: "input",
      input,
    });
    const assignment = await fixture.kernels.evaluate({
      threadId: fixture.threadId,
      runId: fixture.runId,
      processId: kernel.id,
      code: "input = {'values': [1]}",
    });
    const mutation = await fixture.kernels.evaluate({
      threadId: fixture.threadId,
      runId: fixture.runId,
      processId: kernel.id,
      code: "input['values'][0] = 99",
    });
    const rebound = await fixture.kernels.evaluate({
      threadId: fixture.threadId,
      runId: fixture.runId,
      processId: kernel.id,
      code: "input",
      input: { values: [1], label: "REBOUND" },
    });
    const projected = await fixture.kernels.evaluate({
      threadId: fixture.threadId,
      runId: fixture.runId,
      processId: kernel.id,
      code: "{'total': sum(input['values']), 'values': input['values']}",
    });

    expect(bound).toEqual(
      expect.objectContaining({
        status: "ok",
        jsonValue: input,
        jsonValueSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(assignment.preview).toContain("input binding is read-only");
    expect(mutation.preview).toContain("TypeError");
    expect(rebound.preview).toContain("input is already bound");
    expect(projected).toEqual(
      expect.objectContaining({
        status: "ok",
        jsonValue: { total: 15, values: [3, 5, 7] },
      }),
    );
    const durable = JSON.stringify(
      await fixture.store.listEvents(fixture.threadId),
    );
    expect(durable).not.toContain("PRIVATE_PYTHON_INPUT");
    expect(durable).not.toContain("REBOUND");
  }, 20_000);

  it("routes synchronous napier.call through the host bridge only when enabled", async () => {
    const fixture = await createFixture();
    const kernel = await fixture.kernels.start({
      threadId: fixture.threadId,
      runId: fixture.runId,
      timeoutMs: 20_000,
    });
    const calls: Array<{ toolId: string; input: unknown }> = [];
    const disabled = await fixture.kernels.evaluate({
      threadId: fixture.threadId,
      runId: fixture.runId,
      processId: kernel.id,
      code: 'napier.call("read_file", {"path": "evidence.txt"})',
    });
    const bridged = await fixture.kernels.evaluate({
      threadId: fixture.threadId,
      runId: fixture.runId,
      processId: kernel.id,
      code: [
        'first = napier.call("read_file", {"path": "evidence.txt"})',
        'second = napier.capability("commit")',
        '{"text": first["content"][0]["text"], "tool": second[0]["toolId"]}',
      ].join("\n"),
      codeBridge: async (request) => {
        calls.push({ toolId: request.toolId, input: request.input });
        if (request.toolId === "capability") {
          return {
            content: [],
            details: { descriptors: [{ toolId: "git_commit_apply" }] },
            isError: false,
          };
        }
        return {
          content: [{ type: "text", text: "PYTHON_BRIDGE_EVIDENCE" }],
          details: {},
          isError: false,
        };
      },
    });

    expect(disabled).toEqual(
      expect.objectContaining({
        status: "error",
        terminal: false,
        preview: expect.stringContaining(
          "napier.call is not enabled for this evaluation",
        ),
      }),
    );
    expect(bridged).toEqual(
      expect.objectContaining({
        status: "ok",
        terminal: false,
        jsonValue: {
          text: "PYTHON_BRIDGE_EVIDENCE",
          tool: "git_commit_apply",
        },
      }),
    );
    expect(calls).toEqual([
      { toolId: "read_file", input: { path: "evidence.txt" } },
      { toolId: "capability", input: { query: "commit" } },
    ]);
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
    const largeResults = [];
    for (let index = 0; index < 16; index += 1) {
      const result = await fixture.kernels.evaluate({
        threadId: fixture.threadId,
        runId: fixture.runId,
        processId: kernel.id,
        code: `raise ValueError("${String(index)}" * 5000)`,
      });
      largeResults.push(result);
      if (result.terminal) break;
    }
    const first = largeResults[0]!;
    const second = largeResults[1]!;
    const exhausted = largeResults.at(-1)!;

    expect(consoleResult.console).toHaveLength(12);
    expect(consoleResult.consoleTruncated).toBe(true);
    expect(first.preview).toHaveLength(4_096);
    expect(first.previewTruncated).toBe(true);
    expect(second.previewTruncated).toBe(true);
    expect(
      (await fixture.processes.list(fixture.threadId)).find(
        (session) => session.id === kernel.id,
      )?.outputLimitChars,
    ).toBe(MAX_PYTHON_KERNEL_PROTOCOL_TOTAL_CHARS);
    expect(exhausted).toEqual(
      expect.objectContaining({
        status: "error",
        terminal: true,
        processStatus: "cancelled",
        preview: "Python kernel output budget exhausted",
      }),
    );
  }, 20_000);

  it("returns exact JSON through the complete 32 KiB boundary", async () => {
    const fixture = await createFixture();
    const kernel = await fixture.kernels.start({
      threadId: fixture.threadId,
      runId: fixture.runId,
      timeoutMs: 20_000,
    });
    const exactLength = MAX_PYTHON_KERNEL_JSON_VALUE_BYTES - 2;
    const exact = await fixture.kernels.evaluate({
      threadId: fixture.threadId,
      runId: fixture.runId,
      processId: kernel.id,
      code: `"x" * ${String(exactLength)}`,
      resultMode: "workflow_final",
    });
    const oversized = await fixture.kernels.evaluate({
      threadId: fixture.threadId,
      runId: fixture.runId,
      processId: kernel.id,
      code: `"x" * ${String(exactLength + 1)}`,
      resultMode: "workflow_final",
    });

    expect(exact).toEqual(
      expect.objectContaining({
        status: "ok",
        jsonValue: "x".repeat(exactLength),
        jsonValueBytes: MAX_PYTHON_KERNEL_JSON_VALUE_BYTES,
        preview: "",
        console: [],
      }),
    );
    expect(oversized).toEqual(
      expect.objectContaining({
        status: "ok",
        preview: "",
        console: [],
      }),
    );
    expect(oversized.jsonValue).toBeUndefined();
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
      jsonValueUtf8Base64: Buffer.from("42", "utf8").toString("base64"),
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
    ).toEqual(
      expect.objectContaining({
        preview: "42",
        valueType: "integer",
        jsonValue: 42,
      }),
    );
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
    expect(
      parsePythonKernelResult(
        `NAPIER_PY_RESULT ${JSON.stringify({
          ...JSON.parse(valid),
          jsonValueUtf8Base64: "not canonical",
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
