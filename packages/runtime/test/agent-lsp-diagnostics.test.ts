import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

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
  LocalStore,
  ModelRegistry,
  type OsSandboxAdapter,
  type SandboxedProcess,
} from "../src/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Agent LSP diagnostics integration", () => {
  it("runs diagnostics through the Agent loop without persisting path or message text", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-agent-lsp-test-"));
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot, { recursive: true });
    const targetPath = "src/private-diagnostic.ts";
    await mkdir(path.join(workspaceRoot, "src"), { recursive: true });
    await writeFile(
      path.join(workspaceRoot, targetPath),
      "const accountSecret: string = 42;\n",
    );
    const store = new LocalStore({
      workspaceRoot,
      dataRoot: path.join(root, "data"),
    });
    await store.initialize();
    const agent = await store.updateAgent(store.listAgents()[0]!.id, {
      toolPolicy: "workspace",
      enabledTools: ["lsp_diagnostics"],
    });
    const thread = await store.createThread({
      title: "Agent LSP diagnostics",
      agentId: agent.id,
    });
    const provider = fauxProvider({ provider: "faux-lsp" });
    let toolContext = "";
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("lsp_diagnostics", { path: targetPath }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        toolContext = JSON.stringify(context.messages);
        return fauxAssistantMessage(
          "The language server reported one type error.",
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
      diagnosticSandbox("TOP_SECRET_DIAGNOSTIC_MESSAGE"),
    );

    const run = await runtime.runPrompt({
      threadId: thread.id,
      text: "Use the language server to diagnose the current source file.",
      model: { provider: "faux-lsp", id: "faux-1" },
    });

    const events = await store.listEvents(thread.id);
    expect(run.status, toolContext).toBe("completed");
    expect(toolContext).toContain("TS2322");
    expect(toolContext).toContain("TOP_SECRET_DIAGNOSTIC_MESSAGE");
    const toolEvents = events.filter(
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
    expect(toolEvents[1]?.payload).toEqual(
      expect.objectContaining({
        effect: "read",
        inputRedacted: true,
        inputSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(toolEvents[2]?.payload).toEqual(
      expect.objectContaining({
        outputRedacted: true,
        outputSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        details: expect.objectContaining({
          kind: "napier.lsp-diagnostics",
          diagnosticCount: 1,
          errorCount: 1,
        }),
      }),
    );
    expect(JSON.stringify(toolEvents)).not.toContain(targetPath);
    expect(JSON.stringify(toolEvents)).not.toContain(
      "TOP_SECRET_DIAGNOSTIC_MESSAGE",
    );
    expect(JSON.stringify(toolEvents)).not.toContain("accountSecret");
    store.close();
  });
});

function diagnosticSandbox(message: string): OsSandboxAdapter {
  return {
    id: "agent-lsp-sandbox",
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
          const uri =
            record(params) &&
            record(params["textDocument"]) &&
            typeof params["textDocument"]["uri"] === "string"
              ? params["textDocument"]["uri"]
              : "";
          await connection.sendNotification("textDocument/publishDiagnostics", {
            uri,
            diagnostics: [
              {
                range: {
                  start: { line: 0, character: 6 },
                  end: { line: 0, character: 19 },
                },
                severity: 1,
                code: 2322,
                source: "typescript",
                message,
              },
            ],
          });
        },
      );
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
