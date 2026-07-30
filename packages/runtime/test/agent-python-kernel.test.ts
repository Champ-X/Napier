import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
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

describe("Agent persistent Python kernel integration", () => {
  it("keeps state across Agent turns, cleans up the Run, and persists only hashes", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-agent-python-kernel-"),
    );
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot, { recursive: true });
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
      enabledTools: ["python_kernel"],
    });
    const thread = await store.createThread({
      title: "Agent Python kernel",
      agentId: agent.id,
    });
    const provider = fauxProvider({ provider: "faux-python-kernel" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("python_kernel", {
          action: "start",
          sessionTimeoutMs: 20_000,
        }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        const messages = JSON.stringify(context.messages);
        const processId = messages.match(/process_[a-z0-9]{20}/u)?.[0];
        expect(processId).toBeDefined();
        return fauxAssistantMessage(
          fauxToolCall("python_kernel", {
            action: "evaluate",
            processId,
            code: "PRIVATE_SERIES = [3, 5, 7]\nPRIVATE_SERIES",
          }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        const messages = JSON.stringify(context.messages);
        const processId = messages.match(/process_[a-z0-9]{20}/u)?.[0];
        expect(messages).toContain("[3, 5, 7]");
        expect(processId).toBeDefined();
        return fauxAssistantMessage(
          fauxToolCall("python_kernel", {
            action: "evaluate",
            processId,
            code: 'print("PRIVATE_TOTAL")\nsum(PRIVATE_SERIES)',
          }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        const messages = JSON.stringify(context.messages);
        const processId = messages.match(/process_[a-z0-9]{20}/u)?.[0];
        expect(messages).toContain("PRIVATE_TOTAL");
        expect(messages).toContain("VALUE (untrusted live output)\\n15");
        expect(processId).toBeDefined();
        return fauxAssistantMessage(
          fauxToolCall("python_kernel", {
            action: "cancel",
            processId,
          }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        expect(JSON.stringify(context.messages)).toContain(
          "persistent state is no longer available",
        );
        return fauxAssistantMessage(
          "The persistent Python calculation returned 15 and was closed.",
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
      text: "Use one persistent Python context for the calculation.",
      model: { provider: "faux-python-kernel", id: "faux-1" },
    });

    expect(run.status, run.error).toBe("completed");
    const events = await store.listEvents(thread.id);
    expect(
      events
        .filter(
          (event) =>
            event.type === "tool.started" &&
            record(event.payload)?.["toolName"] === "python_kernel",
        )
        .map((event) => record(event.payload)?.["effect"]),
    ).toEqual(["write", "write", "write", "write"]);
    expect(
      events
        .filter((event) => event.type.startsWith("workspace.process."))
        .map((event) => event.type),
    ).toEqual([
      "workspace.process.started",
      "workspace.process.input",
      "workspace.process.input",
      "workspace.process.settled",
    ]);
    const durable = JSON.stringify(events);
    expect(durable).not.toContain("PRIVATE_SERIES");
    expect(durable).not.toContain("PRIVATE_TOTAL");
    expect(durable).not.toContain("[3, 5, 7]");
    expect(
      verifyThreadReplayBundle(await exportThreadReplayBundle(store, thread.id))
        .status,
    ).toBe("valid");

    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("python_kernel", {
          action: "start",
          sessionTimeoutMs: 20_000,
        }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        const processId = JSON.stringify(context.messages).match(
          /process_[a-z0-9]{20}/u,
        )?.[0];
        expect(processId).toBeDefined();
        return fauxAssistantMessage(
          fauxToolCall("python_kernel", {
            action: "evaluate",
            processId,
            code: "PRIVATE_UNCANCELLED_STATE = 9\nPRIVATE_UNCANCELLED_STATE",
          }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        expect(JSON.stringify(context.messages)).toContain(
          "VALUE (untrusted live output)\\n9",
        );
        return fauxAssistantMessage(
          "The calculation returned 9 without an explicit kernel cancel.",
        );
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const autoCleanupRun = await runtime.runPrompt({
      threadId: thread.id,
      text: "Calculate in Python and finish without cancelling the kernel.",
      model: { provider: "faux-python-kernel", id: "faux-1" },
    });

    expect(autoCleanupRun.status, autoCleanupRun.error).toBe("completed");
    const sessions = await processes.list(thread.id);
    expect(
      sessions.find((session) => session.runId === autoCleanupRun.id),
    ).toEqual(
      expect.objectContaining({ runtime: "python", status: "cancelled" }),
    );
    expect(sessions.filter((session) => session.status === "running")).toEqual(
      [],
    );
    const cleanupEvents = (await store.listEvents(thread.id)).filter(
      (event) => event.runId === autoCleanupRun.id,
    );
    expect(
      cleanupEvents.find((event) => event.type === "workspace.process.settled")
        ?.seq,
    ).toBeLessThan(
      cleanupEvents.find((event) => event.type === "run.completed")?.seq ??
        Number.NEGATIVE_INFINITY,
    );
    expect(JSON.stringify(cleanupEvents)).not.toContain(
      "PRIVATE_UNCANCELLED_STATE",
    );
    await processes.shutdown();
    store.close();
  }, 20_000);
});

function directSandbox(): OsSandboxAdapter {
  return {
    id: "direct-agent-python-kernel-test",
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

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
