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

import type { OsSandboxAdapter } from "@napier/runtime";

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

describe("LSP diagnostics HTTP Agent path", () => {
  it("streams diagnostics through the public message endpoint with hash-only Ledger evidence", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-server-lsp-test-"));
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot, { recursive: true });
    const targetPath = "src/private-server-diagnostic.ts";
    await mkdir(path.join(workspaceRoot, "src"), { recursive: true });
    await writeFile(
      path.join(workspaceRoot, targetPath),
      "const SERVER_PRIVATE_VALUE: string = 42;\n",
    );
    const services = await createServices({
      workspaceRoot,
      dataRoot: path.join(root, "data"),
      sandbox: directSandbox(),
    });
    openServices.push(services);
    const app = createApp(services);
    const agentId = services.store.listAgents()[0]!.id;
    const updateResponse = await app.request(`/api/agents/${agentId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toolPolicy: "workspace",
        enabledTools: ["lsp_diagnostics"],
      }),
    });
    expect(updateResponse.status).toBe(200);
    const agent = services.store.getAgent(agentId);
    expect(agent.enabledTools).toEqual(["lsp_diagnostics"]);
    const thread = await services.store.createThread({
      title: "Server LSP diagnostics",
      agentId: agent.id,
    });
    const provider = fauxProvider({ provider: "faux-server-lsp" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("lsp_diagnostics", { path: targetPath }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        expect(JSON.stringify(context.messages)).toContain("TS2322");
        expect(JSON.stringify(context.messages)).toContain(
          "Type 'number' is not assignable to type 'string'.",
        );
        return fauxAssistantMessage("The LSP diagnostic was observed.");
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    services.models.registerProvider(provider.provider);

    const response = await app.request(`/api/threads/${thread.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "Diagnose the source through LSP.",
        model: { provider: "faux-server-lsp", id: "faux-1" },
      }),
    });

    expect(response.status).toBe(200);
    const stream = await response.text();
    expect(stream).toContain("event: done");
    expect(stream).toContain('"status":"completed"');
    expect(stream).toContain("tool.completed");
    const toolEvents = (await services.store.listEvents(thread.id)).filter(
      (event) =>
        event.type.startsWith("tool.") &&
        event.payload &&
        !Array.isArray(event.payload) &&
        typeof event.payload === "object" &&
        event.payload["toolName"] === "lsp_diagnostics",
    );
    expect(toolEvents).toHaveLength(2);
    expect(toolEvents[1]?.payload["details"]).toEqual(
      expect.objectContaining({
        diagnosticCount: 1,
        errorCount: 1,
      }),
    );
    expect(JSON.stringify(toolEvents)).not.toContain(targetPath);
    expect(JSON.stringify(toolEvents)).not.toContain(
      "Type 'number' is not assignable to type 'string'.",
    );
    expect(JSON.stringify(toolEvents)).not.toContain("SERVER_PRIVATE_VALUE");
  });
});

function directSandbox(): OsSandboxAdapter {
  return {
    id: "server-lsp-direct-test",
    async launch(request) {
      const child = spawn(request.command, request.args, {
        cwd: request.cwd,
        env: { ...process.env, ...request.env },
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
        terminate: async () => {
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
