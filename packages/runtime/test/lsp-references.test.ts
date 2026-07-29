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
  LspReferencesRunner,
  MAX_LSP_DIAGNOSTIC_FILE_BYTES,
  MAX_LSP_REFERENCES,
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

describe("LSP references runner", () => {
  it("resolves the fixed multi-file example with declaration control", async () => {
    const root = await realpath(
      fileURLToPath(
        new URL("../../../examples/lsp-references/", import.meta.url),
      ),
    );
    const runner = new LspReferencesRunner({
      workspaceRoot: root,
      sandbox: directSandbox(),
    });

    const included = await runner.run({
      path: "definition.ts",
      line: 1,
      character: 17,
      includeDeclaration: true,
    });
    const excluded = await runner.run({
      path: "definition.ts",
      line: 1,
      character: 17,
      includeDeclaration: false,
    });

    expect(included.details).toEqual(
      expect.objectContaining({
        status: "found",
        includeDeclaration: true,
        referenceCount: 6,
        omittedReferenceCount: 0,
        truncated: false,
        languageServerVersion: "5.3.0",
        typescriptVersion: "5.9.3",
      }),
    );
    expect(excluded.details).toEqual(
      expect.objectContaining({
        includeDeclaration: false,
        referenceCount: 5,
      }),
    );
    expect(included.locations.map((item) => item.path).sort()).toEqual([
      "definition.ts",
      "definition.ts",
      "first.ts",
      "first.ts",
      "second.ts",
      "second.ts",
    ]);
    expect(
      excluded.locations.filter((item) => item.path === "definition.ts"),
    ).toHaveLength(1);
  }, 20_000);

  it("rejects escapes and invalid positions before launching", async () => {
    const root = await createWorkspace();
    await writeFile(path.join(root, "source.ts"), "export const value = 1;\n");
    let launches = 0;
    const runner = new LspReferencesRunner({
      workspaceRoot: root,
      sandbox: {
        id: "references-no-launch",
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

  it("confines targets and rejects malformed workspace ranges", async () => {
    const root = await createWorkspace();
    const source = path.join(root, "source.ts");
    const target = path.join(root, "target.ts");
    const protectedTarget = path.join(root, "node_modules", "private.ts");
    const realTarget = path.join(root, "real-target.ts");
    const symlinkTarget = path.join(root, "alias-target.ts");
    const missingTarget = path.join(root, "missing-target.ts");
    const oversizedTarget = path.join(root, "oversized-target.ts");
    const invalidUtf8Target = path.join(root, "invalid-utf8-target.ts");
    const outsideRoot = await mkdtemp(
      path.join(tmpdir(), "napier-references-outside-test-"),
    );
    temporaryRoots.push(outsideRoot);
    const outside = path.join(outsideRoot, "outside.ts");
    await mkdir(path.dirname(protectedTarget), { recursive: true });
    await Promise.all([
      writeFile(source, "export const usage = target;\n"),
      writeFile(target, "export const target = 1;\n"),
      writeFile(protectedTarget, "export const privateValue = 1;\n"),
      writeFile(realTarget, "export const aliasValue = 2;\n"),
      writeFile(outside, "export const outside = 1;\n"),
      writeFile(
        oversizedTarget,
        Buffer.alloc(MAX_LSP_DIAGNOSTIC_FILE_BYTES + 1, 0x20),
      ),
      writeFile(invalidUtf8Target, Buffer.from([0xff, 0xfe, 0xfd])),
    ]);
    await symlink("real-target.ts", symlinkTarget);
    const [canonicalTarget, canonicalOutside] = await Promise.all([
      realpath(target),
      realpath(outside),
    ]);
    const response = [
      location(canonicalTarget, 13, 19),
      location(canonicalOutside, 13, 20),
      location(protectedTarget, 13, 25),
      location(symlinkTarget, 13, 23),
      location(missingTarget, 0, 1),
      location(oversizedTarget, 0, 1),
      location(invalidUtf8Target, 0, 1),
      { uri: "untitled:virtual-reference", range: range(0, 0, 0, 1) },
    ];
    const result = await new LspReferencesRunner({
      workspaceRoot: root,
      sandbox: controlledSandbox(() => response).sandbox,
    }).run({ path: "source.ts", line: 1, character: 22 });

    expect(result.details).toEqual(
      expect.objectContaining({
        status: "found",
        referenceCount: 1,
        omittedReferenceCount: 7,
      }),
    );
    expect(result.locations[0]?.path).toBe("target.ts");

    await expect(
      new LspReferencesRunner({
        workspaceRoot: root,
        sandbox: controlledSandbox(() => [
          {
            uri: pathToFileURL(canonicalTarget).href,
            range: range(0, 50, 0, 60),
          },
        ]).sandbox,
      }).run({ path: "source.ts", line: 1, character: 22 }),
    ).rejects.toThrow("out-of-range workspace target");
    await expect(
      new LspReferencesRunner({
        workspaceRoot: root,
        sandbox: controlledSandbox(() => [
          { uri: pathToFileURL(canonicalTarget).href },
        ]).sandbox,
      }).run({ path: "source.ts", line: 1, character: 22 }),
    ).rejects.toThrow("LSP references result 1 is malformed");
    await expect(
      new LspReferencesRunner({
        workspaceRoot: root,
        sandbox: controlledSandbox(() => location(canonicalTarget, 13, 19))
          .sandbox,
      }).run({ path: "source.ts", line: 1, character: 22 }),
    ).rejects.toThrow("LSP references response must be an array or null");
  });

  it("bounds, deduplicates, and stably hashes reference results", async () => {
    const root = await createWorkspace();
    const source = path.join(root, "source.ts");
    const target = path.join(root, "target.ts");
    const names = Array.from(
      { length: MAX_LSP_REFERENCES + 1 },
      (_, index) => `ref${String(index).padStart(3, "0")}`,
    );
    await Promise.all([
      writeFile(source, "export const usage = ref000;\n"),
      writeFile(
        target,
        names
          .map((name, index) => `export const ${name} = ${index};`)
          .join("\n"),
      ),
    ]);
    const canonicalTarget = await realpath(target);
    const locations = names.map((name, index) => ({
      uri: pathToFileURL(canonicalTarget).href,
      range: range(index, 13, index, 13 + name.length),
    }));
    let includeDeclaration: unknown;
    const truncated = await new LspReferencesRunner({
      workspaceRoot: root,
      sandbox: controlledSandbox((params) => {
        includeDeclaration =
          record(params) && record(params["context"])
            ? params["context"]["includeDeclaration"]
            : undefined;
        return locations;
      }).sandbox,
    }).run({
      path: "source.ts",
      line: 1,
      character: 22,
      includeDeclaration: false,
    });

    expect(includeDeclaration).toBe(false);
    expect(truncated.details).toEqual(
      expect.objectContaining({
        referenceCount: MAX_LSP_REFERENCES,
        omittedReferenceCount: 1,
        truncated: true,
      }),
    );
    const forward = await new LspReferencesRunner({
      workspaceRoot: root,
      sandbox: controlledSandbox(() => locations.slice(0, 2)).sandbox,
    }).run({ path: "source.ts", line: 1, character: 22 });
    const reverse = await new LspReferencesRunner({
      workspaceRoot: root,
      sandbox: controlledSandbox(() => locations.slice(0, 2).reverse()).sandbox,
    }).run({ path: "source.ts", line: 1, character: 22 });
    expect(reverse.details.referenceSetSha256).toBe(
      forward.details.referenceSetSha256,
    );
    expect(reverse.locations).toEqual(forward.locations);

    const duplicate = await new LspReferencesRunner({
      workspaceRoot: root,
      sandbox: controlledSandbox(() => [
        locations[0],
        locations[0],
        locations[1],
      ]).sandbox,
    }).run({ path: "source.ts", line: 1, character: 22 });
    expect(duplicate.details.referenceCount).toBe(2);
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
      new LspReferencesRunner({
        workspaceRoot: root,
        sandbox: sourceDrift.sandbox,
      }).run({ path: "source.ts", line: 1, character: 14 }),
    ).rejects.toThrow("LSP references target changed during execution");

    await writeFile(source, "export const value = 1;\n");
    const assets = await createFakeAssets(root);
    const runtimeDrift = controlledSandbox(async () => {
      await writeFile(assets.languageServerPath, "drifted");
      return null;
    });
    await expect(
      new LspReferencesRunner({
        workspaceRoot: root,
        sandbox: runtimeDrift.sandbox,
        languageServerPath: assets.languageServerPath,
        typescriptServerPath: assets.typescriptServerPath,
      }).run({ path: "source.ts", line: 1, character: 14 }),
    ).rejects.toThrow("LSP references runtime assets changed during execution");
  });

  it("returns not-found and terminates timeout, cancellation, and concurrent sessions", async () => {
    const root = await createWorkspace();
    const source = path.join(root, "source.ts");
    const target = path.join(root, "target.ts");
    await Promise.all([
      writeFile(source, "export const usage = target;\n"),
      writeFile(target, "export const target = 1;\n"),
    ]);
    const empty = controlledSandbox(() => null);
    const notFound = await new LspReferencesRunner({
      workspaceRoot: root,
      sandbox: empty.sandbox,
    }).run({ path: "source.ts", line: 1, character: 22 });
    expect(notFound.details.status).toBe("not_found");

    const hanging = controlledSandbox(() => new Promise(() => undefined));
    await expect(
      new LspReferencesRunner({
        workspaceRoot: root,
        sandbox: hanging.sandbox,
      }).run({
        path: "source.ts",
        line: 1,
        character: 22,
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow("LSP references timed out");
    expect(hanging.terminateCount()).toBeGreaterThan(0);

    const cancelled = controlledSandbox(() => new Promise(() => undefined));
    const controller = new AbortController();
    const pending = new LspReferencesRunner({
      workspaceRoot: root,
      sandbox: cancelled.sandbox,
    }).run({
      path: "source.ts",
      line: 1,
      character: 22,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 10);
    await expect(pending).rejects.toThrow("LSP references were aborted");
    expect(cancelled.terminateCount()).toBeGreaterThan(0);

    const canonicalTarget = await realpath(target);
    const concurrent = controlledSandbox(() => [
      location(canonicalTarget, 13, 19),
    ]);
    const runner = new LspReferencesRunner({
      workspaceRoot: root,
      sandbox: concurrent.sandbox,
    });
    const results = await Promise.all([
      runner.run({ path: "source.ts", line: 1, character: 22 }),
      runner.run({ path: "source.ts", line: 1, character: 22 }),
    ]);
    expect(results.map((result) => result.details.status)).toEqual([
      "found",
      "found",
    ]);
  }, 10_000);
});

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-references-test-"));
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
    id: "direct-references-test",
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

function controlledSandbox(
  references: (params: unknown) => unknown | Promise<unknown>,
): {
  sandbox: OsSandboxAdapter;
  terminateCount(): number;
} {
  let terminations = 0;
  return {
    terminateCount: () => terminations,
    sandbox: {
      id: "controlled-references-test",
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
        connection.onRequest("textDocument/references", references);
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
