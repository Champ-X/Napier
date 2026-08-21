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

describe("Agent persistent JavaScript kernel integration", () => {
  it("keeps state across Agent turns, cleans up the Run, and persists only hashes", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-agent-javascript-kernel-"),
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
      enabledTools: ["javascript_kernel"],
    });
    const thread = await store.createThread({
      title: "Agent JavaScript kernel",
      agentId: agent.id,
    });
    const provider = fauxProvider({ provider: "faux-javascript-kernel" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("javascript_kernel", {
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
          fauxToolCall("javascript_kernel", {
            action: "evaluate",
            processId,
            code: "const PRIVATE_SERIES = [2, 4, 6]; PRIVATE_SERIES",
          }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        const messages = JSON.stringify(context.messages);
        const processId = messages.match(/process_[a-z0-9]{20}/u)?.[0];
        expect(messages).toContain("[2,4,6]");
        expect(processId).toBeDefined();
        return fauxAssistantMessage(
          fauxToolCall("javascript_kernel", {
            action: "evaluate",
            processId,
            code: 'console.log("PRIVATE_TOTAL"); PRIVATE_SERIES.reduce((sum, value) => sum + value, 0)',
          }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        const messages = JSON.stringify(context.messages);
        const processId = messages.match(/process_[a-z0-9]{20}/u)?.[0];
        expect(messages).toContain("PRIVATE_TOTAL");
        expect(messages).toContain("VALUE (untrusted live output)\\n12");
        expect(processId).toBeDefined();
        return fauxAssistantMessage(
          fauxToolCall("javascript_kernel", {
            action: "cancel",
            processId,
          }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        expect(JSON.stringify(context.messages)).toContain(
          "persistent context is no longer available",
        );
        return fauxAssistantMessage(
          "The persistent JavaScript calculation returned 12 and was closed.",
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
      text: "Use one persistent JavaScript context for the calculation.",
      model: { provider: "faux-javascript-kernel", id: "faux-1" },
    });

    expect(run.status, run.error).toBe("completed");
    const events = await store.listEvents(thread.id);
    expect(
      events
        .filter(
          (event) =>
            event.type === "tool.started" &&
            record(event.payload)?.["toolName"] === "javascript_kernel",
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
    expect(durable).not.toContain("[2,4,6]");
    expect(
      verifyThreadReplayBundle(await exportThreadReplayBundle(store, thread.id))
        .status,
    ).toBe("valid");

    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("javascript_kernel", {
          action: "start",
          sessionTimeoutMs: 20_000,
        }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        const processId = Array.from(
          JSON.stringify(context.messages).matchAll(/process_[a-z0-9]{20}/gu),
          (match) => match[0],
        ).at(-1);
        expect(processId).toBeDefined();
        return fauxAssistantMessage(
          fauxToolCall("javascript_kernel", {
            action: "evaluate",
            processId,
            code: "const PRIVATE_UNCANCELLED_STATE = 9; PRIVATE_UNCANCELLED_STATE",
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
      text: "Calculate in JavaScript and finish without cancelling the kernel.",
      model: { provider: "faux-javascript-kernel", id: "faux-1" },
    });

    expect(autoCleanupRun.status, autoCleanupRun.error).toBe("completed");
    const sessions = await processes.list(thread.id);
    expect(
      sessions.find((session) => session.runId === autoCleanupRun.id),
    ).toEqual(expect.objectContaining({ status: "cancelled" }));
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

    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("javascript_kernel", {
          action: "start",
          sessionTimeoutMs: 20_000,
        }),
        { stopReason: "toolUse" },
      ),
      () => {
        throw new Error("MODEL_FAILED_WITH_OPEN_KERNEL");
      },
    ]);
    const failedRun = await runtime.runPrompt({
      threadId: thread.id,
      text: "Start a JavaScript calculation before the model fails.",
      model: { provider: "faux-javascript-kernel", id: "faux-1" },
    });

    expect(failedRun).toEqual(
      expect.objectContaining({
        status: "failed",
        error:
          "The model provider call failed. Verify the selected provider and model with Doctor, then retry or choose another configured model.",
      }),
    );
    expect(
      (await processes.list(thread.id)).find(
        (session) => session.runId === failedRun.id,
      ),
    ).toEqual(expect.objectContaining({ status: "cancelled" }));
    await processes.shutdown();
    store.close();
  }, 20_000);
});

function directSandbox(): OsSandboxAdapter {
  return {
    id: "direct-agent-javascript-kernel-test",
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
