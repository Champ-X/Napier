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

describe("LSP Code Actions HTTP Agent path", () => {
  it("streams a real missing-import preview with hash-only durable evidence", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-server-code-actions-"),
    );
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const targetPath = "src/private-usage.ts";
    const source = 'export const title = formatTitle(" value ");\n';
    await mkdir(path.join(workspaceRoot, "src"), { recursive: true });
    await Promise.all([
      writeFile(path.join(workspaceRoot, targetPath), source),
      writeFile(
        path.join(workspaceRoot, "src/private-definition.ts"),
        [
          "export function formatTitle(value: string): string {",
          "  return value.trim();",
          "}",
          "",
        ].join("\n"),
      ),
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
    expect(
      (
        await app.request(`/api/agents/${agentId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            toolPolicy: "workspace",
            enabledTools: ["lsp_code_actions"],
          }),
        })
      ).status,
    ).toBe(200);
    const thread = await services.store.createThread({
      title: "Server LSP Code Actions",
      agentId,
    });
    const provider = fauxProvider({
      provider: "faux-server-lsp-code-actions",
    });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("lsp_code_actions", {
          path: targetPath,
          line: 1,
          character: 22,
        }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        const messages = JSON.stringify(context.messages);
        expect(messages).toContain("Preferred: true");
        expect(messages).toContain("Command ignored: true");
        expect(messages).toContain("private-definition");
        expect(messages).toContain("formatTitle");
        return fauxAssistantMessage(
          "The language server returned bounded quick-fix alternatives.",
        );
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    services.models.registerProvider(provider.provider);

    const response = await app.request(`/api/threads/${thread.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "Preview the missing-import quick fix through standard LSP.",
        model: { provider: "faux-server-lsp-code-actions", id: "faux-1" },
      }),
    });

    expect(response.status).toBe(200);
    const stream = await response.text();
    expect(stream).toContain("event: done");
    expect(stream).toContain('"status":"completed"');
    const events = await services.store.listEvents(thread.id);
    const completed = events.find(
      (event) =>
        event.type === "tool.completed" &&
        event.payload &&
        !Array.isArray(event.payload) &&
        typeof event.payload === "object" &&
        event.payload["toolName"] === "lsp_code_actions",
    );
    expect(completed?.payload["details"]).toEqual(
      expect.objectContaining({
        kind: "napier.lsp-code-actions",
        status: "found",
        diagnosticCount: 1,
        actionCount: 2,
        preferredActionCount: 1,
        fileCount: 1,
        editCount: 2,
      }),
    );
    const durable = JSON.stringify(events);
    for (const secret of [
      targetPath,
      "private-definition",
      "formatTitle",
      "Cannot find name",
      "_typescript.applyCodeActionCommand",
    ]) {
      expect(durable).not.toContain(secret);
    }
    expect(await readFile(path.join(workspaceRoot, targetPath), "utf8")).toBe(
      source,
    );
  }, 30_000);
});

function directSandbox(): OsSandboxAdapter {
  return {
    id: "server-code-actions-direct-test",
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
