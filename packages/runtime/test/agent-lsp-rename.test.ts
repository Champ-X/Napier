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
import { pathToFileURL } from "node:url";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import {
  AgentRuntime,
  exportThreadReplayBundle,
  LocalStore,
  ModelRegistry,
  verifyThreadReplayBundle,
} from "../src/index.js";
import {
  controlledLspRenameSandbox,
  range,
  textEdit,
} from "./lsp-rename-test-fixture.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Agent LSP rename integration", () => {
  it("previews and directly applies a coordinated semantic rename", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-agent-rename-test-"),
    );
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const sourcePath = "src/private-source.ts";
    const consumerPath = "src/private-consumer.ts";
    const oldName = "currentName";
    const newName = "canonicalName";
    const sourceBefore = [
      `export function ${oldName}(value: string): string {`,
      "  return value.trim();",
      "}",
      "",
      `export const local = ${oldName}(" local ");`,
      "",
    ].join("\n");
    const sourceAfter = sourceBefore.replaceAll(oldName, newName);
    const consumerBefore = [
      `import { ${oldName} } from "./private-source.js";`,
      "",
      `export const result = ${oldName}(" result ");`,
      "",
    ].join("\n");
    const consumerAfter = consumerBefore.replaceAll(oldName, newName);
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
    const store = new LocalStore({
      workspaceRoot,
      dataRoot: path.join(root, "data"),
    });
    await store.initialize();
    const agent = await store.updateAgent(store.listAgents()[0]!.id, {
      toolPolicy: "workspace",
      enabledTools: ["lsp_rename", "lsp_rename_apply"],
    });
    const thread = await store.createThread({
      title: "Agent LSP rename",
      agentId: agent.id,
    });
    const sourceUri = pathToFileURL(
      await realpath(path.join(workspaceRoot, sourcePath)),
    ).href;
    const consumerUri = pathToFileURL(
      await realpath(path.join(workspaceRoot, consumerPath)),
    ).href;
    const sandbox = controlledLspRenameSandbox({
      prepare: () => ({
        range: range(0, 16, 0, 27),
        placeholder: oldName,
      }),
      rename: (params) => {
        expect(record(params)?.["newName"]).toBe(newName);
        return {
          changes: {
            [sourceUri]: [
              textEdit(newName, 0, 16, 0, 27),
              textEdit(newName, 4, 21, 4, 32),
            ],
            [consumerUri]: [
              textEdit(newName, 0, 9, 0, 20),
              textEdit(newName, 2, 22, 2, 33),
            ],
          },
        };
      },
    }).sandbox;
    let applyPreviewId = "";
    const provider = fauxProvider({ provider: "faux-lsp-rename" });
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
        expect(messages).toContain(sourcePath);
        expect(messages).toContain(consumerPath);
        expect(messages).toContain(`OLD \\"${oldName}\\"`);
        expect(messages).toContain(`NEW \\"${newName}\\"`);
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
        const messages = JSON.stringify(context.messages);
        expect(messages).toContain("LSP rename apply: applied");
        expect(messages).toContain("Postcondition: verified");
        expect(messages).toContain("Rename diagnostics: clean");
        return fauxAssistantMessage(
          "The coordinated semantic rename was applied to every file.",
        );
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const registry = new ModelRegistry();
    registry.registerProvider(provider.provider);
    const runtime = new AgentRuntime(store, registry, undefined, sandbox);

    const run = await runtime.runPrompt({
      threadId: thread.id,
      text: "Rename the symbol across the workspace and update every file.",
      model: { provider: "faux-lsp-rename", id: "faux-1" },
    });

    expect(run.status).toBe("completed");
    expect(await readFile(path.join(workspaceRoot, sourcePath), "utf8")).toBe(
      sourceAfter,
    );
    expect(await readFile(path.join(workspaceRoot, consumerPath), "utf8")).toBe(
      consumerAfter,
    );
    const events = await store.listEvents(thread.id);
    expect(
      events
        .filter(
          (event) => event.type === "tool.started" && record(event.payload),
        )
        .map((event) => ({
          toolName: record(event.payload)?.["toolName"],
          effect: record(event.payload)?.["effect"],
        })),
    ).toEqual([
      { toolName: "lsp_rename", effect: "read" },
      { toolName: "lsp_rename_apply", effect: "write" },
    ]);
    const apply = events.find(
      (event) =>
        event.type === "tool.completed" &&
        record(event.payload)?.["toolName"] === "lsp_rename_apply",
    );
    expect(record(apply?.payload)?.["details"]).toEqual(
      expect.objectContaining({
        kind: "napier.lsp-rename-apply",
        status: "applied",
        postcondition: "verified",
        fileCount: 2,
        editCount: 4,
        committedFileCount: 2,
        recoveryArtifactCount: 0,
        diagnostics: expect.objectContaining({
          status: "clean",
          fileCount: 2,
        }),
      }),
    );
    const durable = JSON.stringify(
      events.filter(
        (event) =>
          event.type === "model.response" || event.type.startsWith("tool."),
      ),
    );
    for (const secret of [
      sourcePath,
      consumerPath,
      oldName,
      newName,
      sourceBefore,
      sourceAfter,
      consumerBefore,
      consumerAfter,
      applyPreviewId,
    ]) {
      expect(durable).not.toContain(secret);
    }
    expect(
      verifyThreadReplayBundle(await exportThreadReplayBundle(store, thread.id))
        .status,
    ).toBe("valid");
    store.close();
  });
});

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
