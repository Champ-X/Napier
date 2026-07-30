import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
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

describe("LSP symbols HTTP Agent path", () => {
  it("streams a real semantic outline with hash-only durable evidence", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-server-symbols-"));
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const targetPath = "src/private-server-formatter.ts";
    const privateName = "PrivateServerFormatter";
    const source = [
      `export class ${privateName} {`,
      "  format(value: string): string {",
      "    return value.trim();",
      "  }",
      "}",
      "",
    ].join("\n");
    await mkdir(path.join(workspaceRoot, "src"), { recursive: true });
    await Promise.all([
      writeFile(path.join(workspaceRoot, targetPath), source),
      writeFile(
        path.join(workspaceRoot, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            strict: true,
            noEmit: true,
            module: "NodeNext",
            moduleResolution: "NodeNext",
          },
          include: ["src/**/*.ts"],
        }),
      ),
    ]);
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
        enabledTools: ["lsp_symbols"],
      }),
    });
    expect(updateResponse.status).toBe(200);
    expect(services.store.getAgent(agentId).enabledTools).toEqual([
      "lsp_symbols",
    ]);
    const thread = await services.store.createThread({
      title: "Server LSP symbols",
      agentId,
    });
    const provider = fauxProvider({ provider: "faux-server-lsp-symbols" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("lsp_symbols", {
          path: targetPath,
          maxSymbols: 20,
        }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        const messages = JSON.stringify(context.messages);
        expect(messages).toContain(privateName);
        expect(messages).toContain("method");
        expect(messages).toContain("Range: 2:3-4:4");
        return fauxAssistantMessage(
          "The language server returned the semantic document outline.",
        );
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    services.models.registerProvider(provider.provider);

    const response = await app.request(`/api/threads/${thread.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "Inspect this document through semantic LSP symbols.",
        model: { provider: "faux-server-lsp-symbols", id: "faux-1" },
      }),
    });

    expect(response.status).toBe(200);
    const stream = await response.text();
    expect(stream).toContain("event: done");
    expect(stream).toContain('"status":"completed"');
    expect(stream).toContain("tool.completed");
    const events = await services.store.listEvents(thread.id);
    const completed = events.find(
      (event) =>
        event.type === "tool.completed" &&
        record(event.payload)?.["toolName"] === "lsp_symbols",
    );
    expect(completed?.payload["details"]).toEqual(
      expect.objectContaining({
        kind: "napier.lsp-symbols",
        status: "found",
        complete: true,
        responseShape: "hierarchical",
        symbolCount: 2,
        omittedSymbolCount: 0,
        maxDepth: 1,
      }),
    );
    const durable = JSON.stringify(events);
    expect(durable).not.toContain(targetPath);
    expect(durable).not.toContain(privateName);
    expect(durable).not.toContain("return value.trim()");
    expect(await readFile(path.join(workspaceRoot, targetPath), "utf8")).toBe(
      source,
    );
  }, 30_000);
});

function directSandbox(): OsSandboxAdapter {
  return {
    id: "server-symbols-direct-test",
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
