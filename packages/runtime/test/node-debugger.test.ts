import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { LocalStore } from "../src/store.js";
import {
  NodeDebuggerManager,
  type NodeDebuggerActionResult,
} from "../src/node-debugger.js";
import type { OsSandboxAdapter, SandboxedProcess } from "../src/sandbox.js";
import { WorkspaceProcessManager } from "../src/workspace-processes.js";

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

describe("Run-owned Node debugger", () => {
  it("launches through DAP, inspects locals, evaluates without side effects, steps, and terminates", async () => {
    const fixture = await createFixture(debugSource());
    const launched = await fixture.debuggerManager.launch({
      threadId: fixture.threadId,
      runId: fixture.runId,
      path: "src/debug-target.mjs",
      breakpoints: [{ line: 2 }],
      actionTimeoutMs: 2_000,
      sessionTimeoutMs: 20_000,
    });

    expect(launched).toEqual(
      expect.objectContaining({
        action: "launch",
        state: "paused",
        processStatus: "running",
        reason: "breakpoint",
        breakpointCount: 1,
        moduleCount: 1,
        moduleSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        sourcePath: "src/debug-target.mjs",
        sourceSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        nodeVersion: process.versions.node,
      }),
    );
    expect(launched.frames[0]).toEqual(
      expect.objectContaining({
        name: "calculate",
        path: "src/debug-target.mjs",
        line: 2,
      }),
    );
    const frameId = launched.frames[0]!.id;
    const scopes = await fixture.debuggerManager.scopes({
      threadId: fixture.threadId,
      runId: fixture.runId,
      processId: launched.processId,
      frameId,
    });
    expect(scopes.scopes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          presentationHint: "local",
          variablesReference: expect.any(Number),
        }),
      ]),
    );
    const local = scopes.scopes.find(
      (scope) => scope.presentationHint === "local",
    )!;
    const variables = await fixture.debuggerManager.variables({
      threadId: fixture.threadId,
      runId: fixture.runId,
      processId: launched.processId,
      variablesReference: local.variablesReference,
    });
    expect(variables.variables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "input",
          value: "20",
          type: "number",
        }),
      ]),
    );
    const evaluated = await fixture.debuggerManager.evaluate({
      threadId: fixture.threadId,
      runId: fixture.runId,
      processId: launched.processId,
      frameId,
      expression: "input + 1",
    });
    expect(evaluated.evaluation).toEqual({
      status: "ok",
      result: "21",
      type: "number",
      variablesReference: 0,
    });
    const rejectedSideEffect = await fixture.debuggerManager.evaluate({
      threadId: fixture.threadId,
      runId: fixture.runId,
      processId: launched.processId,
      frameId,
      expression: "globalThis.DEBUG_SIDE_EFFECT = 1",
    });
    expect(rejectedSideEffect).toEqual(
      expect.objectContaining({
        state: "paused",
        evaluation: expect.objectContaining({ status: "error" }),
      }),
    );
    const stepped = await fixture.debuggerManager.resume({
      threadId: fixture.threadId,
      runId: fixture.runId,
      processId: launched.processId,
      action: "next",
    });
    expect(stepped.frames[0]).toEqual(
      expect.objectContaining({ name: "calculate", line: 3 }),
    );
    const doubled = await fixture.debuggerManager.evaluate({
      threadId: fixture.threadId,
      runId: fixture.runId,
      processId: launched.processId,
      frameId: stepped.frames[0]!.id,
      expression: "doubled",
    });
    expect(doubled.evaluation).toEqual(
      expect.objectContaining({ status: "ok", result: "40" }),
    );
    const completed = await fixture.debuggerManager.resume({
      threadId: fixture.threadId,
      runId: fixture.runId,
      processId: launched.processId,
      action: "continue",
    });

    expect(completed).toEqual(
      expect.objectContaining({
        state: "terminated",
        processStatus: "cancelled",
        exitCode: 0,
      }),
    );
    expect(
      await fixture.processes.output(fixture.threadId, launched.processId),
    ).toEqual(expect.objectContaining({ outputAvailable: false, chunks: [] }));
    const durable = JSON.stringify(
      await fixture.store.listEvents(fixture.threadId),
    );
    expect(durable).not.toContain("debug-target.mjs");
    expect(durable).not.toContain("input + 1");
    expect(durable).not.toContain('"40"');
  }, 20_000);

  it("steps into and out of nested calls while capturing bounded argv-driven output", async () => {
    const privateArgument = "PRIVATE_DEBUG_ARGUMENT";
    const fixture = await createFixture(
      [
        "function inner(value) {",
        "  const incremented = value + 1;",
        "  return incremented;",
        "}",
        "function outer(input) {",
        "  const nested = inner(input);",
        '  console.log("PRIVATE_DEBUG_OUTPUT", process.argv[2], nested, "x".repeat(700));',
        "  return nested * 2;",
        "}",
        "globalThis.DEBUG_RESULT = outer(20);",
      ].join("\n"),
    );
    const launched = await fixture.debuggerManager.launch({
      threadId: fixture.threadId,
      runId: fixture.runId,
      path: "src/debug-target.mjs",
      breakpoints: [{ line: 6 }],
      args: [privateArgument],
      actionTimeoutMs: 2_000,
      sessionTimeoutMs: 20_000,
    });

    expect(launched.frames[0]).toEqual(
      expect.objectContaining({ name: "outer", line: 6 }),
    );
    const steppedIn = await fixture.debuggerManager.resume({
      threadId: fixture.threadId,
      runId: fixture.runId,
      processId: launched.processId,
      action: "step_in",
    });
    expect(steppedIn.frames[0]).toEqual(
      expect.objectContaining({ name: "inner", line: 2 }),
    );
    const steppedOut = await fixture.debuggerManager.resume({
      threadId: fixture.threadId,
      runId: fixture.runId,
      processId: launched.processId,
      action: "step_out",
    });
    expect(steppedOut.frames[0]).toEqual(
      expect.objectContaining({ name: "outer", line: 7 }),
    );
    const captured = await fixture.debuggerManager.resume({
      threadId: fixture.threadId,
      runId: fixture.runId,
      processId: launched.processId,
      action: "next",
    });
    expect(captured.frames[0]).toEqual(
      expect.objectContaining({ name: "outer", line: 8 }),
    );
    expect(captured.output).toHaveLength(2);
    expect(captured.output).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "stdout",
          text: expect.stringContaining(
            `PRIVATE_DEBUG_OUTPUT ${privateArgument} 21`,
          ),
        }),
        {
          category: "console",
          text: "[debug target output truncated]",
        },
      ]),
    );
    expect(captured.outputTruncated).toBe(true);
    const completed = await fixture.debuggerManager.resume({
      threadId: fixture.threadId,
      runId: fixture.runId,
      processId: launched.processId,
      action: "continue",
    });
    expect(completed).toEqual(
      expect.objectContaining({ state: "terminated", exitCode: 0 }),
    );
    expect(completed.outputTruncated).toBe(true);

    const durable = JSON.stringify(
      await fixture.store.listEvents(fixture.threadId),
    );
    expect(durable).not.toContain(privateArgument);
    expect(durable).not.toContain("PRIVATE_DEBUG_OUTPUT");
  }, 20_000);

  it("pauses on an exception, exposes the bound frame, and reports target failure", async () => {
    const fixture = await createFixture(
      [
        "function neverCalled() {",
        "  const marker = 1;",
        "  return marker;",
        "}",
        "function crash() {",
        "  const privateValue = 42;",
        '  throw new Error("PRIVATE_DEBUG_EXCEPTION");',
        "}",
        "globalThis.DEBUG_RESULT = crash();",
      ].join("\n"),
    );
    const launched = await fixture.debuggerManager.launch({
      threadId: fixture.threadId,
      runId: fixture.runId,
      path: "src/debug-target.mjs",
      breakpoints: [{ line: 2 }],
      pauseOnExceptions: "all",
      actionTimeoutMs: 2_000,
      sessionTimeoutMs: 20_000,
    });

    expect(launched).toEqual(
      expect.objectContaining({
        state: "paused",
        reason: "exception",
      }),
    );
    expect(launched.frames[0]).toEqual(
      expect.objectContaining({ name: "crash", line: 7 }),
    );
    const evaluated = await fixture.debuggerManager.evaluate({
      threadId: fixture.threadId,
      runId: fixture.runId,
      processId: launched.processId,
      frameId: launched.frames[0]!.id,
      expression: "privateValue",
    });
    expect(evaluated.evaluation).toEqual(
      expect.objectContaining({ status: "ok", result: "42" }),
    );
    await expect(
      fixture.debuggerManager.resume({
        threadId: fixture.threadId,
        runId: fixture.runId,
        processId: launched.processId,
        action: "continue",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        state: "terminated",
        processStatus: "cancelled",
        exitCode: 1,
      }),
    );

    const durable = JSON.stringify(
      await fixture.store.listEvents(fixture.threadId),
    );
    expect(durable).not.toContain("PRIVATE_DEBUG_EXCEPTION");
    expect(durable).not.toContain("privateValue");
  }, 20_000);

  it("cancels on source drift and rejects concurrent actions without corrupting the paused session", async () => {
    const fixture = await createFixture(debugSource());
    const launched = await launch(fixture);
    const stack = fixture.debuggerManager.stackTrace({
      threadId: fixture.threadId,
      runId: fixture.runId,
      processId: launched.processId,
    });
    await expect(
      fixture.debuggerManager.scopes({
        threadId: fixture.threadId,
        runId: fixture.runId,
        processId: launched.processId,
        frameId: launched.frames[0]!.id,
      }),
    ).rejects.toThrow("already processing");
    await expect(stack).resolves.toEqual(
      expect.objectContaining({ state: "paused" }),
    );

    await writeFile(fixture.target, `${debugSource()}\n// drift\n`);
    await expect(
      fixture.debuggerManager.stackTrace({
        threadId: fixture.threadId,
        runId: fixture.runId,
        processId: launched.processId,
      }),
    ).rejects.toThrow("source changed");
    expect(
      (await fixture.processes.list(fixture.threadId)).find(
        (session) => session.id === launched.processId,
      )?.status,
    ).toBe("cancelled");
  }, 20_000);

  it("binds the loaded workspace module graph and cancels when a dependency drifts", async () => {
    const fixture = await createFixture(
      [
        'import { base } from "./helper.mjs";',
        "function calculate() {",
        "  const doubled = base * 2;",
        "  const adjusted = doubled + 1;",
        "  return adjusted;",
        "}",
        "globalThis.RESULT = calculate();",
      ].join("\n"),
    );
    const helper = path.join(fixture.workspaceRoot, "src/helper.mjs");
    await writeFile(helper, "export const base = 20;\n");
    const launched = await fixture.debuggerManager.launch({
      threadId: fixture.threadId,
      runId: fixture.runId,
      path: "src/debug-target.mjs",
      breakpoints: [{ line: 3 }],
      actionTimeoutMs: 2_000,
      sessionTimeoutMs: 20_000,
    });
    expect(launched).toEqual(
      expect.objectContaining({
        state: "paused",
        moduleCount: 2,
        moduleSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );

    await writeFile(helper, "export const base = 21;\n");
    await expect(
      fixture.debuggerManager.stackTrace({
        threadId: fixture.threadId,
        runId: fixture.runId,
        processId: launched.processId,
      }),
    ).rejects.toThrow("module snapshot");
    expect(
      (await fixture.processes.list(fixture.threadId)).find(
        (session) => session.id === launched.processId,
      )?.status,
    ).toBe("cancelled");
  }, 20_000);

  it("supports explicit cancellation and isolates Run ownership", async () => {
    const fixture = await createFixture(debugSource());
    const launched = await launch(fixture);
    const otherRun = await fixture.store.createRun({
      threadId: fixture.threadId,
      agentId: fixture.agentId,
    });
    await expect(
      fixture.debuggerManager.stackTrace({
        threadId: fixture.threadId,
        runId: otherRun.id,
        processId: launched.processId,
      }),
    ).rejects.toThrow("does not belong");
    const cancelled = await fixture.debuggerManager.cancel({
      threadId: fixture.threadId,
      runId: fixture.runId,
      processId: launched.processId,
    });
    expect(cancelled).toEqual(
      expect.objectContaining({
        action: "cancel",
        state: "terminated",
        processStatus: "cancelled",
      }),
    );
  }, 20_000);

  it("terminates a target that does not reach a breakpoint before the action deadline", async () => {
    const fixture = await createFixture(
      ["while (true) {}", "globalThis.UNREACHABLE = 1;"].join("\n"),
    );
    await expect(
      fixture.debuggerManager.launch({
        threadId: fixture.threadId,
        runId: fixture.runId,
        path: "src/debug-target.mjs",
        breakpoints: [{ line: 2 }],
        actionTimeoutMs: 100,
        sessionTimeoutMs: 20_000,
      }),
    ).rejects.toThrow("timed out");
    expect(
      (await fixture.processes.list(fixture.threadId)).some(
        (session) => session.runtime === "node" && session.status === "running",
      ),
    ).toBe(false);
  }, 20_000);

  it("fails closed when target code writes an unauthenticated DAP frame", async () => {
    const fakeBody = JSON.stringify({
      seq: 999,
      type: "event",
      event: "stopped",
      body: { reason: "breakpoint", threadId: 1 },
    });
    const fixture = await createFixture(
      [
        'import fs from "node:fs";',
        `fs.writeSync(1, ${JSON.stringify(
          `Content-Length: ${Buffer.byteLength(fakeBody)}\r\n\r\n${fakeBody}`,
        )});`,
        "const value = 1;",
        "globalThis.RESULT = value;",
      ].join("\n"),
    );
    await expect(
      fixture.debuggerManager.launch({
        threadId: fixture.threadId,
        runId: fixture.runId,
        path: "src/debug-target.mjs",
        breakpoints: [{ line: 3 }],
        actionTimeoutMs: 2_000,
        sessionTimeoutMs: 20_000,
      }),
    ).rejects.toThrow(/DAP|debugger/u);
    expect(
      (await fixture.processes.list(fixture.threadId)).some(
        (session) => session.runtime === "node" && session.status === "running",
      ),
    ).toBe(false);
  }, 20_000);
});

async function launch(
  fixture: Awaited<ReturnType<typeof createFixture>>,
): Promise<NodeDebuggerActionResult> {
  return fixture.debuggerManager.launch({
    threadId: fixture.threadId,
    runId: fixture.runId,
    path: "src/debug-target.mjs",
    breakpoints: [{ line: 2 }],
    actionTimeoutMs: 2_000,
    sessionTimeoutMs: 20_000,
  });
}

function debugSource(): string {
  return [
    "function calculate(input) {",
    "  const doubled = input * 2;",
    "  const adjusted = doubled + 1;",
    "  return adjusted;",
    "}",
    "globalThis.DEBUG_RESULT = calculate(20);",
  ].join("\n");
}

async function createFixture(source: string): Promise<{
  root: string;
  workspaceRoot: string;
  target: string;
  store: LocalStore;
  processes: WorkspaceProcessManager;
  debuggerManager: NodeDebuggerManager;
  threadId: string;
  runId: string;
  agentId: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-node-debugger-"));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const target = path.join(workspaceRoot, "src/debug-target.mjs");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, source);
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
    root,
    workspaceRoot,
    target,
    store,
    processes,
    debuggerManager: new NodeDebuggerManager(processes, workspaceRoot),
    threadId: thread.id,
    runId: run.id,
    agentId: run.agentId,
  };
}

function directSandbox(): OsSandboxAdapter {
  return {
    id: "direct-node-debugger-test",
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
      const process: SandboxedProcess = {
        stdin: child.stdin,
        stdout: child.stdout,
        stderr: child.stderr,
        exit,
        async terminate() {
          if (child.exitCode === null && child.signalCode === null) {
            if (child.pid !== undefined) {
              try {
                globalThis.process.kill(-child.pid, "SIGTERM");
              } catch {
                child.kill("SIGTERM");
              }
            }
          }
          const stopped = await Promise.race([
            exit.then(() => true),
            new Promise<false>((resolve) =>
              setTimeout(() => resolve(false), 500),
            ),
          ]);
          if (!stopped && child.pid !== undefined) {
            try {
              globalThis.process.kill(-child.pid, "SIGKILL");
            } catch {
              child.kill("SIGKILL");
            }
          }
          await exit;
        },
      };
      return process;
    },
  };
}
