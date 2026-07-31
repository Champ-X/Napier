import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-jsonrpc/node.js";
import { afterEach, describe, expect, it } from "vitest";

import {
  LspDiagnosticsRunner,
  MAX_LSP_DIAGNOSTICS,
  MAX_LSP_DIAGNOSTIC_FILE_BYTES,
  MAX_LSP_DIAGNOSTIC_MESSAGE_CHARS,
  MAX_LSP_PROTOCOL_BYTES,
  MAX_LSP_STDERR_CHARS,
  type OsSandboxAdapter,
  type SandboxedProcess,
  type SandboxLaunchRequest,
} from "../src/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("LSP diagnostics runner", () => {
  it("uses the real standard language server for clean and semantic diagnostics", async () => {
    const root = await createWorkspace();
    await Promise.all([
      writeFile(path.join(root, "clean.ts"), "const clean: string = 'ok';\n"),
      writeFile(path.join(root, "error.ts"), "const value: string = 42;\n"),
    ]);
    const direct = directSandbox();
    const runner = new LspDiagnosticsRunner({
      workspaceRoot: root,
      sandbox: direct.sandbox,
    });

    const [clean, diagnostic] = await Promise.all([
      runner.run({ path: "clean.ts" }),
      runner.run({ path: "error.ts" }),
    ]);

    expect(clean.details).toEqual(
      expect.objectContaining({
        status: "clean",
        diagnosticCount: 0,
        languageServerVersion: "5.3.0",
        typescriptVersion: "5.9.3",
        workspaceAccess: "read_only",
        networkAccess: "denied",
      }),
    );
    expect(diagnostic.details).toEqual(
      expect.objectContaining({
        status: "diagnostics",
        diagnosticCount: 1,
        errorCount: 1,
      }),
    );
    expect(diagnostic.diagnostics).toEqual([
      expect.objectContaining({
        startLine: 1,
        severity: 1,
        code: "2322",
        message: "Type 'number' is not assignable to type 'string'.",
      }),
    ]);
    expect(direct.requests).toHaveLength(2);
    for (const request of direct.requests) {
      expect(request.approvedCapabilities).toEqual([
        "process.spawn",
        "workspace.read",
      ]);
      expect(request.runtimeReadPaths).toHaveLength(2);
      expect(request.env).not.toHaveProperty("PATH");
      expect(request.env).not.toHaveProperty("HOME");
    }
  }, 20_000);

  it("rejects escapes, symlinks, unsupported files, invalid UTF-8, and oversized input", async () => {
    const root = await createWorkspace();
    const outside = path.join(path.dirname(root), "outside.ts");
    await Promise.all([
      writeFile(outside, "export const outside = true;\n"),
      writeFile(path.join(root, "notes.txt"), "text"),
      writeFile(path.join(root, "invalid.ts"), Buffer.from([0xff])),
      writeFile(path.join(root, "large.ts"), "x"),
      writeFile(path.join(root, "target.ts"), "const target = true;\n"),
    ]);
    await truncate(
      path.join(root, "large.ts"),
      MAX_LSP_DIAGNOSTIC_FILE_BYTES + 1,
    );
    await symlink(outside, path.join(root, "linked.ts"));
    const runner = new LspDiagnosticsRunner({
      workspaceRoot: root,
      sandbox: directSandbox().sandbox,
    });

    await expect(runner.run({ path: "../outside.ts" })).rejects.toThrow(
      "escapes",
    );
    await expect(runner.run({ path: "linked.ts" })).rejects.toThrow("symlink");
    await expect(runner.run({ path: "notes.txt" })).rejects.toThrow(
      "TypeScript and JavaScript",
    );
    await expect(runner.run({ path: "invalid.ts" })).rejects.toThrow("UTF-8");
    await expect(runner.run({ path: "large.ts" })).rejects.toThrow(
      "files up to",
    );

    let ociLaunches = 0;
    await expect(
      new LspDiagnosticsRunner({
        workspaceRoot: root,
        sandbox: {
          id: "oci-container",
          async launch() {
            ociLaunches += 1;
            throw new Error("OCI launch must not be reached");
          },
        },
      }).run({ path: "notes.txt" }),
    ).rejects.toThrow("TypeScript and JavaScript");
    await expect(
      new LspDiagnosticsRunner({
        workspaceRoot: root,
        sandbox: {
          id: "oci-container",
          async launch() {
            ociLaunches += 1;
            throw new Error("OCI launch must not be reached");
          },
        },
      }).run({ path: "target.ts" }),
    ).rejects.toThrow("local OS sandbox");
    expect(ociLaunches).toBe(0);
  });

  it("terminates on timeout, cancellation, malformed protocol, and output overflow", async () => {
    const root = await createWorkspace();
    await writeFile(path.join(root, "target.ts"), "const value = 1;\n");

    const timeout = controlledSandbox({ mode: "hang" });
    await expect(
      new LspDiagnosticsRunner({
        workspaceRoot: root,
        sandbox: timeout.sandbox,
      }).run({ path: "target.ts", timeoutMs: 1_000 }),
    ).rejects.toThrow("timed out");
    expect(timeout.terminateCount()).toBeGreaterThan(0);

    const cancelled = controlledSandbox({ mode: "hang" });
    const controller = new AbortController();
    const running = new LspDiagnosticsRunner({
      workspaceRoot: root,
      sandbox: cancelled.sandbox,
    }).run({ path: "target.ts", signal: controller.signal });
    setTimeout(() => controller.abort(), 10);
    await expect(running).rejects.toThrow("aborted");
    expect(cancelled.terminateCount()).toBeGreaterThan(0);

    const overflow = controlledSandbox({ mode: "overflow" });
    await expect(
      new LspDiagnosticsRunner({
        workspaceRoot: root,
        sandbox: overflow.sandbox,
      }).run({ path: "target.ts" }),
    ).rejects.toThrow(/protocol (output limit|failed)/u);
    expect(overflow.terminateCount()).toBeGreaterThan(0);

    const malformed = controlledSandbox({
      mode: "malformed",
      rejectTermination: true,
    });
    await expect(
      new LspDiagnosticsRunner({
        workspaceRoot: root,
        sandbox: malformed.sandbox,
      }).run({ path: "target.ts" }),
    ).rejects.toThrow("protocol failed");
    expect(malformed.terminateCount()).toBeGreaterThan(0);

    const stderrOverflow = controlledSandbox({ mode: "stderr-overflow" });
    await expect(
      new LspDiagnosticsRunner({
        workspaceRoot: root,
        sandbox: stderrOverflow.sandbox,
      }).run({ path: "target.ts" }),
    ).rejects.toThrow("stderr limit");
    expect(stderrOverflow.terminateCount()).toBeGreaterThan(0);
  }, 10_000);

  it("bounds diagnostic count and message length", async () => {
    const root = await createWorkspace();
    await writeFile(path.join(root, "target.ts"), "const value = 1;\n");
    const diagnostics = Array.from(
      { length: MAX_LSP_DIAGNOSTICS + 1 },
      (_, index) => ({
        range: {
          start: { line: index, character: 0 },
          end: { line: index, character: 1 },
        },
        severity: 1,
        code: index,
        source: "typescript",
        message: "x".repeat(MAX_LSP_DIAGNOSTIC_MESSAGE_CHARS + 1),
      }),
    );
    const controlled = controlledSandbox({
      mode: "diagnostics",
      diagnostics,
    });

    const result = await new LspDiagnosticsRunner({
      workspaceRoot: root,
      sandbox: controlled.sandbox,
    }).run({ path: "target.ts" });

    expect(result.details).toEqual(
      expect.objectContaining({
        diagnosticCount: MAX_LSP_DIAGNOSTICS,
        errorCount: MAX_LSP_DIAGNOSTICS,
        truncated: true,
      }),
    );
    expect(result.diagnostics).toHaveLength(MAX_LSP_DIAGNOSTICS);
    expect(result.diagnostics[0]?.message).toHaveLength(
      MAX_LSP_DIAGNOSTIC_MESSAGE_CHARS,
    );
  });

  it("rejects partial evidence from an injected Session executor", async () => {
    const root = await createWorkspace();
    await writeFile(path.join(root, "target.ts"), "const value = 1;\n");
    let launches = 0;
    const runner = new LspDiagnosticsRunner({
      workspaceRoot: root,
      sandbox: {
        id: "injected-session-test",
        async launch() {
          launches += 1;
          throw new Error("Sandbox launch must not be reached");
        },
      },
      session: {
        async execute<T>() {
          return {
            value: {
              diagnostics: [],
              truncated: false,
            } as T,
            protocolBytes: 0,
            stderr: "",
            stderrTruncated: false,
            sessionMode: "run_persistent" as const,
          };
        },
      },
    });

    await expect(runner.run({ path: "target.ts" })).rejects.toThrow(
      "LSP Session evidence is invalid",
    );
    expect(launches).toBe(0);
  });

  it("fails when bound language-server or TypeScript library assets drift", async () => {
    const root = await createWorkspace();
    await writeFile(path.join(root, "target.ts"), "const value = 1;\n");
    const assets = await createFakeAssets(root);
    const languageServerDrift = controlledSandbox({
      mode: "diagnostics",
      beforePublish: async () => {
        await writeFile(assets.languageServerPath, "drifted");
      },
    });
    const runner = new LspDiagnosticsRunner({
      workspaceRoot: root,
      sandbox: languageServerDrift.sandbox,
      languageServerPath: assets.languageServerPath,
      typescriptServerPath: assets.typescriptServerPath,
    });

    await expect(runner.run({ path: "target.ts" })).rejects.toThrow(
      "runtime assets changed",
    );

    const typescriptLibraryDrift = controlledSandbox({
      mode: "diagnostics",
      beforePublish: async () => {
        await writeFile(assets.typescriptLibraryPath, "drifted");
      },
    });
    await expect(
      new LspDiagnosticsRunner({
        workspaceRoot: root,
        sandbox: typescriptLibraryDrift.sandbox,
        languageServerPath: assets.languageServerPath,
        typescriptServerPath: assets.typescriptServerPath,
      }).run({ path: "target.ts" }),
    ).rejects.toThrow("runtime assets changed");
  });

  it("fails when the target changes while diagnostics are running", async () => {
    const root = await createWorkspace();
    const target = path.join(root, "target.ts");
    await writeFile(target, "const value = 1;\n");
    const controlled = controlledSandbox({
      mode: "diagnostics",
      beforePublish: async () => {
        await writeFile(target, "const value = 2;\n");
      },
    });

    await expect(
      new LspDiagnosticsRunner({
        workspaceRoot: root,
        sandbox: controlled.sandbox,
      }).run({ path: "target.ts" }),
    ).rejects.toMatchObject({
      name: "LspDiagnosticsTargetDriftError",
      expectedFileSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      observedFileSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
  });
});

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-lsp-test-"));
  temporaryRoots.push(root);
  await writeFile(
    path.join(root, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { strict: true, noEmit: true } }),
  );
  return root;
}

function directSandbox(): {
  sandbox: OsSandboxAdapter;
  requests: SandboxLaunchRequest[];
} {
  const requests: SandboxLaunchRequest[] = [];
  return {
    requests,
    sandbox: {
      id: "direct-lsp-test",
      async launch(request) {
        requests.push(structuredClone(request));
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
    },
  };
}

function controlledSandbox(options: {
  mode: "hang" | "overflow" | "malformed" | "stderr-overflow" | "diagnostics";
  beforePublish?: () => Promise<void>;
  diagnostics?: unknown[];
  rejectTermination?: boolean;
}): {
  sandbox: OsSandboxAdapter;
  terminateCount(): number;
} {
  let terminations = 0;
  return {
    terminateCount: () => terminations,
    sandbox: {
      id: "controlled-lsp-test",
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
        if (options.mode === "overflow") {
          queueMicrotask(() =>
            stdout.write(Buffer.alloc(MAX_LSP_PROTOCOL_BYTES + 1, "x")),
          );
        } else if (options.mode === "malformed") {
          queueMicrotask(() => stdout.write("Content-Length: invalid\r\n\r\n"));
        } else if (options.mode === "stderr-overflow") {
          queueMicrotask(() =>
            stderr.write(Buffer.alloc(MAX_LSP_STDERR_CHARS + 1, "x")),
          );
        } else if (options.mode === "diagnostics") {
          const connection = createMessageConnection(
            new StreamMessageReader(stdin),
            new StreamMessageWriter(stdout),
          );
          connection.onRequest("initialize", () => ({ capabilities: {} }));
          connection.onNotification(
            "textDocument/didOpen",
            async (params: unknown) => {
              await options.beforePublish?.();
              const uri =
                record(params) &&
                record(params["textDocument"]) &&
                typeof params["textDocument"]["uri"] === "string"
                  ? params["textDocument"]["uri"]
                  : "";
              await connection.sendNotification(
                "textDocument/publishDiagnostics",
                { uri, diagnostics: options.diagnostics ?? [] },
              );
            },
          );
          connection.onRequest("shutdown", () => null);
          connection.onNotification("exit", () => {
            connection.dispose();
            settle(0);
          });
          connection.listen();
        }
        return {
          stdin,
          stdout,
          stderr,
          exit,
          async terminate() {
            terminations += 1;
            settle(null, "SIGTERM");
            if (options.rejectTermination) {
              throw new Error("controlled termination failure");
            }
          },
        } satisfies SandboxedProcess;
      },
    },
  };
}

async function createFakeAssets(root: string): Promise<{
  languageServerPath: string;
  typescriptServerPath: string;
  typescriptLibraryPath: string;
}> {
  const lspRoot = path.join(root, "runtime-assets", "lsp");
  const typescriptRoot = path.join(root, "runtime-assets", "typescript");
  await Promise.all([
    mkdir(path.join(lspRoot, "lib"), { recursive: true }),
    mkdir(path.join(typescriptRoot, "lib"), { recursive: true }),
  ]);
  const languageServerPath = path.join(lspRoot, "lib", "cli.mjs");
  const typescriptServerPath = path.join(typescriptRoot, "lib", "tsserver.js");
  const typescriptLibraryPath = path.join(
    typescriptRoot,
    "lib",
    "lib.es2024.d.ts",
  );
  await Promise.all([
    writeFile(
      path.join(lspRoot, "package.json"),
      JSON.stringify({ version: "1.0.0" }),
    ),
    writeFile(languageServerPath, "server"),
    writeFile(
      path.join(typescriptRoot, "package.json"),
      JSON.stringify({ version: "5.9.3" }),
    ),
    writeFile(typescriptServerPath, "tsserver"),
    writeFile(path.join(typescriptRoot, "lib", "typescript.js"), "typescript"),
    writeFile(typescriptLibraryPath, "interface Array<T> {}"),
  ]);
  return {
    languageServerPath,
    typescriptServerPath,
    typescriptLibraryPath,
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
