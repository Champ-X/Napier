import { spawn } from "node:child_process";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

describe("LSP rename HTTP Agent path", () => {
  it("streams a real complete preview with hash-only durable evidence", async () => {
    const workspaceRoot = await realpath(
      fileURLToPath(
        new URL("../../../examples/lsp-references/", import.meta.url),
      ),
    );
    const stateRoot = await mkdtemp(
      path.join(tmpdir(), "napier-server-lsp-rename-"),
    );
    temporaryRoots.push(stateRoot);
    const paths = ["definition.ts", "first.ts", "second.ts"];
    const oldName = "normalizeTitle";
    const newName = "canonicalizeTitle";
    const before = await Promise.all(
      paths.map((file) => readFile(path.join(workspaceRoot, file), "utf8")),
    );
    const services = await createServices({
      workspaceRoot,
      dataRoot: path.join(stateRoot, "data"),
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
            enabledTools: ["lsp_rename"],
          }),
        })
      ).status,
    ).toBe(200);
    const thread = await services.store.createThread({
      title: "Server LSP rename",
      agentId,
    });
    const provider = fauxProvider({ provider: "faux-server-lsp-rename" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("lsp_rename", {
          path: paths[0],
          line: 1,
          character: 17,
          newName,
        }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        const messages = JSON.stringify(context.messages);
        expect(messages).toContain(paths[1]);
        expect(messages).toContain(paths[2]);
        expect(messages).toContain(oldName);
        expect(messages).toContain(newName);
        return fauxAssistantMessage(
          "The language server returned the complete rename preview.",
        );
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    services.models.registerProvider(provider.provider);

    const response = await app.request(`/api/threads/${thread.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "Preview the workspace rename through standard LSP.",
        model: { provider: "faux-server-lsp-rename", id: "faux-1" },
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
        event.payload["toolName"] === "lsp_rename",
    );
    expect(completed?.payload["details"]).toEqual(
      expect.objectContaining({
        kind: "napier.lsp-rename",
        status: "found",
        complete: true,
        fileCount: 3,
        editCount: 6,
        previewBytes: 186,
      }),
    );
    const durable = JSON.stringify(events);
    for (const secret of [...paths, oldName, newName]) {
      expect(durable).not.toContain(secret);
    }
    expect(
      await Promise.all(
        paths.map((file) => readFile(path.join(workspaceRoot, file), "utf8")),
      ),
    ).toEqual(before);
  }, 30_000);
});

function directSandbox(): OsSandboxAdapter {
  return {
    id: "server-rename-direct-test",
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
