import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
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

  it("applies a real coordinated multi-file rename through public SSE", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-server-rename-apply-"),
    );
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const sourcePath = "src/private-definition.ts";
    const consumerPath = "src/private-consumer.ts";
    const oldName = "privateCurrentName";
    const newName = "privateCanonicalName";
    const sourceBefore = [
      `export function ${oldName}(value: string): string {`,
      "  return value.trim();",
      "}",
      "",
    ].join("\n");
    const consumerBefore = [
      `import { ${oldName} } from "./private-definition.js";`,
      `export const result = ${oldName}(" value ");`,
      "",
    ].join("\n");
    await mkdir(path.join(workspaceRoot, "src"), { recursive: true });
    await Promise.all([
      writeFile(path.join(workspaceRoot, sourcePath), sourceBefore),
      writeFile(path.join(workspaceRoot, consumerPath), consumerBefore),
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
            enabledTools: ["lsp_rename", "lsp_rename_apply"],
          }),
        })
      ).status,
    ).toBe(200);
    const thread = await services.store.createThread({
      title: "Server direct LSP rename",
      agentId,
    });
    let applyPreviewId = "";
    const provider = fauxProvider({ provider: "faux-server-rename-apply" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("lsp_rename", {
          path: sourcePath,
          line: 1,
          character: 17,
          newName,
        }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        const messages = JSON.stringify(context.messages);
        const previewId = messages.match(
          /Apply preview ID: (renamepreview_[a-z0-9]+)/u,
        )?.[1];
        expect(previewId).toMatch(/^renamepreview_/u);
        applyPreviewId = previewId ?? "";
        return fauxAssistantMessage(
          fauxToolCall("lsp_rename_apply", { previewId }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        expect(JSON.stringify(context.messages)).toContain(
          "LSP rename apply: applied",
        );
        return fauxAssistantMessage(
          "The coordinated workspace rename completed.",
        );
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    services.models.registerProvider(provider.provider);

    const response = await app.request(`/api/threads/${thread.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "Apply the requested semantic rename across the workspace.",
        model: { provider: "faux-server-rename-apply", id: "faux-1" },
      }),
    });

    expect(response.status).toBe(200);
    const stream = await response.text();
    expect(stream).toContain("event: done");
    expect(stream).toContain('"status":"completed"');
    expect(await readFile(path.join(workspaceRoot, sourcePath), "utf8")).toBe(
      sourceBefore.replaceAll(oldName, newName),
    );
    expect(await readFile(path.join(workspaceRoot, consumerPath), "utf8")).toBe(
      consumerBefore.replaceAll(oldName, newName),
    );
    const events = await services.store.listEvents(thread.id);
    const apply = events.find(
      (event) =>
        event.type === "tool.completed" &&
        event.payload &&
        !Array.isArray(event.payload) &&
        typeof event.payload === "object" &&
        event.payload["toolName"] === "lsp_rename_apply",
    );
    expect(apply?.payload["details"]).toEqual(
      expect.objectContaining({
        kind: "napier.lsp-rename-apply",
        status: "applied",
        postcondition: "verified",
        fileCount: 2,
        committedFileCount: 2,
        diagnostics: expect.objectContaining({
          status: "clean",
          fileCount: 2,
        }),
      }),
    );
    const durable = JSON.stringify(events);
    for (const secret of [
      sourcePath,
      consumerPath,
      oldName,
      newName,
      sourceBefore,
      consumerBefore,
      applyPreviewId,
    ]) {
      expect(durable).not.toContain(secret);
    }
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
