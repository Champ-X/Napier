import { PassThrough } from "node:stream";

import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-jsonrpc/node.js";

import type { OsSandboxAdapter, SandboxedProcess } from "../src/index.js";

export interface ControlledLspSymbolsOptions {
  symbols: (params: unknown) => unknown | Promise<unknown>;
  initialize?: (params: unknown) => void;
}

export function controlledLspSymbolsSandbox(
  options: ControlledLspSymbolsOptions,
): {
  sandbox: OsSandboxAdapter;
  requestCount(): number;
  terminateCount(): number;
} {
  let requests = 0;
  let terminations = 0;
  return {
    requestCount: () => requests,
    terminateCount: () => terminations,
    sandbox: {
      id: "controlled-lsp-symbols-test",
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
        connection.onRequest("initialize", (params) => {
          options.initialize?.(params);
          return { capabilities: { documentSymbolProvider: true } };
        });
        connection.onNotification(
          "textDocument/didOpen",
          async (params: unknown) => {
            const textDocument =
              record(params) && record(params["textDocument"])
                ? params["textDocument"]
                : {};
            await connection.sendNotification(
              "textDocument/publishDiagnostics",
              {
                uri:
                  typeof textDocument["uri"] === "string"
                    ? textDocument["uri"]
                    : "",
                diagnostics: [],
              },
            );
          },
        );
        connection.onRequest("textDocument/documentSymbol", async (params) => {
          requests += 1;
          return options.symbols(params);
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

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
