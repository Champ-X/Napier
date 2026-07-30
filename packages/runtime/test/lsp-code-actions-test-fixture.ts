import { PassThrough } from "node:stream";

import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-jsonrpc/node.js";

import type { OsSandboxAdapter, SandboxedProcess } from "../src/index.js";

export interface ControlledCodeActionsOptions {
  diagnostics?:
    | unknown[]
    | ((uri: string, text: string) => unknown[] | Promise<unknown[]>);
  codeActions?: (params: unknown) => unknown | Promise<unknown>;
}

export function controlledLspCodeActionsSandbox(
  options: ControlledCodeActionsOptions,
): {
  sandbox: OsSandboxAdapter;
  codeActionCount(): number;
  terminateCount(): number;
} {
  let codeActions = 0;
  let terminations = 0;
  return {
    codeActionCount: () => codeActions,
    terminateCount: () => terminations,
    sandbox: {
      id: "controlled-code-actions-test",
      async launch() {
        const stdin = new PassThrough();
        const stdout = new PassThrough();
        const stderr = new PassThrough();
        let settled = false;
        let resolveExit:
          | ((value: {
              code: number | null;
              signal: NodeJS.Signals | null;
            }) => void)
          | undefined;
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
        connection.onRequest("initialize", () => ({
          capabilities: { codeActionProvider: true },
        }));
        connection.onNotification(
          "textDocument/didOpen",
          async (params: unknown) => {
            const textDocument =
              record(params) && record(params["textDocument"])
                ? params["textDocument"]
                : {};
            const uri =
              typeof textDocument["uri"] === "string"
                ? textDocument["uri"]
                : "";
            const text =
              typeof textDocument["text"] === "string"
                ? textDocument["text"]
                : "";
            const diagnostics =
              typeof options.diagnostics === "function"
                ? await options.diagnostics(uri, text)
                : (options.diagnostics ?? []);
            await connection.sendNotification(
              "textDocument/publishDiagnostics",
              { uri, diagnostics },
            );
          },
        );
        connection.onRequest("textDocument/codeAction", async (params) => {
          codeActions += 1;
          return options.codeActions?.(params) ?? [];
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
          async terminate() {
            terminations += 1;
            connection.dispose();
            settle(null, "SIGTERM");
          },
        } satisfies SandboxedProcess;
      },
    },
  };
}

export function diagnostic(
  message: string,
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number,
): Record<string, unknown> {
  return {
    range: {
      start: { line: startLine, character: startCharacter },
      end: { line: endLine, character: endCharacter },
    },
    severity: 1,
    code: 2304,
    source: "ts",
    message,
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
