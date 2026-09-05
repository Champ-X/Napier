import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { pathToFileURL } from "node:url";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-jsonrpc/node.js";
import { afterEach, describe, expect, it } from "vitest";

import {
  AgentRuntime,
  exportThreadReplayBundle,
  LocalStore,
  ModelRegistry,
  type OsSandboxAdapter,
  type SandboxedProcess,
  verifyThreadReplayBundle,
} from "../src/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Agent LSP definition integration", () => {
  it("returns workspace source live without persisting path or preview", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-agent-definition-test-"),
    );
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const sourcePath = "src/private-usage.ts";
    const targetPath = "src/private-definition.ts";
    const privatePreview = "PRIVATE_DEFINITION_SYMBOL";
    await mkdir(path.join(workspaceRoot, "src"), { recursive: true });
    await Promise.all([
      writeFile(
        path.join(workspaceRoot, sourcePath),
        "export const usage = PRIVATE_DEFINITION_SYMBOL;\n",
      ),
      writeFile(
        path.join(workspaceRoot, targetPath),
        `export const ${privatePreview} = 1;\n`,
      ),
    ]);
    const store = new LocalStore({
      workspaceRoot,
      dataRoot: path.join(root, "data"),
    });
    await store.initialize();
    const agent = await store.updateAgent(store.listAgents()[0]!.id, {
      toolPolicy: "workspace",
      enabledTools: ["lsp_definition"],
    });
    const thread = await store.createThread({
      title: "Agent LSP definition",
      agentId: agent.id,
    });
    const provider = fauxProvider({ provider: "faux-lsp-definition" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("lsp_definition", {
          path: sourcePath,
          line: 1,
          character: 22,
        }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        const messages = JSON.stringify(context.messages);
        expect(messages).toContain(targetPath);
        expect(messages).toContain(privatePreview);
        return fauxAssistantMessage(
          "The language server located the workspace definition.",
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
      definitionSandbox(await realpath(path.join(workspaceRoot, targetPath))),
    );

    const run = await runtime.runPrompt({
      threadId: thread.id,
      text: "Locate the definition at the requested source position.",
      model: { provider: "faux-lsp-definition", id: "faux-1" },
    });

    expect(run.status).toBe("completed");
    const events = await store.listEvents(thread.id);
    const toolEvents = events.filter(
      (event) =>
        event.type.startsWith("tool.") &&
        record(event.payload) &&
        event.payload["toolName"] === "lsp_definition",
    );
    expect(toolEvents.map((event) => event.type)).toEqual([
      "tool.admitted",
      "tool.started",
      "tool.completed",
    ]);
    expect(toolEvents[2]?.payload["details"]).toEqual(
      expect.objectContaining({
        kind: "napier.lsp-definition",
        status: "found",
        definitionCount: 1,
        omittedDefinitionCount: 0,
      }),
    );
    const durable = JSON.stringify(
      events.filter(
        (event) =>
          event.type === "model.response" || event.type.startsWith("tool."),
      ),
    );
    expect(durable).not.toContain(sourcePath);
    expect(durable).not.toContain(targetPath);
    expect(durable).not.toContain(privatePreview);
    expect(
      verifyThreadReplayBundle(await exportThreadReplayBundle(store, thread.id))
        .status,
    ).toBe("valid");
    store.close();
  });
});

function definitionSandbox(target: string): OsSandboxAdapter {
  return {
    id: "agent-definition-sandbox",
    async launch() {
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      let resolveExit:
        | ((value: {
            code: number | null;
            signal: NodeJS.Signals | null;
          }) => void)
        | undefined;
      let settled = false;
      const exit = new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve) => {
        resolveExit = resolve;
      });
      const settle = (
        code: number | null,
        signal: NodeJS.Signals | null = null,
      ): void => {
        if (settled) return;
        settled = true;
        stdout.end();
        stderr.end();
        resolveExit?.({ code, signal });
      };
      const connection = createMessageConnection(
        new StreamMessageReader(stdin),
        new StreamMessageWriter(stdout),
      );
      connection.onRequest("initialize", () => ({ capabilities: {} }));
      connection.onNotification(
        "textDocument/didOpen",
        async (params: unknown) => {
          const textDocument =
            record(params) && record(params["textDocument"])
              ? params["textDocument"]
              : {};
          await connection.sendNotification("textDocument/publishDiagnostics", {
            uri:
              typeof textDocument["uri"] === "string"
                ? textDocument["uri"]
                : "",
            diagnostics: [],
          });
        },
      );
      connection.onRequest("textDocument/definition", () => ({
        uri: pathToFileURL(target).href,
        range: {
          start: { line: 0, character: 13 },
          end: { line: 0, character: 38 },
        },
      }));
      connection.onRequest("shutdown", () => null);
      connection.onNotification("exit", () => {
        connection.dispose();
        settle(0);
      });
      connection.listen();
      return {
        stdin,
        stdout,
        stderr,
        exit,
        terminate: async () => {
          connection.dispose();
          settle(null, "SIGTERM");
        },
      } satisfies SandboxedProcess;
    },
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
