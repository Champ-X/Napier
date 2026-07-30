import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
  exportThreadReplayBundle,
  LocalStore,
  ModelRegistry,
  type OsSandboxAdapter,
  verifyThreadReplayBundle,
  WorkspaceProcessManager,
} from "../src/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Agent Node debugger integration", () => {
  it("uses real DAP stack and variables, steps, terminates, and persists only hashes", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-agent-node-debugger-"),
    );
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(path.join(workspaceRoot, "src"), { recursive: true });
    await writeFile(
      path.join(workspaceRoot, "src/debug-target.mjs"),
      [
        "function calculate(input) {",
        "  const doubled = input * 2;",
        "  const adjusted = doubled + 1;",
        "  return adjusted;",
        "}",
        "globalThis.PRIVATE_DEBUG_RESULT = calculate(20);",
      ].join("\n"),
    );
    const store = new LocalStore({
      workspaceRoot,
      dataRoot: path.join(root, "data"),
    });
    await store.initialize();
    const sandbox = directSandbox();
    const processes = new WorkspaceProcessManager({
      store,
      workspaceRoot,
      sandbox,
    });
    await processes.initialize();
    const agent = await store.updateAgent(store.listAgents()[0]!.id, {
      toolPolicy: "workspace",
      enabledTools: ["node_debugger"],
    });
    const thread = await store.createThread({
      title: "Agent Node debugger",
      agentId: agent.id,
    });
    const provider = fauxProvider({ provider: "faux-node-debugger" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("node_debugger", {
          action: "launch",
          path: "src/debug-target.mjs",
          breakpoints: [{ line: 2 }],
          timeoutMs: 2_000,
          sessionTimeoutMs: 20_000,
        }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        const messages = JSON.stringify(context.messages);
        const processId = messages.match(/process_[a-z0-9]{20}/u)?.[0];
        const frameId = messages.match(/#(\d+) calculate/u)?.[1];
        expect(messages).toContain("Stop reason: breakpoint");
        expect(processId).toBeDefined();
        expect(frameId).toBeDefined();
        return fauxAssistantMessage(
          fauxToolCall("node_debugger", {
            action: "scopes",
            processId,
            frameId: Number(frameId),
          }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        const messages = JSON.stringify(context.messages);
        const processId = messages.match(/process_[a-z0-9]{20}/u)?.[0];
        const variablesReference = messages.match(
          /calculate -> variablesReference (\d+)/u,
        )?.[1];
        expect(processId).toBeDefined();
        expect(variablesReference).toBeDefined();
        return fauxAssistantMessage(
          fauxToolCall("node_debugger", {
            action: "variables",
            processId,
            variablesReference: Number(variablesReference),
          }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        const messages = JSON.stringify(context.messages);
        const processId = messages.match(/process_[a-z0-9]{20}/u)?.[0];
        const frameId = messages.match(/#(\d+) calculate/u)?.[1];
        expect(messages).toContain("input: 20 (number)");
        expect(processId).toBeDefined();
        expect(frameId).toBeDefined();
        return fauxAssistantMessage(
          fauxToolCall("node_debugger", {
            action: "evaluate",
            processId,
            frameId: Number(frameId),
            expression: "input + 1",
          }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        const messages = JSON.stringify(context.messages);
        const processId = messages.match(/process_[a-z0-9]{20}/u)?.[0];
        expect(messages).toContain("ok: 21 (number)");
        expect(processId).toBeDefined();
        return fauxAssistantMessage(
          fauxToolCall("node_debugger", {
            action: "next",
            processId,
          }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        const messages = JSON.stringify(context.messages);
        const processId = messages.match(/process_[a-z0-9]{20}/u)?.[0];
        expect(messages).toContain("src/debug-target.mjs:3:");
        expect(processId).toBeDefined();
        return fauxAssistantMessage(
          fauxToolCall("node_debugger", {
            action: "continue",
            processId,
          }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        const messages = JSON.stringify(context.messages);
        expect(messages).toContain("Target exit code: 0");
        return fauxAssistantMessage(
          "The real Node DAP session proved input 20, pure evaluation 21, and a clean stepped completion.",
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
      text: "Debug the real program, inspect input, evaluate input + 1, step once, and continue.",
      model: { provider: "faux-node-debugger", id: "faux-1" },
    });

    expect(run.status, run.error).toBe("completed");
    const events = await store.listEvents(thread.id);
    expect(
      events
        .filter(
          (event) =>
            event.type === "tool.started" &&
            record(event.payload)?.["toolName"] === "node_debugger",
        )
        .map((event) => record(event.payload)?.["effect"]),
    ).toEqual(["write", "read", "read", "read", "write", "write"]);
    const debuggerEvents = events.filter(
      (event) =>
        event.type === "tool.completed" &&
        record(event.payload)?.["toolName"] === "node_debugger",
    );
    expect(debuggerEvents).toHaveLength(6);
    expect(debuggerEvents.at(-1)?.payload["details"]).toEqual(
      expect.objectContaining({
        kind: "napier.node-debugger",
        action: "continue",
        state: "terminated",
        exitCode: 0,
        moduleCount: 1,
      }),
    );
    const durable = JSON.stringify(events);
    expect(durable).not.toContain("debug-target.mjs");
    expect(durable).not.toContain("PRIVATE_DEBUG_RESULT");
    const durableToolEvidence = JSON.stringify(
      events.filter(
        (event) =>
          event.type.startsWith("tool.") ||
          event.type.startsWith("workspace.process."),
      ),
    );
    expect(durableToolEvidence).not.toContain("input + 1");
    expect(durableToolEvidence).not.toContain("input: 20");
    expect(
      verifyThreadReplayBundle(await exportThreadReplayBundle(store, thread.id))
        .status,
    ).toBe("valid");
    const sessions = await processes.list(thread.id);
    expect(sessions.filter((session) => session.status === "running")).toEqual(
      [],
    );
    const runEvents = events.filter((event) => event.runId === run.id);
    expect(
      runEvents.find((event) => event.type === "workspace.process.settled")
        ?.seq,
    ).toBeLessThan(
      runEvents.find((event) => event.type === "run.completed")?.seq ??
        Number.NEGATIVE_INFINITY,
    );
    await processes.shutdown();
    store.close();
  }, 20_000);

  it("cancels a debugger left paused before recording the Run terminal event", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-agent-node-debugger-cleanup-"),
    );
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(path.join(workspaceRoot, "src"), { recursive: true });
    await writeFile(
      path.join(workspaceRoot, "src/debug-target.mjs"),
      [
        "function calculate(input) {",
        "  const doubled = input * 2;",
        "  return doubled;",
        "}",
        "globalThis.PRIVATE_DEBUG_RESULT = calculate(20);",
      ].join("\n"),
    );
    const store = new LocalStore({
      workspaceRoot,
      dataRoot: path.join(root, "data"),
    });
    await store.initialize();
    const sandbox = directSandbox();
    const processes = new WorkspaceProcessManager({
      store,
      workspaceRoot,
      sandbox,
    });
    await processes.initialize();
    const agent = await store.updateAgent(store.listAgents()[0]!.id, {
      toolPolicy: "workspace",
      enabledTools: ["node_debugger"],
    });
    const thread = await store.createThread({
      title: "Agent Node debugger cleanup",
      agentId: agent.id,
    });
    const provider = fauxProvider({
      provider: "faux-node-debugger-cleanup",
    });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("node_debugger", {
          action: "launch",
          path: "src/debug-target.mjs",
          breakpoints: [{ line: 2 }],
          timeoutMs: 2_000,
          sessionTimeoutMs: 20_000,
        }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        expect(JSON.stringify(context.messages)).toContain(
          "Stop reason: breakpoint",
        );
        return fauxAssistantMessage("Inspection is complete.");
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
      text: "Pause at the calculation and then finish.",
      model: { provider: "faux-node-debugger-cleanup", id: "faux-1" },
    });

    expect(run.status, run.error).toBe("completed");
    const [session] = await processes.list(thread.id);
    expect(session).toEqual(
      expect.objectContaining({
        runtime: "node",
        status: "cancelled",
        outputAvailable: false,
      }),
    );
    const runEvents = (await store.listEvents(thread.id)).filter(
      (event) => event.runId === run.id,
    );
    expect(
      runEvents.find((event) => event.type === "workspace.process.settled")
        ?.seq,
    ).toBeLessThan(
      runEvents.find((event) => event.type === "run.completed")?.seq ??
        Number.NEGATIVE_INFINITY,
    );
    await processes.shutdown();
    store.close();
  }, 20_000);
});

function directSandbox(): OsSandboxAdapter {
  return {
    id: "direct-agent-node-debugger-test",
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
          const stopped = await Promise.race([
            exit.then(() => true),
            new Promise<false>((resolve) =>
              setTimeout(() => resolve(false), 500),
            ),
          ]);
          if (!stopped && child.pid !== undefined) {
            try {
              process.kill(-child.pid, "SIGKILL");
            } catch {
              child.kill("SIGKILL");
            }
          }
          await exit;
        },
      };
    },
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
