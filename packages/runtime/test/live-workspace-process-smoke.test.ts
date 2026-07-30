import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

    expect(run.status).toBe("completed");
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
});
