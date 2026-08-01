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

  it("reuses one real sandboxed language server across Agent tools", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(tmpdir(), "napier-live-lsp-session-workspace-"),
    );
    temporaryRoots.push(workspaceRoot);
    const targetPath = "persistent-session.ts";
    const source = [
      "export class PersistentSession {",
      "  value(): number {",
      "    return 1;",
      "  }",
      "}",
      "",
    ].join("\n");
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
      enabledTools: ["lsp_symbols", "lsp_diagnostics"],
    });
    const thread = await store.createThread({
      title: "Live persistent LSP Session",
      agentId: agent.id,
    });
    const provider = fauxProvider({ provider: "live-lsp-session-smoke" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("lsp_symbols", { path: targetPath, maxSymbols: 20 }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        fauxToolCall("lsp_diagnostics", { path: targetPath }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        "The same sandboxed language server inspected symbols and diagnostics.",
      ),
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
      text: "Inspect symbols and diagnostics through one LSP Session.",
      model: { provider: "live-lsp-session-smoke", id: "faux-1" },
    });

    expect(run.status).toBe("completed");
    const completed = (await store.listEvents(thread.id)).filter(
      (event) =>
        event.type === "tool.completed" &&
        event.payload &&
        !Array.isArray(event.payload) &&
        typeof event.payload === "object" &&
        (event.payload["toolName"] === "lsp_symbols" ||
          event.payload["toolName"] === "lsp_diagnostics"),
    );
    expect(completed).toHaveLength(2);
    const firstDetails =
      completed[0]?.payload &&
      !Array.isArray(completed[0].payload) &&
      typeof completed[0].payload === "object" &&
      completed[0].payload["details"] &&
      !Array.isArray(completed[0].payload["details"]) &&
      typeof completed[0].payload["details"] === "object"
        ? completed[0].payload["details"]
        : {};
    const secondDetails =
      completed[1]?.payload &&
      !Array.isArray(completed[1].payload) &&
      typeof completed[1].payload === "object" &&
      completed[1].payload["details"] &&
      !Array.isArray(completed[1].payload["details"]) &&
      typeof completed[1].payload["details"] === "object"
        ? completed[1].payload["details"]
        : {};
    expect(firstDetails).toEqual(
      expect.objectContaining({
        sessionMode: "run_persistent",
        sessionReused: false,
        sessionOperation: 1,
      }),
    );
    expect(secondDetails).toEqual(
      expect.objectContaining({
        sessionMode: "run_persistent",
        sessionReused: true,
        sessionOperation: 2,
        sessionIdSha256: firstDetails["sessionIdSha256"],
      }),
    );
    expect(JSON.stringify(completed)).not.toContain(targetPath);
    expect(JSON.stringify(completed)).not.toContain("PersistentSession");
    store.close();
  }, 30_000);

  it("returns real semantic document symbols through the Agent sandbox", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(tmpdir(), "napier-live-lsp-symbols-workspace-"),
    );
    temporaryRoots.push(workspaceRoot);
    const targetPath = "private-formatter.ts";
    const privateName = "LivePrivateFormatter";
    const source = [
      `export class ${privateName} {`,
      "  format(value: string): string {",
      "    return value.trim();",
      "  }",
      "}",
      "",
    ].join("\n");
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
      enabledTools: ["lsp_symbols"],
    });
    const thread = await store.createThread({
      title: "Live LSP symbols smoke",
      agentId: agent.id,
    });
    const provider = fauxProvider({ provider: "live-lsp-symbols-smoke" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("lsp_symbols", { path: targetPath, maxSymbols: 20 }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        const messages = JSON.stringify(context.messages);
        expect(messages).toContain(privateName);
        expect(messages).toContain("Range: 2:3-4:4");
        return fauxAssistantMessage(
          "The real language server returned the semantic outline.",
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
      text: "Inspect the TypeScript document through semantic LSP symbols.",
      model: { provider: "live-lsp-symbols-smoke", id: "faux-1" },
    });

    expect(run.status).toBe("completed");
    const events = await store.listEvents(thread.id);
    const completed = events.find(
      (event) =>
        event.type === "tool.completed" &&
        event.payload &&
        !Array.isArray(event.payload) &&
        typeof event.payload === "object" &&
        event.payload["toolName"] === "lsp_symbols",
    );
    expect(completed?.payload["details"]).toEqual(
      expect.objectContaining({
        status: "found",
        responseShape: "hierarchical",
        symbolCount: 2,
        omittedSymbolCount: 0,
        maxDepth: 1,
        sandbox: "macos-sandbox-exec",
        languageServerVersion: "5.3.0",
        typescriptVersion: "5.9.3",
      }),
    );
    const durable = JSON.stringify(events);
    expect(durable).not.toContain(targetPath);
    expect(durable).not.toContain(privateName);
    expect(durable).not.toContain("return value.trim()");
    expect(await readFile(path.join(workspaceRoot, targetPath), "utf8")).toBe(
      source,
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

  it("applies a fixed multi-file rename through the Agent sandbox", async () => {
    const sourceRoot = await realpath(
      fileURLToPath(
        new URL("../../../examples/lsp-references/", import.meta.url),
      ),
    );
    const workspaceRoot = await mkdtemp(
      path.join(tmpdir(), "napier-live-lsp-rename-workspace-"),
    );
    const stateRoot = await mkdtemp(
      path.join(tmpdir(), "napier-live-lsp-rename-"),
    );
    temporaryRoots.push(workspaceRoot, stateRoot);
    const sourcePath = "definition.ts";
    const firstPath = "first.ts";
    const secondPath = "second.ts";
    const oldName = "normalizeTitle";
    const newName = "canonicalizeTitle";
    const before = await Promise.all(
      [sourcePath, firstPath, secondPath].map((file) =>
        readFile(path.join(sourceRoot, file), "utf8"),
      ),
    );
    await Promise.all([
      ...[sourcePath, firstPath, secondPath].map((file, index) =>
        writeFile(path.join(workspaceRoot, file), before[index]!),
      ),
      writeFile(
        path.join(workspaceRoot, "tsconfig.json"),
        await readFile(path.join(sourceRoot, "tsconfig.json"), "utf8"),
      ),
    ]);
    const store = new LocalStore({
      workspaceRoot,
      dataRoot: path.join(stateRoot, "data"),
    });
    await store.initialize();
    const agent = await store.updateAgent(store.listAgents()[0]!.id, {
      toolPolicy: "workspace",
      enabledTools: ["lsp_rename", "lsp_rename_apply"],
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
        const previewId = messages.match(
          /Apply preview ID: (renamepreview_[a-z0-9]+)/u,
        )?.[1];
        expect(previewId).toMatch(/^renamepreview_/u);
        return fauxAssistantMessage(
          fauxToolCall("lsp_rename_apply", { previewId }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        const messages = JSON.stringify(context.messages);
        expect(messages).toContain("LSP rename apply: applied");
        expect(messages).toContain("Rename diagnostics: clean");
        return fauxAssistantMessage(
          "The real language-server rename was applied and diagnosed.",
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
      text: "Apply the TypeScript rename through standard LSP.",
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
        event.payload["toolName"] === "lsp_rename_apply",
    );
    expect(completed?.payload["details"]).toEqual(
      expect.objectContaining({
        status: "applied",
        postcondition: "verified",
        fileCount: 3,
        editCount: 6,
        committedFileCount: 3,
        recoveryArtifactCount: 0,
        diagnostics: expect.objectContaining({
          status: "clean",
          fileCount: 3,
        }),
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
    ).toEqual(before.map((source) => source.replaceAll(oldName, newName)));
    store.close();
  }, 60_000);

  it("applies a real missing-import quick fix through the Agent sandbox", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(tmpdir(), "napier-live-lsp-code-actions-workspace-"),
    );
    const stateRoot = await mkdtemp(
      path.join(tmpdir(), "napier-live-lsp-code-actions-state-"),
    );
    temporaryRoots.push(workspaceRoot, stateRoot);
    const targetPath = "private-usage.ts";
    const source = 'export const title = formatTitle(" value ");\n';
    await Promise.all([
      writeFile(
        path.join(workspaceRoot, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { strict: true, noEmit: true } }),
      ),
      writeFile(path.join(workspaceRoot, targetPath), source),
      writeFile(
        path.join(workspaceRoot, "private-definition.ts"),
        [
          "export function formatTitle(value: string): string {",
          "  return value.trim();",
          "}",
          "",
        ].join("\n"),
      ),
    ]);
    const store = new LocalStore({
      workspaceRoot,
      dataRoot: path.join(stateRoot, "data"),
    });
    await store.initialize();
    const agent = await store.updateAgent(store.listAgents()[0]!.id, {
      toolPolicy: "workspace",
      enabledTools: ["lsp_code_actions", "lsp_code_action_apply"],
    });
    const thread = await store.createThread({
      title: "Live LSP Code Actions smoke",
      agentId: agent.id,
    });
    const provider = fauxProvider({
      provider: "live-lsp-code-actions-smoke",
    });
    let applyPreviewId = "";
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
        expect(messages).toContain("private-definition");
        expect(messages).toContain("formatTitle");
        const previewId = messages.match(
          /Add import from.*?Apply preview ID: (actionpreview_[a-z0-9]+)/u,
        )?.[1];
        expect(previewId).toMatch(/^actionpreview_/u);
        applyPreviewId = previewId ?? "";
        return fauxAssistantMessage(
          fauxToolCall("lsp_code_action_apply", { previewId }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        const messages = JSON.stringify(context.messages);
        expect(messages).toContain("LSP Code Action apply: applied");
        expect(messages).toContain("Code Action diagnostics: improved");
        return fauxAssistantMessage(
          "The preferred import fix was committed and diagnostics improved.",
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
      text: "Apply the missing-import quick fix through standard LSP.",
      model: { provider: "live-lsp-code-actions-smoke", id: "faux-1" },
    });

    expect(run.status).toBe("completed");
    const events = await store.listEvents(thread.id);
    const completed = events.find(
      (event) =>
        event.type === "tool.completed" &&
        event.payload &&
        !Array.isArray(event.payload) &&
        typeof event.payload === "object" &&
        event.payload["toolName"] === "lsp_code_action_apply",
    );
    expect(completed?.payload["details"]).toEqual(
      expect.objectContaining({
        kind: "napier.lsp-code-action-apply",
        status: "applied",
        postcondition: "verified",
        sourceCommandIgnored: true,
        commandPolicy: "deny_all",
        diagnostics: expect.objectContaining({
          status: "improved",
          beforeErrorCount: 1,
          afterErrorCount: 0,
        }),
      }),
    );
    const durable = JSON.stringify(events);
    expect(durable).not.toContain(targetPath);
    expect(durable).not.toContain("private-definition");
    expect(durable).not.toContain("formatTitle");
    expect(durable).not.toContain("_typescript.applyCodeActionCommand");
    expect(durable).not.toContain(applyPreviewId);
    const updated = await readFile(
      path.join(workspaceRoot, targetPath),
      "utf8",
    );
    expect(updated).toContain(
      'import { formatTitle } from "./private-definition',
    );
    expect(updated).toContain(source);
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
