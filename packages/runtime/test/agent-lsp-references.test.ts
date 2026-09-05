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

describe("Agent LSP references integration", () => {
  it("returns workspace references live without persisting paths or previews", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-agent-references-test-"),
    );
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const sourcePath = "src/private-source.ts";
    const firstPath = "src/private-first-reference.ts";
    const secondPath = "src/private-second-reference.ts";
    const firstPreview = "PRIVATE_FIRST_REFERENCE";
    const secondPreview = "PRIVATE_SECOND_REFERENCE";
    await mkdir(path.join(workspaceRoot, "src"), { recursive: true });
    await Promise.all([
      writeFile(
        path.join(workspaceRoot, sourcePath),
        "export const sourceUsage = sharedSymbol;\n",
      ),
      writeFile(
        path.join(workspaceRoot, firstPath),
        `export const ${firstPreview} = sharedSymbol;\n`,
      ),
      writeFile(
        path.join(workspaceRoot, secondPath),
        `export const ${secondPreview} = sharedSymbol;\n`,
      ),
    ]);
    const targets = await Promise.all([
      realpath(path.join(workspaceRoot, firstPath)),
      realpath(path.join(workspaceRoot, secondPath)),
    ]);
    const store = new LocalStore({
      workspaceRoot,
      dataRoot: path.join(root, "data"),
    });
    await store.initialize();
    const agent = await store.updateAgent(store.listAgents()[0]!.id, {
      toolPolicy: "workspace",
      enabledTools: ["lsp_references"],
    });
    const thread = await store.createThread({
      title: "Agent LSP references",
      agentId: agent.id,
    });
    const provider = fauxProvider({ provider: "faux-lsp-references" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("lsp_references", {
          path: sourcePath,
          line: 1,
          character: 28,
          includeDeclaration: false,
        }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        const messages = JSON.stringify(context.messages);
        expect(messages).toContain(firstPath);
        expect(messages).toContain(secondPath);
        expect(messages).toContain(firstPreview);
        expect(messages).toContain(secondPreview);
        return fauxAssistantMessage(
          "The language server located both workspace references.",
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
      referencesSandbox(targets),
    );

    const run = await runtime.runPrompt({
      threadId: thread.id,
      text: "Find the requested symbol references.",
      model: { provider: "faux-lsp-references", id: "faux-1" },
    });

    expect(run.status).toBe("completed");
    const events = await store.listEvents(thread.id);
    const toolEvents = events.filter(
      (event) =>
        event.type.startsWith("tool.") &&
        record(event.payload) &&
        event.payload["toolName"] === "lsp_references",
    );
    expect(toolEvents.map((event) => event.type)).toEqual([
      "tool.admitted",
      "tool.started",
      "tool.completed",
    ]);
    expect(toolEvents[2]?.payload["details"]).toEqual(
      expect.objectContaining({
        kind: "napier.lsp-references",
        status: "found",
        includeDeclaration: false,
        referenceCount: 2,
        omittedReferenceCount: 0,
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
      firstPath,
      secondPath,
      firstPreview,
      secondPreview,
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

function referencesSandbox(targets: string[]): OsSandboxAdapter {
  return {
    id: "agent-references-sandbox",
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
      connection.onRequest("textDocument/references", (params: unknown) => {
        expect(
          record(params) && record(params["context"])
            ? params["context"]["includeDeclaration"]
            : undefined,
        ).toBe(false);
        return targets.map((target, index) => ({
          uri: pathToFileURL(target).href,
          range: {
            start: { line: 0, character: 13 },
            end: { line: 0, character: index === 0 ? 36 : 37 },
          },
        }));
      });
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
