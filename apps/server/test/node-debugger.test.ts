import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type {
  WorkspaceProcessOutput,
  WorkspaceProcessSession,
} from "@napier/contracts";
import type { OsSandboxAdapter } from "@napier/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { createApp, createServices } from "../src/app.js";

const temporaryRoots: string[] = [];
const openServices: Awaited<ReturnType<typeof createServices>>[] = [];

afterEach(async () => {
  for (const services of openServices.splice(0)) {
    await services.workspaceProcesses.shutdown();
    await services.extensions.shutdown();
    services.store.close();
  }
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Node debugger HTTP Agent path", () => {
  it("streams a real DAP pause, evaluation, step, and completion with hash-only history", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-server-node-debugger-"),
    );
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(path.join(workspaceRoot, "src"), { recursive: true });
    await writeFile(
      path.join(workspaceRoot, "src/debug-target.mjs"),
      [
        "function serverCalculation(input) {",
        "  const doubled = input * 2;",
        "  const adjusted = doubled + 1;",
        "  return adjusted;",
        "}",
        "globalThis.PRIVATE_SERVER_DEBUG = serverCalculation(20);",
      ].join("\n"),
    );
    const services = await createServices({
      workspaceRoot,
      dataRoot: path.join(root, "data"),
      sandbox: directSandbox(),
    });
    openServices.push(services);
    const app = createApp(services);
    const agentId = services.store.listAgents()[0]!.id;
    expect(
      (
        await app.request(`/api/agents/${agentId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            toolPolicy: "workspace",
            enabledTools: ["node_debugger"],
          }),
        })
      ).status,
    ).toBe(200);
    const thread = await services.store.createThread({
      title: "Server Node debugger",
      agentId,
    });
    const provider = fauxProvider({ provider: "faux-server-node-debugger" });
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
        const frameId = messages.match(/#(\d+) serverCalculation/u)?.[1];
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
        return fauxAssistantMessage(
          fauxToolCall("node_debugger", {
            action: "continue",
            processId,
          }),
          { stopReason: "toolUse" },
        );
      },
      fauxAssistantMessage("The server DAP path completed with exit code 0."),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    services.models.registerProvider(provider.provider);

    const response = await app.request(`/api/threads/${thread.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "Debug the real server fixture, evaluate the local input, step, and complete.",
        model: { provider: "faux-server-node-debugger", id: "faux-1" },
      }),
    });

    expect(response.status).toBe(200);
    const stream = await response.text();
    expect(stream).toContain("event: done");
    expect(stream).toContain('"status":"completed"');
    const events = await services.store.listEvents(thread.id);
    const completed = events.filter(
      (event) =>
        event.type === "tool.completed" &&
        record(event.payload)?.["toolName"] === "node_debugger",
    );
    expect(completed).toHaveLength(4);
    expect(completed[0]?.payload["details"]).toEqual(
      expect.objectContaining({
        kind: "napier.node-debugger",
        action: "launch",
        state: "paused",
        reason: "breakpoint",
        frameCount: 2,
        moduleCount: 1,
      }),
    );
    expect(completed.at(-1)?.payload["details"]).toEqual(
      expect.objectContaining({
        action: "continue",
        state: "terminated",
        exitCode: 0,
      }),
    );
    const processResponse = await app.request(
      `/api/threads/${thread.id}/processes`,
    );
    expect(processResponse.status).toBe(200);
    const [debugSession] =
      (await processResponse.json()) as WorkspaceProcessSession[];
    expect(debugSession).toEqual(
      expect.objectContaining({
        runtime: "node",
        outputAvailable: false,
        stdinOpen: false,
        status: "cancelled",
      }),
    );
    const outputResponse = await app.request(
      `/api/threads/${thread.id}/processes/${debugSession?.id}/output`,
    );
    expect(outputResponse.status).toBe(200);
    expect((await outputResponse.json()) as WorkspaceProcessOutput).toEqual(
      expect.objectContaining({
        outputAvailable: false,
        chunks: [],
      }),
    );
    const durableTools = JSON.stringify(
      events.filter(
        (event) =>
          event.type.startsWith("tool.") ||
          event.type.startsWith("workspace.process."),
      ),
    );
    expect(durableTools).not.toContain("debug-target.mjs");
    expect(durableTools).not.toContain("PRIVATE_SERVER_DEBUG");
    expect(durableTools).not.toContain("input + 1");
    expect(durableTools).not.toContain("21 (number)");
  }, 20_000);
});

function directSandbox(): OsSandboxAdapter {
  return {
    id: "direct-server-node-debugger-test",
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
