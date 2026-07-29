import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

describe("Agent write-linked LSP diagnostics", () => {
  it("fixes a diagnostic through one patch call with path-free durable evidence", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-agent-lsp-patch-test-"),
    );
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const targetPath = "src/private-patch-target.ts";
    const absoluteTarget = path.join(workspaceRoot, targetPath);
    const source = "export const PATCH_PRIVATE_VALUE: string = 42;\n";
    const updated = "export const PATCH_PRIVATE_VALUE: string = 'fixed';\n";
    await mkdir(path.dirname(absoluteTarget), { recursive: true });
    await writeFile(absoluteTarget, source);
    const sourceSha256 = sha256(source);
    const updatedSha256 = sha256(updated);
    const store = new LocalStore({
      workspaceRoot,
      dataRoot: path.join(root, "data"),
    });
    await store.initialize();
    const agent = await store.updateAgent(store.listAgents()[0]!.id, {
      toolPolicy: "workspace",
      enabledTools: ["apply_patch", "lsp_diagnostics"],
    });
    const thread = await store.createThread({
      title: "Write-linked diagnostics",
      agentId: agent.id,
    });
    const provider = fauxProvider({ provider: "faux-lsp-patch" });
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
        expect(messages).toContain("Diagnostics: 1 -> 0");
        expect(messages).toContain("Errors: 1 -> 0");
        expect(messages).toContain(updatedSha256);
        return fauxAssistantMessage(
          "The patch committed and resolved the TypeScript diagnostic.",
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
      sourceAwareDiagnosticSandbox(),
    );

    const run = await runtime.runPrompt({
      threadId: thread.id,
      text: "Fix the current TypeScript type error.",
      model: { provider: "faux-lsp-patch", id: "faux-1" },
    });

    expect(run.status).toBe("completed");
    expect(await readFile(absoluteTarget, "utf8")).toBe(updated);
    const events = await store.listEvents(thread.id);
    const patchEvent = events.find(
      (event) =>
        event.type === "tool.completed" &&
        record(event.payload) &&
        event.payload["toolName"] === "apply_patch",
    );
    expect(patchEvent?.payload).toEqual(
      expect.objectContaining({
        outputRedacted: true,
        outputSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        details: expect.objectContaining({
          kind: "napier.workspace-patch",
          schemaVersion: 1,
          pathSha256: sha256(targetPath),
          beforeSha256: sourceSha256,
          afterSha256: updatedSha256,
          diagnostics: expect.objectContaining({
            status: "improved",
            beforeDiagnosticCount: 1,
            afterDiagnosticCount: 0,
            resolvedCount: 1,
            introducedCount: 0,
            expectedFileSha256: updatedSha256,
            observedFileSha256: updatedSha256,
          }),
        }),
      }),
    );
    expect(
      record(patchEvent?.payload) && record(patchEvent.payload["details"])
        ? patchEvent.payload["details"]
        : undefined,
    ).not.toHaveProperty("path");
    const durableToolEvidence = JSON.stringify(
      events.filter(
        (event) =>
          event.type === "model.response" || event.type.startsWith("tool."),
      ),
    );
    expect(durableToolEvidence).not.toContain(targetPath);
    expect(durableToolEvidence).not.toContain("PATCH_PRIVATE_VALUE");
    expect(durableToolEvidence).not.toContain(
      "PATCH_PRIVATE_DIAGNOSTIC_MESSAGE",
    );
    expect(
      verifyThreadReplayBundle(await exportThreadReplayBundle(store, thread.id))
        .status,
    ).toBe("valid");
    store.close();
  });
});

function sourceAwareDiagnosticSandbox(): OsSandboxAdapter {
  return {
    id: "agent-lsp-patch-sandbox",
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
          const uri =
            typeof textDocument["uri"] === "string" ? textDocument["uri"] : "";
          const source =
            typeof textDocument["text"] === "string"
              ? textDocument["text"]
              : "";
          await connection.sendNotification("textDocument/publishDiagnostics", {
            uri,
            diagnostics: source.includes("= 42")
              ? [
                  {
                    range: {
                      start: { line: 0, character: 14 },
                      end: { line: 0, character: 33 },
                    },
                    severity: 1,
                    code: 2322,
                    source: "typescript",
                    message: "PATCH_PRIVATE_DIAGNOSTIC_MESSAGE",
                  },
                ]
              : [],
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

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
