import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    expect(toolEvents.map((event) => event.type)).toEqual([
      "tool.admitted",
      "tool.started",
      "tool.completed",
    ]);
    expect(toolEvents.at(-1)?.payload["details"]).toEqual(
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

  it("streams a write-linked diagnostic improvement through one patch call", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-server-lsp-patch-test-"),
    );
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const targetPath = "src/private-server-patch.ts";
    const absoluteTarget = path.join(workspaceRoot, targetPath);
    const source = "export const SERVER_PATCH_PRIVATE: string = 42;\n";
    const updated = "export const SERVER_PATCH_PRIVATE: string = 'fixed';\n";
    await mkdir(path.dirname(absoluteTarget), { recursive: true });
    await writeFile(absoluteTarget, source);
    const sourceSha256 = createHash("sha256").update(source).digest("hex");
    const updatedSha256 = createHash("sha256").update(updated).digest("hex");
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
            enabledTools: ["apply_patch", "lsp_diagnostics"],
          }),
        })
      ).status,
    ).toBe(200);
    const thread = await services.store.createThread({
      title: "Server write-linked diagnostics",
      agentId,
    });
    const provider = fauxProvider({ provider: "faux-server-lsp-patch" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("apply_patch", {
          operation: "replace",
          path: targetPath,
          expectedSha256: sourceSha256,
          edits: [{ oldText: "42", newText: "'fixed'" }],
        }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        expect(JSON.stringify(context.messages)).toContain(
          "Patch diagnostics: improved",
        );
        return fauxAssistantMessage(
          "The patch resolved the TypeScript diagnostic.",
        );
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    services.models.registerProvider(provider.provider);

    const response = await app.request(`/api/threads/${thread.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "Fix the TypeScript diagnostic.",
        model: { provider: "faux-server-lsp-patch", id: "faux-1" },
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('"status":"completed"');
    expect(await readFile(absoluteTarget, "utf8")).toBe(updated);
    const events = await services.store.listEvents(thread.id);
    const patchEvent = events.find(
      (event) =>
        event.type === "tool.completed" &&
        event.payload &&
        !Array.isArray(event.payload) &&
        typeof event.payload === "object" &&
        event.payload["toolName"] === "apply_patch",
    );
    expect(patchEvent?.payload["details"]).toEqual(
      expect.objectContaining({
        afterSha256: updatedSha256,
        diagnostics: expect.objectContaining({
          status: "improved",
          beforeErrorCount: 1,
          afterErrorCount: 0,
          resolvedCount: 1,
        }),
      }),
    );
    expect(JSON.stringify(events)).not.toContain(targetPath);
    expect(JSON.stringify(events)).not.toContain("SERVER_PATCH_PRIVATE");
    expect(JSON.stringify(events)).not.toContain(
      "Type 'number' is not assignable to type 'string'.",
    );
  }, 30_000);

  it("streams a real workspace-confined definition with hash-only evidence", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-server-lsp-definition-test-"),
    );
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const targetPath = "src/private-definition.ts";
    const privatePreview = "privateDefinition";
    await mkdir(path.join(workspaceRoot, "src"), { recursive: true });
    await writeFile(
      path.join(workspaceRoot, targetPath),
      [
        `function ${privatePreview}(value: string): string {`,
        "  return value.trim();",
        "}",
        "",
        `const result = ${privatePreview}(" value ");`,
        "",
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
            enabledTools: ["lsp_definition"],
          }),
        })
      ).status,
    ).toBe(200);
    const thread = await services.store.createThread({
      title: "Server LSP definition",
      agentId,
    });
    const provider = fauxProvider({ provider: "faux-server-definition" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("lsp_definition", {
          path: targetPath,
          line: 5,
          character: 16,
        }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        const messages = JSON.stringify(context.messages);
        expect(messages).toContain(targetPath);
        expect(messages).toContain(privatePreview);
        return fauxAssistantMessage(
          "The standard language server located the definition.",
        );
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    services.models.registerProvider(provider.provider);

    const response = await app.request(`/api/threads/${thread.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "Locate the workspace definition.",
        model: { provider: "faux-server-definition", id: "faux-1" },
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('"status":"completed"');
    const events = await services.store.listEvents(thread.id);
    const definitionEvent = events.find(
      (event) =>
        event.type === "tool.completed" &&
        event.payload &&
        !Array.isArray(event.payload) &&
        typeof event.payload === "object" &&
        event.payload["toolName"] === "lsp_definition",
    );
    expect(definitionEvent?.payload["details"]).toEqual(
      expect.objectContaining({
        kind: "napier.lsp-definition",
        status: "found",
        definitionCount: 1,
        omittedDefinitionCount: 0,
      }),
    );
    expect(JSON.stringify(events)).not.toContain(targetPath);
    expect(JSON.stringify(events)).not.toContain(privatePreview);
  }, 30_000);

  it("streams real workspace-confined references with hash-only evidence", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-server-lsp-references-test-"),
    );
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const sourcePath = "src/private-reference-source.ts";
    const firstPath = "src/private-reference-first.ts";
    const secondPath = "src/private-reference-second.ts";
    const privateSymbol = "serverPrivateReference";
    await mkdir(path.join(workspaceRoot, "src"), { recursive: true });
    await Promise.all([
      writeFile(
        path.join(workspaceRoot, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            strict: true,
            noEmit: true,
            module: "NodeNext",
            moduleResolution: "NodeNext",
          },
        }),
      ),
      writeFile(
        path.join(workspaceRoot, sourcePath),
        [
          `export function ${privateSymbol}(value: string): string {`,
          "  return value.trim();",
          "}",
          "",
          `export const local = ${privateSymbol}(" local ");`,
          "",
        ].join("\n"),
      ),
      writeFile(
        path.join(workspaceRoot, firstPath),
        [
          `import { ${privateSymbol} } from "./private-reference-source.js";`,
          `export const first = ${privateSymbol}(" first ");`,
          "",
        ].join("\n"),
      ),
      writeFile(
        path.join(workspaceRoot, secondPath),
        [
          `import { ${privateSymbol} } from "./private-reference-source.js";`,
          `export const second = ${privateSymbol}(" second ");`,
          "",
        ].join("\n"),
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
            enabledTools: ["lsp_references"],
          }),
        })
      ).status,
    ).toBe(200);
    const thread = await services.store.createThread({
      title: "Server LSP references",
      agentId,
    });
    const provider = fauxProvider({ provider: "faux-server-references" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("lsp_references", {
          path: sourcePath,
          line: 1,
          character: 17,
          includeDeclaration: true,
        }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        const messages = JSON.stringify(context.messages);
        expect(messages).toContain(firstPath);
        expect(messages).toContain(secondPath);
        expect(messages).toContain(privateSymbol);
        return fauxAssistantMessage(
          "The standard language server located the workspace references.",
        );
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    services.models.registerProvider(provider.provider);

    const response = await app.request(`/api/threads/${thread.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "Locate the workspace references.",
        model: { provider: "faux-server-references", id: "faux-1" },
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('"status":"completed"');
    const events = await services.store.listEvents(thread.id);
    const referenceEvent = events.find(
      (event) =>
        event.type === "tool.completed" &&
        event.payload &&
        !Array.isArray(event.payload) &&
        typeof event.payload === "object" &&
        event.payload["toolName"] === "lsp_references",
    );
    expect(referenceEvent?.payload["details"]).toEqual(
      expect.objectContaining({
        kind: "napier.lsp-references",
        status: "found",
        includeDeclaration: true,
        referenceCount: 6,
        omittedReferenceCount: 0,
      }),
    );
    const durable = JSON.stringify(events);
    expect(durable).not.toContain(sourcePath);
    expect(durable).not.toContain(firstPath);
    expect(durable).not.toContain(secondPath);
    expect(durable).not.toContain(privateSymbol);
  }, 30_000);
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
