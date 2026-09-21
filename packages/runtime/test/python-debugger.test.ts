import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { Value } from "typebox/value";
import {
  createNodeDebuggerTool,
  nodeDebuggerToolCallArgumentsLedgerProjection,
  nodeDebuggerToolOutputLedgerProjection,
} from "../src/node-debugger-tool.js";
import { withToolchainProviders } from "../src/toolchain-provider.js";
import { PythonDebuggerToolRuntime } from "../src/python-debugger-tool.js";
import { AgentSessionRuntime } from "../src/agent-sessions.js";
import { preserveAgentToolIdentity } from "../src/agent-tool-metadata.js";
import { pythonDebuggerToolchainOptions } from "../src/toolchain-debugger-provider.js";
import { builtInToolEffect } from "../src/agent-tool-effects.js";
import { assessToolCall } from "../src/policy.js";
import { LocalStore } from "../src/store.js";
import { HostDirectSandboxAdapter } from "../src/sandbox-host-direct.js";
import { WorkspaceProcessManager } from "../src/workspace-processes.js";
import { PythonDebuggerManager } from "../src/python-debugger.js";
import { resolvePythonDebuggerRuntime } from "../src/python-debugger-runtime.js";
import { createActiveTestRun } from "./active-run-test-fixture.js";

const live = it.runIf(process.env.NAPIER_LIVE_PYTHON_DEBUGGER_SMOKE === "1");
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-python-debugger-"));
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  const program =
    "subtotal = 50\nexpedited = True\nbase = 0 if subtotal >= 50 else 5\nshipping = base + (8 if expedited else 0)\nprint(shipping)\n";
  await writeFile(path.join(workspaceRoot, "shipping.py"), program);
  const store = new LocalStore({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
  });
  await store.initialize();
  const { run, thread } = await createActiveTestRun(store, "Debug Python");
  const options = {
    workspaceRoot,
    sandbox: new HostDirectSandboxAdapter(),
    ...(process.env.NAPIER_TEST_DEBUGPY_PYTHON
      ? { executables: { python: process.env.NAPIER_TEST_DEBUGPY_PYTHON } }
      : {}),
  };
  const processes = new WorkspaceProcessManager({
    ...options,
    store,
    dataRoot: path.join(root, "data"),
  });
  await processes.initialize();
  const debuggerManager = new PythonDebuggerManager(processes, options);
  const owner = { threadId: thread.id, runId: run.id };
  cleanups.push(async () => {
    await debuggerManager.cancelRun(owner);
    await processes.shutdown();
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  return {
    owner,
    store,
    processes,
    debuggerManager,
    workspaceRoot,
    program,
    options,
  };
}

it("rejects an unconfigured isolated transport without silently selecting host-direct", async () => {
  await expect(
    resolvePythonDebuggerRuntime({
      workspaceRoot: "/unused",
      sandbox: {
        id: "offline-test",
        launch: async () => {
          throw new Error("must not launch");
        },
      },
    }),
  ).rejects.toThrow("isolated debug transport");
});

it("retains debugger admission, schema bounds and policy scope; Python inspection is execution", async () => {
  const owner = { threadId: "thread_test0000", runId: "run_test0000" };
  const original = createNodeDebuggerTool(
    undefined as never,
    owner,
    new PythonDebuggerToolRuntime(undefined as never),
  );
  const options = {
    workspaceRoot: "/unused",
    sandbox: new HostDirectSandboxAdapter(),
  };
  const guarded = preserveAgentToolIdentity(original, {
    ...original,
    execute: vi.fn(async () => {
      expect(pythonDebuggerToolchainOptions()).toBe(options);
      throw new Error("original guard");
    }),
  });
  const tool = withToolchainProviders([guarded], options)[0]!;
  const launch = {
    action: "launch",
    runtime: "python",
    path: "example.py",
    breakpoints: [{ line: 1 }],
  };
  expect(Value.Check(original.parameters, launch)).toBe(false);
  expect(Value.Check(tool.parameters, launch)).toBe(true);
  expect(Value.Check(tool.parameters, { ...launch, runtime: "bash" })).toBe(
    false,
  );
  expect(Value.Check(tool.parameters, { ...launch, timeoutMs: 10001 })).toBe(
    false,
  );
  expect(
    Buffer.byteLength(
      JSON.stringify({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        constrainedSampling: null,
      }),
    ),
  ).toBeLessThanOrEqual(3 * 1024);
  await expect(tool.execute("guard", launch)).rejects.toThrow("original guard");
  await expect(original.execute("no-policy", launch as never)).rejects.toThrow(
    "toolchain policy",
  );
  expect(() => pythonDebuggerToolchainOptions()).toThrow("toolchain policy");
  expect(withToolchainProviders([], options)).toEqual([]);
  for (const action of ["stack_trace", "scopes", "variables", "evaluate"]) {
    expect(builtInToolEffect("node_debugger", { action })).toBe("read");
    expect(
      builtInToolEffect("node_debugger", { action, runtime: "python" }),
    ).toBe("write");
    expect(
      assessToolCall(
        "observe",
        "node_debugger",
        { action, runtime: "python" },
        "/unused",
      ).allowed,
    ).toBe(false);
  }
});

live(
  "routes admitted tools to real Python DAP and applies the Agent write barrier",
  async () => {
    const f = await fixture();
    const sessions = new AgentSessionRuntime(
      f.processes,
      f.workspaceRoot,
      f.options.sandbox,
      {} as never,
    );
    const tool = withToolchainProviders(
      sessions.createProcessTools(["node_debugger"], f.owner),
      f.options,
    )[0]!;
    const launchInput = {
      action: "launch",
      runtime: "python",
      path: "shipping.py",
      breakpoints: [{ line: 4 }],
    };
    try {
      const launched = await tool.execute("launch", launchInput);
      expect(launched.details).toMatchObject({
        kind: "napier.python-debugger",
        isolation: "none",
        state: "paused",
      });
      const request = {
        runtime: "python",
        processId: launched.details.processId,
      };
      const stack = await tool.execute("stack", {
        ...request,
        action: "stack_trace",
      });
      const liveResult = JSON.parse(stack.content[0]!.text);
      expect(liveResult.data.stackFrames[0].line).toBe(4);
      const evaluated = await tool.execute("eval", {
        ...request,
        action: "evaluate",
        frameId: liveResult.data.stackFrames[0].id,
        expression: "subtotal + 1234",
      });
      expect(JSON.parse(evaluated.content[0]!.text).data.result).toBe("1284");
      const ledger = JSON.stringify({
        input: nodeDebuggerToolCallArgumentsLedgerProjection(launchInput),
        output: nodeDebuggerToolOutputLedgerProjection(
          evaluated.content[0]!.text,
          evaluated,
        ),
        details: evaluated.details,
      });
      expect(ledger).not.toContain("shipping.py");
      expect(ledger).not.toContain("subtotal");
      expect(ledger).not.toContain("1284");
      await sessions.debuggerWriteBarrier({
        threadId: f.owner.threadId,
        id: f.owner.runId,
      })();
      expect(
        (await f.processes.list(f.owner.threadId)).every(
          (s) => s.status !== "running",
        ),
      ).toBe(true);
      await expect(
        tool.execute("stale", { ...request, action: "stack_trace" }),
      ).rejects.toThrow("owned");
    } finally {
      await sessions.cancelDebuggerRun(f.owner);
    }
  },
  30000,
);

live(
  "cancels startup, timed-out requests and aborted resumes without leaving a process",
  async () => {
    const f = await fixture();
    const launch = (actionTimeoutMs = 10000) =>
      f.debuggerManager.launch({
        ...f.owner,
        path: "shipping.py",
        breakpoints: [{ line: 4 }],
        actionTimeoutMs,
      });
    const pending = launch();
    const rejected = expect(pending).rejects.toThrow();
    await f.debuggerManager.cancelRun(f.owner);
    await rejected;
    expect(
      (await f.processes.list(f.owner.threadId)).every(
        (s) => s.status !== "running",
      ),
    ).toBe(true);
    await expect(launch(1)).rejects.toThrow("timed out");
    expect(
      (await f.processes.list(f.owner.threadId)).every(
        (s) => s.status !== "running",
      ),
    ).toBe(true);
    await writeFile(
      path.join(f.workspaceRoot, "shipping.py"),
      f.program + "import time\ntime.sleep(30)\n",
    );
    const paused = await launch();
    await expect(
      f.debuggerManager.execute({
        ...f.owner,
        processId: paused.processId,
        action: "continue",
        signal: AbortSignal.timeout(300),
      }),
    ).rejects.toThrow();
    expect(
      (await f.processes.list(f.owner.threadId)).every(
        (s) => s.status !== "running",
      ),
    ).toBe(true);
  },
  30000,
);

live(
  "uses real managed DAP for breakpoints, locals, evaluation, stepping and termination",
  async () => {
    const f = await fixture();
    const launched = await f.debuggerManager.launch({
      ...f.owner,
      path: "shipping.py",
      breakpoints: [{ line: 4 }],
    });
    expect(launched).toMatchObject({
      state: "paused",
      sandbox: "host-direct",
      isolation: "none",
    });
    const request = { ...f.owner, processId: launched.processId };
    expect(
      await f.processes.output(f.owner.threadId, launched.processId),
    ).toMatchObject({ chunks: [], outputAvailable: false });
    await expect(
      f.processes.writeInput({
        ...request,
        text: "fake DAP",
        initiatedBy: "agent",
      }),
    ).rejects.toThrow("private protocol");
    await expect(
      f.debuggerManager.execute({
        ...request,
        runId: "run_other0000",
        action: "stack_trace",
      }),
    ).rejects.toThrow("owned");
    const stack = await f.debuggerManager.execute({
      ...request,
      action: "stack_trace",
    });
    const frame = (
      stack.data as { stackFrames: Array<{ id: number; line: number }> }
    ).stackFrames[0]!;
    expect(frame.line).toBe(4);
    const scopes = await f.debuggerManager.execute({
      ...request,
      action: "scopes",
      frameId: frame.id,
    });
    const locals = (
      scopes.data as {
        scopes: Array<{ name: string; variablesReference: number }>;
      }
    ).scopes.find((s) => s.name === "Locals")!;
    const variables = await f.debuggerManager.execute({
      ...request,
      action: "variables",
      variablesReference: locals.variablesReference,
    });
    expect((variables.data as { variables: Array<unknown> }).variables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "subtotal", value: "50" }),
        expect.objectContaining({ name: "base", value: "0" }),
      ]),
    );
    const evaluated = await f.debuggerManager.execute({
      ...request,
      action: "evaluate",
      frameId: frame.id,
      expression: "subtotal + 1",
    });
    expect(evaluated.data).toMatchObject({ result: "51" });
    const stepped = await f.debuggerManager.execute({
      ...request,
      action: "next",
    });
    expect(stepped.state).toBe("paused");
    await expect(
      f.debuggerManager.execute({
        ...request,
        action: "scopes",
        frameId: frame.id,
      }),
    ).rejects.toThrow("stale");
    const ended = await f.debuggerManager.execute({
      ...request,
      action: "continue",
    });
    expect(ended.state).toBe("terminated");
    expect(ended.debuggeeExitCode).toBe(0);
    expect(
      (await f.processes.list(f.owner.threadId)).some(
        (s) => s.status === "running",
      ),
    ).toBe(false);
    expect(
      await readFile(path.join(f.workspaceRoot, "shipping.py"), "utf8"),
    ).toBe(f.program);
    const events = await f.store.listRunEvents(f.owner.runId);
    expect(JSON.stringify(events)).not.toContain("subtotal + 1");
    expect(events.some((e) => e.type === "workspace.process.input")).toBe(true);
  },
  30000,
);

live(
  "binds the workspace Python environment and stops a session when its configuration changes",
  async () => {
    const f = await fixture();
    const runtime = await resolvePythonDebuggerRuntime(f.options);
    const envRoot = path.join(f.workspaceRoot, ".venv");
    await mkdir(path.join(envRoot, "bin"), { recursive: true });
    await symlink(runtime.executable, path.join(envRoot, "bin/python3"));
    const config = await readFile(runtime.environmentConfigPath, "utf8");
    await writeFile(path.join(envRoot, "pyvenv.cfg"), config);
    const site = path.join(
      envRoot,
      "lib",
      `python${runtime.pythonVersion.split(".").slice(0, 2).join(".")}`,
      "site-packages",
      "debugpy",
    );
    await cp(runtime.debugpyRoot, site, { recursive: true });
    const launched = await f.debuggerManager.launch({
      ...f.owner,
      path: "shipping.py",
      breakpoints: [{ line: 4 }],
    });
    await writeFile(
      path.join(envRoot, "pyvenv.cfg"),
      config + "\n# environment changed\n",
    );
    await expect(
      f.debuggerManager.execute({
        ...f.owner,
        processId: launched.processId,
        action: "stack_trace",
      }),
    ).rejects.toThrow("runtime changed");
    expect(
      (await f.processes.list(f.owner.threadId)).every(
        (s) => s.status !== "running",
      ),
    ).toBe(true);
  },
  30000,
);

live(
  "cancels on source drift and on Run cancellation without replaying private input",
  async () => {
    const f = await fixture();
    const launch = () =>
      f.debuggerManager.launch({
        ...f.owner,
        path: "shipping.py",
        breakpoints: [{ line: 4 }],
      });
    const first = await launch();
    await writeFile(
      path.join(f.workspaceRoot, "shipping.py"),
      f.program + "# changed\n",
    );
    await expect(
      f.debuggerManager.execute({
        ...f.owner,
        processId: first.processId,
        action: "stack_trace",
      }),
    ).rejects.toThrow("expectedSha256");
    expect(
      (await f.processes.list(f.owner.threadId)).find(
        (s) => s.id === first.processId,
      )?.status,
    ).not.toBe("running");
    const second = await launch();
    await f.debuggerManager.cancelRun(f.owner);
    expect(
      (await f.processes.list(f.owner.threadId)).find(
        (s) => s.id === second.processId,
      )?.status,
    ).not.toBe("running");
  },
  30000,
);
