import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import {
  AgentRuntime,
  createPlatformSandboxAdapter,
  JavascriptKernelManager,
  LocalStore,
  ModelRegistry,
  NodeDebuggerManager,
  PythonKernelManager,
  WorkspaceProcessManager,
} from "../src/index.js";

const LIVE_PROCESS_ENABLED =
  process.env.NAPIER_LIVE_WORKSPACE_PROCESS_SMOKE === "1";
const describeLive = LIVE_PROCESS_ENABLED ? describe : describe.skip;
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describeLive("live Workspace Process smoke", () => {
  it("writes only through a preview-bound scope in the real OS sandbox", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(tmpdir(), "napier-live-process-write-workspace-"),
    );
    const dataRoot = await mkdtemp(
      path.join(tmpdir(), "napier-live-process-write-"),
    );
    temporaryRoots.push(workspaceRoot, dataRoot);
    await mkdir(path.join(workspaceRoot, "generated"));
    const store = new LocalStore({ workspaceRoot, dataRoot });
    await store.initialize();
    const sandbox = createPlatformSandboxAdapter();
    const processes = new WorkspaceProcessManager({
      store,
      workspaceRoot,
      dataRoot,
      sandbox,
    });
    await processes.initialize();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Live scoped Process write",
      agentId: agent.id,
    });
    const run = await store.createRun({
      threadId: thread.id,
      agentId: agent.id,
    });
    const preview = await processes.previewWrite({
      threadId: thread.id,
      runId: run.id,
      command: {
        runtime: "node",
        args: [
          "-e",
          "require('node:fs').writeFileSync('generated/live.txt','LIVE_SCOPED_WRITE')",
        ],
        timeoutMs: 10_000,
      },
      writePaths: ["generated"],
    });
    const started = await processes.startWrite({
      threadId: thread.id,
      runId: run.id,
      previewId: preview.id,
    });
    const settled = await processes.waitForSettlement(thread.id, started.id);

    expect(settled).toEqual(
      expect.objectContaining({
        status: "succeeded",
        workspaceAccess: "scoped_write",
        workspaceWriteScopeStatus: "within_scope",
        workspaceChangedFileCount: 1,
        workspaceRollbackAvailable: true,
      }),
    );
    expect(
      await readFile(path.join(workspaceRoot, "generated", "live.txt"), "utf8"),
    ).toBe("LIVE_SCOPED_WRITE");
    const rollbackPreview = await processes.previewRollback(
      thread.id,
      started.id,
    );
    const rollback = await processes.rollback(
      thread.id,
      started.id,
      rollbackPreview.id,
    );
    expect(rollback).toEqual(
      expect.objectContaining({
        status: "restored",
        rollbackVerified: true,
        scopeCount: 1,
        restoredScopeCount: 1,
      }),
    );
    await expect(
      lstat(path.join(workspaceRoot, "generated", "live.txt")),
    ).rejects.toThrow();
    const durable = JSON.stringify(await store.listEvents(thread.id));
    expect(durable).not.toContain("generated/live.txt");
    expect(durable).not.toContain("LIVE_SCOPED_WRITE");
    await processes.shutdown();
    store.close();
  }, 30_000);

  it("keeps state across bounded input writes in the real Agent sandbox", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(tmpdir(), "napier-live-process-workspace-"),
    );
    temporaryRoots.push(workspaceRoot);
    await writeFile(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "napier-live-workspace", version: "1.0.0" }),
    );
    const dataRoot = await mkdtemp(path.join(tmpdir(), "napier-live-process-"));
    temporaryRoots.push(dataRoot);
    const store = new LocalStore({ workspaceRoot, dataRoot });
    await store.initialize();
    const sandbox = createPlatformSandboxAdapter();
    const processes = new WorkspaceProcessManager({
      store,
      workspaceRoot,
      sandbox,
    });
    await processes.initialize();
    const agent = await store.updateAgent(store.listAgents()[0]!.id, {
      toolPolicy: "workspace",
      enabledTools: ["workspace_process"],
    });
    const thread = await store.createThread({
      title: "Live Workspace Process smoke",
      agentId: agent.id,
    });
    const commandSource = [
      "process.stdin.setEncoding('utf8');",
      "let buffer = '';",
      "let count = 0;",
      "process.stdin.on('data', (chunk) => {",
      "  buffer += chunk;",
      "  for (;;) {",
      "    const newline = buffer.indexOf('\\n');",
      "    if (newline < 0) break;",
      "    const value = buffer.slice(0, newline);",
      "    buffer = buffer.slice(newline + 1);",
      "    count += 1;",
      "    process.stdout.write(`ack:${count}:${value}\\n`);",
      "  }",
      "});",
      "process.stdin.on('end', () => {",
      "  process.stdout.write(`done:${count}\\n`);",
      "});",
    ].join(" ");
    const provider = fauxProvider({ provider: "live-process-smoke" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("workspace_process", {
          action: "start",
          runtime: "node",
          args: ["-e", commandSource],
          timeoutMs: 10_000,
          interactive: true,
        }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        const processId = JSON.stringify(context.messages).match(
          /process_[a-z0-9]{20}/u,
        )?.[0];
        expect(processId).toBeDefined();
        return fauxAssistantMessage(
          fauxToolCall("workspace_process", {
            action: "input",
            processId,
            text: "alpha",
            appendNewline: true,
          }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        const processId = JSON.stringify(context.messages).match(
          /process_[a-z0-9]{20}/u,
        )?.[0];
        expect(processId).toBeDefined();
        return fauxAssistantMessage(
          fauxToolCall("workspace_process", {
            action: "input",
            processId,
            text: "beta",
            appendNewline: true,
            close: true,
          }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        const processId = JSON.stringify(context.messages).match(
          /process_[a-z0-9]{20}/u,
        )?.[0];
        expect(processId).toBeDefined();
        return fauxAssistantMessage(
          fauxToolCall("workspace_process", {
            action: "poll",
            processId,
            afterCursor: 0,
            waitMs: 2_000,
          }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        const messages = JSON.stringify(context.messages);
        expect(messages).toContain("ack:1:alpha");
        expect(messages).toContain("ack:2:beta");
        expect(messages).toContain("done:2");
        return fauxAssistantMessage(
          "The stateful input worker completed in the sandbox.",
        );
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const registry = new ModelRegistry();
    registry.registerProvider(provider.provider);
    const runtime = new AgentRuntime(
      store,
      registry,
      undefined,
      sandbox,
      processes,
    );

    const run = await runtime.runPrompt({
      threadId: thread.id,
      text: "Run a stateful background worker across two input messages.",
      model: { provider: "live-process-smoke", id: "faux-1" },
    });

    expect(
      run.status,
      JSON.stringify({
        run,
        sessions: await processes.list(thread.id),
        events: await store.listEvents(thread.id),
      }),
    ).toBe("completed");
    const [session] = await processes.list(thread.id);
    expect(session).toBeDefined();
    const settled = await processes.waitForSettlement(thread.id, session!.id);
    const output = await processes.output(thread.id, session!.id);
    expect(
      settled.status,
      JSON.stringify({ settled, chunks: output.chunks }),
    ).toBe("succeeded");
    expect(settled.workspaceDeltaStatus).toBe("unchanged");
    expect(settled.workspaceBeforeTruncated).toBe(false);
    expect(settled.workspaceAfterTruncated).toBe(false);
    expect(settled.workspaceDeltaAvailable).toBe(true);
    expect(settled.stdinWriteCount).toBe(2);
    expect(settled.stdinOpen).toBe(false);
    const events = await store.listEvents(thread.id);
    expect(JSON.stringify(events)).not.toContain(commandSource);
    expect(JSON.stringify(events)).not.toContain("alpha");
    expect(JSON.stringify(events)).not.toContain("beta");
    await processes.shutdown();
    store.close();
  }, 30_000);

  it("runs and resizes a real PTY through the Agent and OS sandbox", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(tmpdir(), "napier-live-pty-workspace-"),
    );
    const dataRoot = await mkdtemp(path.join(tmpdir(), "napier-live-pty-"));
    temporaryRoots.push(workspaceRoot, dataRoot);
    const store = new LocalStore({ workspaceRoot, dataRoot });
    await store.initialize();
    const sandbox = createPlatformSandboxAdapter();
    const processes = new WorkspaceProcessManager({
      store,
      workspaceRoot,
      sandbox,
    });
    await processes.initialize();
    const agent = await store.updateAgent(store.listAgents()[0]!.id, {
      toolPolicy: "workspace",
      enabledTools: ["workspace_process"],
    });
    const thread = await store.createThread({
      title: "Live PTY Process smoke",
      agentId: agent.id,
    });
    const commandSource = [
      "process.stdin.setEncoding('utf8');",
      "process.stdout.write(`PTY_READY:${process.stdin.isTTY}:${process.stdout.isTTY}:${process.stdout.columns}x${process.stdout.rows}:${process.env.TERM}\\n`);",
      "process.stdin.once('data', data => {",
      "  process.stderr.write(`PTY_INPUT:${process.stdout.columns}x${process.stdout.rows}:${JSON.stringify(data)}\\n`);",
      "  process.exit(0);",
      "});",
    ].join(" ");
    const provider = fauxProvider({ provider: "live-pty-smoke" });
    let initialTerminalOutput = "";
    let resizedTerminalOutput = "";
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("workspace_process", {
          action: "start",
          runtime: "node",
          args: ["-e", commandSource],
          timeoutMs: 10_000,
          terminal: { columns: 91, rows: 37 },
        }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        const processId = JSON.stringify(context.messages).match(
          /process_[a-z0-9]{20}/u,
        )?.[0];
        expect(processId).toBeDefined();
        return fauxAssistantMessage(
          fauxToolCall("workspace_process", {
            action: "poll",
            processId,
            afterCursor: 0,
            waitMs: 2_000,
          }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        const messages = JSON.stringify(context.messages);
        const processId = messages.match(/process_[a-z0-9]{20}/u)?.[0];
        initialTerminalOutput = messages;
        return fauxAssistantMessage(
          fauxToolCall("workspace_process", {
            action: "resize",
            processId,
            columns: 111,
            rows: 43,
          }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        const processId = JSON.stringify(context.messages).match(
          /process_[a-z0-9]{20}/u,
        )?.[0];
        return fauxAssistantMessage(
          fauxToolCall("workspace_process", {
            action: "input",
            processId,
            text: "PTY_PRIVATE_INPUT",
            appendNewline: true,
          }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        const processId = JSON.stringify(context.messages).match(
          /process_[a-z0-9]{20}/u,
        )?.[0];
        return fauxAssistantMessage(
          fauxToolCall("workspace_process", {
            action: "poll",
            processId,
            afterCursor: 0,
            waitMs: 2_000,
          }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        const messages = JSON.stringify(context.messages);
        resizedTerminalOutput = messages;
        const processId = messages.match(/process_[a-z0-9]{20}/u)?.[0];
        const cursors = [...messages.matchAll(/"nextCursor":(\d+)/gu)];
        const afterCursor = Number(cursors.at(-1)?.[1] ?? "0");
        return fauxAssistantMessage(
          fauxToolCall("workspace_process", {
            action: "poll",
            processId,
            afterCursor,
            waitMs: 2_000,
          }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        resizedTerminalOutput = JSON.stringify(context.messages);
        return fauxAssistantMessage("The sandboxed PTY completed.");
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const registry = new ModelRegistry();
    registry.registerProvider(provider.provider);
    const runtime = new AgentRuntime(
      store,
      registry,
      undefined,
      sandbox,
      processes,
    );

    const run = await runtime.runPrompt({
      threadId: thread.id,
      text: "Run and resize a real terminal-aware process.",
      model: { provider: "live-pty-smoke", id: "faux-1" },
    });

    expect(
      run.status,
      JSON.stringify({
        run,
        sessions: await processes.list(thread.id),
        events: await store.listEvents(thread.id),
      }),
    ).toBe("completed");
    expect(initialTerminalOutput, initialTerminalOutput).toContain(
      "PTY_READY:true:true:91x37:xterm-256color",
    );
    expect(resizedTerminalOutput, resizedTerminalOutput).toContain(
      "PTY_INPUT:111x43",
    );
    expect(resizedTerminalOutput).toContain("PTY_PRIVATE_INPUT");
    const [session] = await processes.list(thread.id);
    expect(session).toBeDefined();
    const settled = await processes.waitForSettlement(thread.id, session!.id);
    expect(settled).toEqual(
      expect.objectContaining({
        ioMode: "pty",
        status: "succeeded",
        terminalType: "xterm-256color",
        terminalColumns: 111,
        terminalRows: 43,
        terminalResizeCount: 1,
        stdinWriteCount: 1,
        stdinOpen: false,
        stderrChars: 0,
        workspaceDeltaStatus: "unchanged",
      }),
    );
    const durable = JSON.stringify(await store.listEvents(thread.id));
    expect(durable).not.toContain(commandSource);
    expect(durable).not.toContain("PTY_PRIVATE_INPUT");
    expect(durable).not.toContain("PTY_INPUT:111x43");
    await processes.shutdown();
    store.close();
  }, 30_000);

  it("keeps JavaScript evaluation state in the real OS sandbox", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(tmpdir(), "napier-live-kernel-workspace-"),
    );
    const dataRoot = await mkdtemp(path.join(tmpdir(), "napier-live-kernel-"));
    temporaryRoots.push(workspaceRoot, dataRoot);
    const store = new LocalStore({ workspaceRoot, dataRoot });
    await store.initialize();
    const sandbox = createPlatformSandboxAdapter();
    const processes = new WorkspaceProcessManager({
      store,
      workspaceRoot,
      sandbox,
    });
    await processes.initialize();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Live JavaScript kernel smoke",
      agentId: agent.id,
    });
    const run = await store.createRun({
      threadId: thread.id,
      agentId: agent.id,
    });
    const kernels = new JavascriptKernelManager(processes);
    const kernel = await kernels.start({
      threadId: thread.id,
      runId: run.id,
      timeoutMs: 10_000,
    });
    const seeded = await kernels.evaluate({
      threadId: thread.id,
      runId: run.id,
      processId: kernel.id,
      code: "const LIVE_PRIVATE_VALUES = [3, 5, 7]; LIVE_PRIVATE_VALUES",
    });
    const reduced = await kernels.evaluate({
      threadId: thread.id,
      runId: run.id,
      processId: kernel.id,
      code: "LIVE_PRIVATE_VALUES.reduce((sum, value) => sum + value, 0)",
    });
    const cancelled = await kernels.cancel({
      threadId: thread.id,
      runId: run.id,
      processId: kernel.id,
    });

    expect(seeded.preview).toBe("[ 3, 5, 7 ]");
    expect(reduced.preview).toBe("15");
    expect(cancelled).toEqual(
      expect.objectContaining({
        sandbox:
          process.platform === "darwin"
            ? "macos-sandbox-exec"
            : "linux-bubblewrap",
        status: "cancelled",
        workspaceDeltaStatus: "unchanged",
      }),
    );
    const durable = JSON.stringify(await store.listEvents(thread.id));
    expect(durable).not.toContain("LIVE_PRIVATE_VALUES");
    expect(durable).not.toContain("[ 3, 5, 7 ]");
    await processes.shutdown();
    store.close();
  }, 30_000);

  it("keeps restricted Python state in the real OS sandbox", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(tmpdir(), "napier-live-python-kernel-workspace-"),
    );
    const dataRoot = await mkdtemp(
      path.join(tmpdir(), "napier-live-python-kernel-"),
    );
    temporaryRoots.push(workspaceRoot, dataRoot);
    const store = new LocalStore({ workspaceRoot, dataRoot });
    await store.initialize();
    const sandbox = createPlatformSandboxAdapter();
    const processes = new WorkspaceProcessManager({
      store,
      workspaceRoot,
      sandbox,
    });
    await processes.initialize();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Live Python kernel smoke",
      agentId: agent.id,
    });
    const run = await store.createRun({
      threadId: thread.id,
      agentId: agent.id,
    });
    const kernels = new PythonKernelManager(processes);
    const kernel = await kernels.start({
      threadId: thread.id,
      runId: run.id,
      timeoutMs: 10_000,
    });
    const seeded = await kernels.evaluate({
      threadId: thread.id,
      runId: run.id,
      processId: kernel.id,
      code: "LIVE_PRIVATE_VALUES = [3, 5, 7]\nLIVE_PRIVATE_VALUES",
    });
    const reduced = await kernels.evaluate({
      threadId: thread.id,
      runId: run.id,
      processId: kernel.id,
      code: "sum(LIVE_PRIVATE_VALUES)",
    });
    const cancelled = await kernels.cancel({
      threadId: thread.id,
      runId: run.id,
      processId: kernel.id,
    });

    expect(seeded.preview).toBe("[3, 5, 7]");
    expect(reduced.preview).toBe("15");
    expect(cancelled).toEqual(
      expect.objectContaining({
        runtime: "python",
        sandbox:
          process.platform === "darwin"
            ? "macos-sandbox-exec"
            : "linux-bubblewrap",
        status: "cancelled",
        workspaceDeltaStatus: "unchanged",
      }),
    );
    const durable = JSON.stringify(await store.listEvents(thread.id));
    expect(durable).not.toContain("LIVE_PRIVATE_VALUES");
    expect(durable).not.toContain("[3, 5, 7]");
    await processes.shutdown();
    store.close();
  }, 30_000);

  it("pauses and steps a real Node DAP target in the OS sandbox", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(tmpdir(), "napier-live-node-debugger-workspace-"),
    );
    const dataRoot = await mkdtemp(
      path.join(tmpdir(), "napier-live-node-debugger-"),
    );
    temporaryRoots.push(workspaceRoot, dataRoot);
    await writeFile(
      path.join(workspaceRoot, "debug-target.mjs"),
      [
        "function liveCalculation(input) {",
        "  const doubled = input * 2;",
        "  return doubled + 1;",
        "}",
        "globalThis.LIVE_PRIVATE_DEBUG = liveCalculation(20);",
      ].join("\n"),
    );
    const store = new LocalStore({ workspaceRoot, dataRoot });
    await store.initialize();
    const sandbox = createPlatformSandboxAdapter();
    const processes = new WorkspaceProcessManager({
      store,
      workspaceRoot,
      sandbox,
    });
    await processes.initialize();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Live Node debugger smoke",
      agentId: agent.id,
    });
    const run = await store.createRun({
      threadId: thread.id,
      agentId: agent.id,
    });
    const debuggerManager = new NodeDebuggerManager(processes, workspaceRoot);
    const launched = await debuggerManager.launch({
      threadId: thread.id,
      runId: run.id,
      path: "debug-target.mjs",
      breakpoints: [{ line: 2 }],
      actionTimeoutMs: 5_000,
      sessionTimeoutMs: 20_000,
    });
    const evaluated = await debuggerManager.evaluate({
      threadId: thread.id,
      runId: run.id,
      processId: launched.processId,
      frameId: launched.frames[0]!.id,
      expression: "input + 1",
    });
    const stepped = await debuggerManager.resume({
      threadId: thread.id,
      runId: run.id,
      processId: launched.processId,
      action: "next",
    });
    const completed = await debuggerManager.resume({
      threadId: thread.id,
      runId: run.id,
      processId: launched.processId,
      action: "continue",
    });

    expect(launched).toEqual(
      expect.objectContaining({
        state: "paused",
        reason: "breakpoint",
        moduleCount: 1,
      }),
    );
    expect(evaluated.evaluation).toEqual(
      expect.objectContaining({ status: "ok", result: "21" }),
    );
    expect(stepped.frames[0]).toEqual(
      expect.objectContaining({ name: "liveCalculation", line: 3 }),
    );
    expect(completed).toEqual(
      expect.objectContaining({
        state: "terminated",
        processStatus: "cancelled",
        exitCode: 0,
      }),
    );
    const [session] = (await processes.list(thread.id)).filter(
      (candidate) => candidate.id === launched.processId,
    );
    expect(session).toEqual(
      expect.objectContaining({
        sandbox:
          process.platform === "darwin"
            ? "macos-sandbox-exec"
            : "linux-bubblewrap",
        workspaceDeltaStatus: "unchanged",
      }),
    );
    const durable = JSON.stringify(await store.listEvents(thread.id));
    expect(durable).not.toContain("LIVE_PRIVATE_DEBUG");
    expect(durable).not.toContain("input + 1");
    await processes.shutdown();
    store.close();
  }, 30_000);
});
