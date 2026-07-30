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
  sha256,
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
  it("previews a semantic rename and applies every file through hash-bound patches", async () => {
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
      enabledTools: ["lsp_rename", "apply_patch"],
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
        return fauxAssistantMessage(
          fauxToolCall("apply_patch", {
            operation: "replace",
            path: sourcePath,
            expectedSha256: sha256(sourceBefore),
            edits: [{ oldText: sourceBefore, newText: sourceAfter }],
          }),
          { stopReason: "toolUse" },
        );
      },
      fauxAssistantMessage(
        fauxToolCall("apply_patch", {
          operation: "replace",
          path: consumerPath,
          expectedSha256: sha256(consumerBefore),
          edits: [{ oldText: consumerBefore, newText: consumerAfter }],
        }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        const messages = JSON.stringify(context.messages);
        expect(messages).toContain(sha256(sourceAfter));
        expect(messages).toContain(sha256(consumerAfter));
        return fauxAssistantMessage(
          "The semantic rename preview was applied to every file.",
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
      { toolName: "apply_patch", effect: "write" },
      { toolName: "apply_patch", effect: "write" },
    ]);
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
