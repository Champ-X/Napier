import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-jsonrpc/node.js";

import type { OsSandboxAdapter, SandboxedProcess } from "../src/index.js";

export interface ControlledRenameOptions {
  prepare?: (params: unknown) => unknown | Promise<unknown>;
  rename?: (params: unknown) => unknown | Promise<unknown>;
}

export async function createLspRenameWorkspace(
  temporaryRoots: string[],
): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-rename-test-"));
  temporaryRoots.push(root);
  await writeFile(
    path.join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        module: "NodeNext",
        moduleResolution: "NodeNext",
      },
    }),
  );
  return root;
}

export function directLspSandbox(): OsSandboxAdapter {
  return {
    id: "direct-rename-test",
    async launch(request) {
      const child = spawn(request.command, request.args, {
        cwd: request.cwd,
        env: { ...process.env, ...request.env },
        detached: true,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const exit = new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve) =>
        child.once("exit", (code, signal) => resolve({ code, signal })),
      );
      return {
        stdin: child.stdin,
        stdout: child.stdout,
        stderr: child.stderr,
        exit,
        async terminate() {
          if (child.exitCode === null && child.signalCode === null) {
            if (child.pid !== undefined) {
              try {
                process.kill(-child.pid, "SIGTERM");
              } catch {
                child.kill("SIGTERM");
              }
            }
          }
          await exit;
        },
      };
    },
  };
}

export function controlledLspRenameSandbox(options: ControlledRenameOptions): {
  sandbox: OsSandboxAdapter;
  renameCount(): number;
  terminateCount(): number;
} {
  let renames = 0;
  let terminations = 0;
  return {
    renameCount: () => renames,
    terminateCount: () => terminations,
    sandbox: {
      id: "controlled-rename-test",
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
          capabilities: {
            renameProvider: { prepareProvider: true },
          },
        }));
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
        connection.onRequest(
          "textDocument/prepareRename",
          options.prepare ?? (() => range(0, 0, 0, 1)),
        );
        connection.onRequest("textDocument/rename", async (params) => {
          renames += 1;
          return options.rename?.(params) ?? null;
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

export async function createFakeLspAssets(root: string): Promise<{
  languageServerPath: string;
  typescriptServerPath: string;
}> {
  const languageServerRoot = path.join(root, "runtime-assets", "lsp");
  const typescriptRoot = path.join(root, "runtime-assets", "typescript");
  const languageServerPath = path.join(languageServerRoot, "lib", "cli.mjs");
  const typescriptServerPath = path.join(typescriptRoot, "lib", "tsserver.js");
  await Promise.all([
    mkdir(path.dirname(languageServerPath), { recursive: true }),
    mkdir(path.dirname(typescriptServerPath), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      path.join(languageServerRoot, "package.json"),
      JSON.stringify({ version: "1.0.0" }),
    ),
    writeFile(languageServerPath, "server"),
    writeFile(
      path.join(typescriptRoot, "package.json"),
      JSON.stringify({ version: "5.9.3" }),
    ),
    writeFile(typescriptServerPath, "tsserver"),
    writeFile(path.join(typescriptRoot, "lib", "typescript.js"), "typescript"),
    writeFile(
      path.join(typescriptRoot, "lib", "lib.es2024.d.ts"),
      "interface Array<T> {}",
    ),
  ]);
  return { languageServerPath, typescriptServerPath };
}

export function textEdit(
  newText: string,
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number,
) {
  return {
    range: range(startLine, startCharacter, endLine, endCharacter),
    newText,
  };
}

export function range(
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number,
) {
  return {
    start: { line: startLine, character: startCharacter },
    end: { line: endLine, character: endCharacter },
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
