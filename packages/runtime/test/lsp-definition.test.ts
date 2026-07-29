import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-jsonrpc/node.js";
import { afterEach, describe, expect, it } from "vitest";

import {
  LspDefinitionRunner,
  MAX_LSP_DEFINITIONS,
  MAX_LSP_DIAGNOSTIC_FILE_BYTES,
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

describe("LSP definition runner", () => {
  it("resolves the fixed TypeScript example through standard definitions", async () => {
    const root = await realpath(
      fileURLToPath(
        new URL("../../../examples/lsp-definition/", import.meta.url),
      ),
    );
    const runner = new LspDefinitionRunner({
      workspaceRoot: root,
      sandbox: directSandbox(),
    });

    const alias = await runner.run({
      path: "usage.ts",
      line: 3,
      character: 22,
    });

    expect(alias.details).toEqual(
      expect.objectContaining({
        status: "found",
        definitionCount: 1,
        omittedDefinitionCount: 0,
        languageServerVersion: "5.3.0",
        typescriptVersion: "5.9.3",
      }),
    );
    expect(alias.locations).toEqual([
      expect.objectContaining({
        path: "definition.ts",
        startLine: 1,
        preview: "formatTitle",
        fileSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        rangeSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    ]);
  }, 20_000);

  it("resolves a real same-file TypeScript definition", async () => {
    const root = await createWorkspace();
    await writeFile(
      path.join(root, "same-file.ts"),
      'function normalize(value: string): string {\n  return value.trim();\n}\n\nexport const result = normalize(" value ");\n',
    );
    const result = await new LspDefinitionRunner({
      workspaceRoot: root,
      sandbox: directSandbox(),
    }).run({
      path: "same-file.ts",
      line: 5,
      character: 23,
    });

    expect(result.locations).toEqual([
      expect.objectContaining({
        path: "same-file.ts",
        startLine: 1,
        preview: "normalize",
      }),
    ]);
  }, 20_000);

  it("rejects escapes and invalid positions before launching a process", async () => {
    const root = await createWorkspace();
    await writeFile(path.join(root, "source.ts"), "export const value = 1;\n");
    let launches = 0;
    const runner = new LspDefinitionRunner({
      workspaceRoot: root,
      sandbox: {
        id: "definition-no-launch",
        async launch() {
          launches += 1;
          throw new Error("launch must not be reached");
        },
      },
    });

    await expect(
      runner.run({ path: "../source.ts", line: 1, character: 1 }),
    ).rejects.toThrow("escapes");
    await expect(
      runner.run({ path: "source.ts", line: 0, character: 1 }),
    ).rejects.toThrow("positive 1-based");
    await expect(
      runner.run({ path: "source.ts", line: 1, character: 500 }),
    ).rejects.toThrow("outside the source");
    expect(launches).toBe(0);
  });

  it("omits external definitions and rejects malformed workspace ranges", async () => {
    const root = await createWorkspace();
    const source = path.join(root, "source.ts");
    const target = path.join(root, "target.ts");
    const outsideRoot = await mkdtemp(
      path.join(tmpdir(), "napier-definition-outside-test-"),
    );
    temporaryRoots.push(outsideRoot);
    const outside = path.join(outsideRoot, "outside.ts");
    await Promise.all([
      writeFile(source, "export const usage = target;\n"),
      writeFile(target, "export const target = 1;\n"),
      writeFile(outside, "export const outside = 1;\n"),
    ]);
    const [canonicalTarget, canonicalOutside] = await Promise.all([
      realpath(target),
      realpath(outside),
    ]);
    const controlled = controlledSandbox(() => [
      location(canonicalTarget, 13, 19),
      location(canonicalOutside, 13, 20),
      {
        uri: "untitled:virtual-definition",
        range: range(0, 0, 0, 1),
      },
    ]);
    const result = await new LspDefinitionRunner({
      workspaceRoot: root,
      sandbox: controlled.sandbox,
    }).run({ path: "source.ts", line: 1, character: 22 });

    expect(result.details).toEqual(
      expect.objectContaining({
        status: "found",
        definitionCount: 1,
        omittedDefinitionCount: 2,
      }),
    );
    expect(result.locations[0]?.path).toBe("target.ts");

    const malformed = controlledSandbox(() => ({
      uri: pathToFileURL(canonicalTarget).href,
      range: range(0, 50, 0, 60),
    }));
    await expect(
      new LspDefinitionRunner({
        workspaceRoot: root,
        sandbox: malformed.sandbox,
      }).run({ path: "source.ts", line: 1, character: 22 }),
    ).rejects.toThrow("out-of-range workspace target");
  });

  it("parses LocationLink, truncates results, and hashes sets independent of response order", async () => {
    const root = await createWorkspace();
    const source = path.join(root, "source.ts");
    const target = path.join(root, "target.ts");
    const symbols = Array.from(
      { length: MAX_LSP_DEFINITIONS + 1 },
      (_, index) => `symbol${String(index).padStart(2, "0")}`,
    );
    await Promise.all([
      writeFile(source, "export const usage = symbol00;\n"),
      writeFile(
        target,
        symbols
          .map((symbol, index) => `export const ${symbol} = ${index};`)
          .join("\n"),
      ),
    ]);
    const canonicalTarget = await realpath(target);
    const links = symbols.map((symbol, index) => ({
      targetUri: pathToFileURL(canonicalTarget).href,
      targetRange: range(index, 0, index, 25),
      targetSelectionRange: range(index, 13, index, 13 + symbol.length),
    }));
    const truncated = await new LspDefinitionRunner({
      workspaceRoot: root,
      sandbox: controlledSandbox(() => links).sandbox,
    }).run({ path: "source.ts", line: 1, character: 22 });

    expect(truncated.details).toEqual(
      expect.objectContaining({
        definitionCount: MAX_LSP_DEFINITIONS,
        omittedDefinitionCount: 1,
        truncated: true,
      }),
    );
    expect(truncated.locations.map((item) => item.preview)).toContain(
      "symbol00",
    );
    expect(truncated.locations.map((item) => item.preview)).not.toContain(
      `symbol${MAX_LSP_DEFINITIONS}`,
    );

    const forward = await new LspDefinitionRunner({
      workspaceRoot: root,
      sandbox: controlledSandbox(() => links.slice(0, 2)).sandbox,
    }).run({ path: "source.ts", line: 1, character: 22 });
    const reverse = await new LspDefinitionRunner({
      workspaceRoot: root,
      sandbox: controlledSandbox(() => links.slice(0, 2).reverse()).sandbox,
    }).run({ path: "source.ts", line: 1, character: 22 });
    expect(reverse.details.definitionSetSha256).toBe(
      forward.details.definitionSetSha256,
    );
    expect(reverse.locations).toEqual(forward.locations);
  });

  it("omits protected, symlinked, missing, oversized, and invalid UTF-8 targets", async () => {
    const root = await createWorkspace();
    const source = path.join(root, "source.ts");
    const protectedTarget = path.join(root, "node_modules", "private.ts");
    const realTarget = path.join(root, "real-target.ts");
    const symlinkTarget = path.join(root, "alias-target.ts");
    const missingTarget = path.join(root, "missing-target.ts");
    const oversizedTarget = path.join(root, "oversized-target.ts");
    const invalidUtf8Target = path.join(root, "invalid-utf8-target.ts");
    await mkdir(path.dirname(protectedTarget), { recursive: true });
    await Promise.all([
      writeFile(source, "export const usage = privateValue;\n"),
      writeFile(protectedTarget, "export const privateValue = 1;\n"),
      writeFile(realTarget, "export const privateValue = 2;\n"),
      writeFile(
        oversizedTarget,
        Buffer.alloc(MAX_LSP_DIAGNOSTIC_FILE_BYTES + 1, 0x20),
      ),
      writeFile(invalidUtf8Target, Buffer.from([0xff, 0xfe, 0xfd])),
    ]);
    await symlink("real-target.ts", symlinkTarget);
    const controlled = controlledSandbox(() => [
      location(protectedTarget, 13, 25),
      location(symlinkTarget, 13, 25),
      location(missingTarget, 0, 1),
      location(oversizedTarget, 0, 1),
      location(invalidUtf8Target, 0, 1),
    ]);

    const result = await new LspDefinitionRunner({
      workspaceRoot: root,
      sandbox: controlled.sandbox,
    }).run({ path: "source.ts", line: 1, character: 22 });

    expect(result.details).toEqual(
      expect.objectContaining({
        status: "not_found",
        definitionCount: 0,
        omittedDefinitionCount: 5,
      }),
    );
    expect(result.locations).toEqual([]);
  });

  it("fails closed on source or runtime drift", async () => {
    const root = await createWorkspace();
    const source = path.join(root, "source.ts");
    await writeFile(source, "export const value = 1;\n");
    const sourceDrift = controlledSandbox(async () => {
      await writeFile(source, "export const value = 2;\n");
      return null;
    });
    await expect(
      new LspDefinitionRunner({
        workspaceRoot: root,
        sandbox: sourceDrift.sandbox,
      }).run({ path: "source.ts", line: 1, character: 14 }),
    ).rejects.toThrow("LSP definition target changed during execution");

    await writeFile(source, "export const value = 1;\n");
    const assets = await createFakeAssets(root);
    const runtimeDrift = controlledSandbox(async () => {
      await writeFile(assets.languageServerPath, "drifted");
      return null;
    });
    await expect(
      new LspDefinitionRunner({
        workspaceRoot: root,
        sandbox: runtimeDrift.sandbox,
        languageServerPath: assets.languageServerPath,
        typescriptServerPath: assets.typescriptServerPath,
      }).run({ path: "source.ts", line: 1, character: 14 }),
    ).rejects.toThrow("LSP definition runtime assets changed during execution");
  });

  it("isolates concurrent definition sessions", async () => {
    const root = await createWorkspace();
    const source = path.join(root, "source.ts");
    const target = path.join(root, "target.ts");
    await Promise.all([
      writeFile(source, "export const usage = target;\n"),
      writeFile(target, "export const target = 1;\n"),
    ]);
    const canonicalTarget = await realpath(target);
    const controlled = controlledSandbox(() =>
      location(canonicalTarget, 13, 19),
    );
    const runner = new LspDefinitionRunner({
      workspaceRoot: root,
      sandbox: controlled.sandbox,
    });

    const results = await Promise.all([
      runner.run({ path: "source.ts", line: 1, character: 22 }),
      runner.run({ path: "source.ts", line: 1, character: 22 }),
    ]);

    expect(results.map((result) => result.details.status)).toEqual([
      "found",
      "found",
    ]);
    expect(results[0]?.locations).toEqual(results[1]?.locations);
  });

  it("returns not-found and terminates on timeout or cancellation", async () => {
    const root = await createWorkspace();
    await writeFile(path.join(root, "source.ts"), "export const value = 1;\n");
    const empty = controlledSandbox(() => null);
    const result = await new LspDefinitionRunner({
      workspaceRoot: root,
      sandbox: empty.sandbox,
    }).run({ path: "source.ts", line: 1, character: 14 });
    expect(result.details).toEqual(
      expect.objectContaining({
        status: "not_found",
        definitionCount: 0,
      }),
    );

    const hanging = controlledSandbox(() => new Promise(() => undefined));
    await expect(
      new LspDefinitionRunner({
        workspaceRoot: root,
        sandbox: hanging.sandbox,
      }).run({
        path: "source.ts",
        line: 1,
        character: 14,
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow("LSP definition timed out");
    expect(hanging.terminateCount()).toBeGreaterThan(0);

    const cancelled = controlledSandbox(() => new Promise(() => undefined));
    const controller = new AbortController();
    const pending = new LspDefinitionRunner({
      workspaceRoot: root,
      sandbox: cancelled.sandbox,
    }).run({
      path: "source.ts",
      line: 1,
      character: 14,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 10);
    await expect(pending).rejects.toThrow("LSP definition was aborted");
    expect(cancelled.terminateCount()).toBeGreaterThan(0);
  }, 10_000);
});

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-definition-test-"));
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

function directSandbox(): OsSandboxAdapter {
  return {
    id: "direct-definition-test",
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

function controlledSandbox(definition: () => unknown | Promise<unknown>): {
  sandbox: OsSandboxAdapter;
  terminateCount(): number;
} {
  let terminations = 0;
  return {
    terminateCount: () => terminations,
    sandbox: {
      id: "controlled-definition-test",
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
        connection.onRequest("initialize", () => ({ capabilities: {} }));
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
        connection.onRequest("textDocument/definition", definition);
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

function location(
  target: string,
  startCharacter: number,
  endCharacter: number,
) {
  return {
    uri: pathToFileURL(target).href,
    range: range(0, startCharacter, 0, endCharacter),
  };
}

function range(
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

async function createFakeAssets(root: string): Promise<{
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

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
