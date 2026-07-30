import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
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

describe("JavaScript kernel HTTP Agent path", () => {
  it("streams persistent evaluations with hash-only durable evidence", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-server-js-kernel-"));
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot, { recursive: true });
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
            enabledTools: ["javascript_kernel"],
          }),
        })
      ).status,
    ).toBe(200);
    const thread = await services.store.createThread({
      title: "Server JavaScript kernel",
      agentId,
    });
    const provider = fauxProvider({ provider: "faux-server-js-kernel" });
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
        return fauxAssistantMessage(
          fauxToolCall("javascript_kernel", {
            action: "evaluate",
            processId,
            code: 'const PRIVATE_SERVER_VALUE = 21; console.log("PRIVATE_SERVER_CONSOLE"); PRIVATE_SERVER_VALUE * 2',
          }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        const messages = JSON.stringify(context.messages);
        const processId = messages.match(/process_[a-z0-9]{20}/u)?.[0];
        expect(messages).toContain("PRIVATE_SERVER_CONSOLE");
        expect(messages).toContain("VALUE (untrusted live output)\\n42");
        return fauxAssistantMessage(
          fauxToolCall("javascript_kernel", {
            action: "cancel",
            processId,
          }),
          { stopReason: "toolUse" },
        );
      },
      fauxAssistantMessage(
        "The persistent JavaScript session returned 42 and was closed.",
      ),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    services.models.registerProvider(provider.provider);

    const response = await app.request(`/api/threads/${thread.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "Use one persistent JavaScript session for this calculation.",
        model: { provider: "faux-server-js-kernel", id: "faux-1" },
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
        record(event.payload)?.["toolName"] === "javascript_kernel",
    );
    expect(completed).toHaveLength(3);
    expect(completed[1]?.payload["details"]).toEqual(
      expect.objectContaining({
        kind: "napier.javascript-kernel",
        action: "evaluate",
        evaluationStatus: "ok",
        processStatus: "running",
        valueType: "number",
        consoleCount: 1,
      }),
    );
    const processResponse = await app.request(
      `/api/threads/${thread.id}/processes`,
    );
    expect(processResponse.status).toBe(200);
    const [kernelSession] =
      (await processResponse.json()) as WorkspaceProcessSession[];
    expect(kernelSession).toEqual(
      expect.objectContaining({
        outputAvailable: false,
        stdinOpen: false,
      }),
    );
    const outputResponse = await app.request(
      `/api/threads/${thread.id}/processes/${kernelSession?.id}/output`,
    );
    expect(outputResponse.status).toBe(200);
    expect((await outputResponse.json()) as WorkspaceProcessOutput).toEqual(
      expect.objectContaining({
        outputAvailable: false,
        chunks: [],
      }),
    );
    const durable = JSON.stringify(events);
    expect(durable).not.toContain("PRIVATE_SERVER_VALUE");
    expect(durable).not.toContain("PRIVATE_SERVER_CONSOLE");
    expect(durable).not.toContain("untrusted live output");
  }, 20_000);
});

function directSandbox(): OsSandboxAdapter {
  return {
    id: "direct-server-javascript-kernel-test",
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
