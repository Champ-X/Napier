import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import {
  AgentRuntime,
  createPlatformSandboxAdapter,
  LocalStore,
  ModelRegistry,
} from "../src/index.js";

const describeLive =
  process.env["NAPIER_LIVE_LSP_SMOKE"] === "1" ? describe : describe.skip;
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describeLive("live LSP diagnostics smoke", () => {
  it("diagnoses a real TypeScript error through the Agent sandbox", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(tmpdir(), "napier-live-lsp-workspace-"),
    );
    temporaryRoots.push(workspaceRoot);
    const targetPath = "semantic-error.ts";
    const source = "const LIVE_PRIVATE_VALUE: string = 42;\n";
    await Promise.all([
      writeFile(
        path.join(workspaceRoot, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { strict: true, noEmit: true } }),
      ),
      writeFile(path.join(workspaceRoot, targetPath), source),
    ]);
    const store = new LocalStore({
      workspaceRoot,
      dataRoot: path.join(workspaceRoot, ".napier"),
    });
    await store.initialize();
    const agent = await store.updateAgent(store.listAgents()[0]!.id, {
      toolPolicy: "workspace",
      enabledTools: ["lsp_diagnostics"],
    });
    const thread = await store.createThread({
      title: "Live LSP smoke",
      agentId: agent.id,
    });
    const provider = fauxProvider({ provider: "live-lsp-smoke" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("lsp_diagnostics", { path: targetPath }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        const messages = JSON.stringify(context.messages);
        expect(messages).toContain("TS2322");
        expect(messages).toContain(
          "Type 'number' is not assignable to type 'string'.",
        );
        return fauxAssistantMessage(
          "The real language server reported TS2322.",
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
      createPlatformSandboxAdapter(),
    );

    const run = await runtime.runPrompt({
      threadId: thread.id,
      text: "Diagnose the TypeScript file through LSP.",
      model: { provider: "live-lsp-smoke", id: "faux-1" },
    });

    expect(run.status).toBe("completed");
    const toolEvents = (await store.listEvents(thread.id)).filter(
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
        status: "diagnostics",
        diagnosticCount: 1,
        errorCount: 1,
        sandbox: "macos-sandbox-exec",
        languageServerVersion: "5.3.0",
        typescriptVersion: "5.9.3",
      }),
    );
    expect(JSON.stringify(toolEvents)).not.toContain(targetPath);
    expect(JSON.stringify(toolEvents)).not.toContain(source.trim());
    expect(JSON.stringify(toolEvents)).not.toContain(
      "Type 'number' is not assignable to type 'string'.",
    );
    store.close();
  }, 30_000);

  it("resolves the fixed cross-file definition through the Agent sandbox", async () => {
    const workspaceRoot = await realpath(
      fileURLToPath(
        new URL("../../../examples/lsp-definition/", import.meta.url),
      ),
    );
    const stateRoot = await mkdtemp(
      path.join(tmpdir(), "napier-live-lsp-definition-"),
    );
    temporaryRoots.push(stateRoot);
    const sourcePath = "usage.ts";
    const targetPath = "definition.ts";
    const sourcePreview = "formatTitle";
    const store = new LocalStore({
      workspaceRoot,
      dataRoot: path.join(stateRoot, "data"),
    });
    await store.initialize();
    const agent = await store.updateAgent(store.listAgents()[0]!.id, {
      toolPolicy: "workspace",
      enabledTools: ["lsp_definition"],
    });
    const thread = await store.createThread({
      title: "Live LSP definition smoke",
      agentId: agent.id,
    });
    const provider = fauxProvider({ provider: "live-lsp-definition-smoke" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("lsp_definition", {
          path: sourcePath,
          line: 3,
          character: 22,
        }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        const messages = JSON.stringify(context.messages);
        expect(messages).toContain(targetPath);
        expect(messages).toContain(sourcePreview);
        return fauxAssistantMessage(
          "The real language server resolved the workspace definition.",
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
      createPlatformSandboxAdapter(),
    );

    const run = await runtime.runPrompt({
      threadId: thread.id,
      text: "Resolve the TypeScript definition through standard LSP.",
      model: { provider: "live-lsp-definition-smoke", id: "faux-1" },
    });

    expect(run.status).toBe("completed");
    const events = await store.listEvents(thread.id);
    const completed = events.find(
      (event) =>
        event.type === "tool.completed" &&
        event.payload &&
        !Array.isArray(event.payload) &&
        typeof event.payload === "object" &&
        event.payload["toolName"] === "lsp_definition",
    );
    expect(completed?.payload["details"]).toEqual(
      expect.objectContaining({
        status: "found",
        definitionCount: 1,
        omittedDefinitionCount: 0,
        sandbox: "macos-sandbox-exec",
        languageServerVersion: "5.3.0",
        typescriptVersion: "5.9.3",
      }),
    );
    const durable = JSON.stringify(events);
    expect(durable).not.toContain(sourcePath);
    expect(durable).not.toContain(targetPath);
    expect(durable).not.toContain(sourcePreview);
    store.close();
  }, 30_000);

  it("finds fixed multi-file references through the Agent sandbox", async () => {
    const workspaceRoot = await realpath(
      fileURLToPath(
        new URL("../../../examples/lsp-references/", import.meta.url),
      ),
    );
    const stateRoot = await mkdtemp(
      path.join(tmpdir(), "napier-live-lsp-references-"),
    );
    temporaryRoots.push(stateRoot);
    const sourcePath = "definition.ts";
    const firstPath = "first.ts";
    const secondPath = "second.ts";
    const sourcePreview = "normalizeTitle";
    const store = new LocalStore({
      workspaceRoot,
      dataRoot: path.join(stateRoot, "data"),
    });
    await store.initialize();
    const agent = await store.updateAgent(store.listAgents()[0]!.id, {
      toolPolicy: "workspace",
      enabledTools: ["lsp_references"],
    });
    const thread = await store.createThread({
      title: "Live LSP references smoke",
      agentId: agent.id,
    });
    const provider = fauxProvider({ provider: "live-lsp-references-smoke" });
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
        expect(messages).toContain(sourcePreview);
        return fauxAssistantMessage(
          "The real language server resolved the workspace references.",
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
      createPlatformSandboxAdapter(),
    );

    const run = await runtime.runPrompt({
      threadId: thread.id,
      text: "Find the TypeScript references through standard LSP.",
      model: { provider: "live-lsp-references-smoke", id: "faux-1" },
    });

    expect(run.status).toBe("completed");
    const events = await store.listEvents(thread.id);
    const completed = events.find(
      (event) =>
        event.type === "tool.completed" &&
        event.payload &&
        !Array.isArray(event.payload) &&
        typeof event.payload === "object" &&
        event.payload["toolName"] === "lsp_references",
    );
    expect(completed?.payload["details"]).toEqual(
      expect.objectContaining({
        status: "found",
        includeDeclaration: true,
        referenceCount: 6,
        omittedReferenceCount: 0,
        sandbox: "macos-sandbox-exec",
        languageServerVersion: "5.3.0",
        typescriptVersion: "5.9.3",
      }),
    );
    const durable = JSON.stringify(events);
    expect(durable).not.toContain(sourcePath);
    expect(durable).not.toContain(firstPath);
    expect(durable).not.toContain(secondPath);
    expect(durable).not.toContain(sourcePreview);
    store.close();
  }, 30_000);

  it("previews a fixed multi-file rename through the Agent sandbox", async () => {
    const workspaceRoot = await realpath(
      fileURLToPath(
        new URL("../../../examples/lsp-references/", import.meta.url),
      ),
    );
    const stateRoot = await mkdtemp(
      path.join(tmpdir(), "napier-live-lsp-rename-"),
    );
    temporaryRoots.push(stateRoot);
    const sourcePath = "definition.ts";
    const firstPath = "first.ts";
    const secondPath = "second.ts";
    const oldName = "normalizeTitle";
    const newName = "canonicalizeTitle";
    const before = await Promise.all(
      [sourcePath, firstPath, secondPath].map((file) =>
        readFile(path.join(workspaceRoot, file), "utf8"),
      ),
    );
    const store = new LocalStore({
      workspaceRoot,
      dataRoot: path.join(stateRoot, "data"),
    });
    await store.initialize();
    const agent = await store.updateAgent(store.listAgents()[0]!.id, {
      toolPolicy: "workspace",
      enabledTools: ["lsp_rename"],
    });
    const thread = await store.createThread({
      title: "Live LSP rename smoke",
      agentId: agent.id,
    });
    const provider = fauxProvider({ provider: "live-lsp-rename-smoke" });
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
        expect(messages).toContain(firstPath);
        expect(messages).toContain(secondPath);
        expect(messages).toContain(oldName);
        expect(messages).toContain(newName);
        return fauxAssistantMessage(
          "The real language server returned the complete rename preview.",
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
      createPlatformSandboxAdapter(),
    );

    const run = await runtime.runPrompt({
      threadId: thread.id,
      text: "Preview the TypeScript rename through standard LSP.",
      model: { provider: "live-lsp-rename-smoke", id: "faux-1" },
    });

    expect(run.status).toBe("completed");
    const events = await store.listEvents(thread.id);
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
        status: "found",
        complete: true,
        fileCount: 3,
        editCount: 6,
        sandbox: "macos-sandbox-exec",
        languageServerVersion: "5.3.0",
        typescriptVersion: "5.9.3",
      }),
    );
    const durable = JSON.stringify(events);
    expect(durable).not.toContain(sourcePath);
    expect(durable).not.toContain(firstPath);
    expect(durable).not.toContain(secondPath);
    expect(durable).not.toContain(oldName);
    expect(durable).not.toContain(newName);
    expect(
      await Promise.all(
        [sourcePath, firstPath, secondPath].map((file) =>
          readFile(path.join(workspaceRoot, file), "utf8"),
        ),
      ),
    ).toEqual(before);
    store.close();
  }, 30_000);

  it("fixes TS2322 with automatic before and after diagnostics", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(tmpdir(), "napier-live-lsp-patch-workspace-"),
    );
    temporaryRoots.push(workspaceRoot);
    const targetPath = "semantic-error.ts";
    const source = "const LIVE_PATCH_PRIVATE_VALUE: string = 42;\n";
    const updated = "const LIVE_PATCH_PRIVATE_VALUE: string = 'fixed';\n";
    await Promise.all([
      writeFile(
        path.join(workspaceRoot, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { strict: true, noEmit: true } }),
      ),
      writeFile(path.join(workspaceRoot, targetPath), source),
    ]);
    const sourceSha256 = createHash("sha256").update(source).digest("hex");
    const store = new LocalStore({
      workspaceRoot,
      dataRoot: path.join(workspaceRoot, ".napier"),
    });
    await store.initialize();
    const agent = await store.updateAgent(store.listAgents()[0]!.id, {
      toolPolicy: "workspace",
      enabledTools: ["apply_patch", "lsp_diagnostics"],
    });
    const thread = await store.createThread({
      title: "Live write-linked LSP smoke",
      agentId: agent.id,
    });
    const provider = fauxProvider({ provider: "live-lsp-patch-smoke" });
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
        const messages = JSON.stringify(context.messages);
        expect(messages).toContain("Patch diagnostics: improved");
        expect(messages).toContain("Errors: 1 -> 0");
        return fauxAssistantMessage(
          "The real language server verified the fix.",
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
      createPlatformSandboxAdapter(),
    );

    const run = await runtime.runPrompt({
      threadId: thread.id,
      text: "Fix TS2322 and verify the result automatically.",
      model: { provider: "live-lsp-patch-smoke", id: "faux-1" },
    });

    expect(run.status).toBe("completed");
    expect(await readFile(path.join(workspaceRoot, targetPath), "utf8")).toBe(
      updated,
    );
    const events = await store.listEvents(thread.id);
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
        diagnostics: expect.objectContaining({
          status: "improved",
          beforeErrorCount: 1,
          afterErrorCount: 0,
          resolvedCount: 1,
        }),
      }),
    );
    expect(JSON.stringify(events)).not.toContain(targetPath);
    expect(JSON.stringify(events)).not.toContain("LIVE_PATCH_PRIVATE_VALUE");
    store.close();
  }, 30_000);
});
