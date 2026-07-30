import {
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { LspCodeActionsRunner } from "../src/lsp-code-actions.js";
import {
  controlledLspCodeActionsSandbox,
  diagnostic,
} from "./lsp-code-actions-test-fixture.js";
import {
  createFakeLspAssets,
  createLspRenameWorkspace,
  directLspSandbox,
  textEdit,
} from "./lsp-rename-test-fixture.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("LSP Code Actions runner", () => {
  it("previews a real preferred missing-import quick fix without writing", async () => {
    const root = await createLspRenameWorkspace(temporaryRoots);
    const definition = [
      "export function formatTitle(value: string): string {",
      "  return value.trim();",
      "}",
      "",
    ].join("\n");
    const usage = 'export const title = formatTitle(" value ");\n';
    await Promise.all([
      writeFile(path.join(root, "definition.ts"), definition),
      writeFile(path.join(root, "usage.ts"), usage),
    ]);

    const result = await new LspCodeActionsRunner({
      workspaceRoot: root,
      sandbox: directLspSandbox(),
    }).run({
      path: "usage.ts",
      line: 1,
      character: 22,
    });

    expect(result.details).toEqual(
      expect.objectContaining({
        status: "found",
        language: "typescript",
        diagnosticCount: 1,
        preferredActionCount: 1,
        fileCount: 1,
        languageServerVersion: "5.3.0",
        typescriptVersion: "5.9.3",
      }),
    );
    const preferred = result.actions.find((action) => action.isPreferred);
    expect(preferred).toEqual(
      expect.objectContaining({
        kind: "quickfix",
        commandIgnored: true,
      }),
    );
    expect(preferred?.files).toEqual([
      expect.objectContaining({
        path: "usage.ts",
        edits: [
          expect.objectContaining({
            startLine: 1,
            startCharacter: 1,
            endLine: 1,
            endCharacter: 1,
            oldText: "",
            newText: expect.stringContaining("formatTitle"),
          }),
        ],
      }),
    ]);
    expect(await readFile(path.join(root, "usage.ts"), "utf8")).toBe(usage);
  }, 20_000);

  it("returns bounded text edits while dropping command and diagnostic bodies", async () => {
    const root = await createWorkspace();
    const source = path.join(root, "usage.ts");
    const sourceUri = pathToFileURL(await realpath(source)).href;
    const insertion = 'import { formatTitle } from "./definition.js";\n\n';
    const sandbox = controlledLspCodeActionsSandbox({
      diagnostics: [
        diagnostic("PRIVATE_DIAGNOSTIC", 0, 21, 0, 32),
        diagnostic("OTHER_DIAGNOSTIC", 1, 0, 1, 1),
      ],
      codeActions: (params) => {
        const context =
          record(params) && record(params["context"]) ? params["context"] : {};
        expect(context["only"]).toEqual(["quickfix"]);
        expect(context["triggerKind"]).toBe(1);
        expect(JSON.stringify(context["diagnostics"])).toContain(
          "PRIVATE_DIAGNOSTIC",
        );
        expect(JSON.stringify(context["diagnostics"])).not.toContain(
          "OTHER_DIAGNOSTIC",
        );
        return [
          {
            title: "Add import",
            kind: "quickfix",
            isPreferred: true,
            edit: {
              changes: {
                [sourceUri]: [textEdit(insertion, 0, 0, 0, 0)],
              },
            },
            command: {
              title: "PRIVATE_COMMAND_TITLE",
              command: "_typescript.PRIVATE_COMMAND",
              arguments: ["PRIVATE_ARGUMENT"],
            },
            data: { private: "PRIVATE_DATA" },
          },
        ];
      },
    });

    const result = await runner(root, sandbox.sandbox).run({
      path: "usage.ts",
      line: 1,
      character: 22,
    });

    expect(result.details).toEqual(
      expect.objectContaining({
        status: "found",
        complete: true,
        truncated: false,
        diagnosticCount: 1,
        actionCount: 1,
        omittedActionCount: 0,
        preferredActionCount: 1,
        commandIgnoredCount: 1,
        fileCount: 1,
        editCount: 1,
      }),
    );
    expect(result.actions[0]?.files[0]?.edits[0]).toEqual(
      expect.objectContaining({
        oldText: "",
        newText: insertion,
      }),
    );
    expect(JSON.stringify(result)).not.toContain("PRIVATE_");
    expect(await readFile(source, "utf8")).toBe(
      'export const title = formatTitle(" value ");\n',
    );
  });

  it("does not request actions outside the diagnostic half-open range", async () => {
    const root = await createWorkspace();
    const sandbox = controlledLspCodeActionsSandbox({
      diagnostics: [diagnostic("missing", 0, 0, 0, 1)],
      codeActions: () => {
        throw new Error("code action must not be requested");
      },
    });

    const result = await runner(root, sandbox.sandbox).run({
      path: "usage.ts",
      line: 1,
      character: 2,
    });

    expect(result.details).toEqual(
      expect.objectContaining({
        status: "not_found",
        diagnosticCount: 0,
        actionCount: 0,
      }),
    );
    expect(sandbox.codeActionCount()).toBe(0);
  });

  it("normalizes the TypeScript line-break insertion quirk for CRLF files", async () => {
    const root = await createWorkspace();
    const source = path.join(root, "usage.ts");
    await writeFile(source, "x\r\n");
    const sourceUri = pathToFileURL(await realpath(source)).href;
    const sandbox = controlledLspCodeActionsSandbox({
      diagnostics: [diagnostic("missing", 0, 0, 0, 1)],
      codeActions: () => [
        {
          title: "Append declaration",
          kind: "quickfix",
          edit: {
            changes: {
              [sourceUri]: [textEdit("const fixed = true;\r\n", 0, 2, 0, 2)],
            },
          },
        },
      ],
    });

    const result = await runner(root, sandbox.sandbox).run({
      path: "usage.ts",
      line: 1,
      character: 1,
    });

    expect(result.actions[0]?.files[0]?.edits[0]).toEqual(
      expect.objectContaining({
        startLine: 2,
        startCharacter: 1,
        endLine: 2,
        endCharacter: 1,
        oldText: "",
      }),
    );
  });

  it("fails closed for external, protected, symlinked, and drifting targets", async () => {
    const root = await createWorkspace();
    const source = path.join(root, "usage.ts");
    const outsideRoot = await createWorkspace();
    const outside = path.join(outsideRoot, "usage.ts");
    const protectedTarget = path.join(root, "node_modules", "private.ts");
    const realTarget = path.join(root, "real-target.ts");
    const symlinkTarget = path.join(root, "alias-target.ts");
    await mkdir(path.dirname(protectedTarget), { recursive: true });
    await Promise.all([
      writeFile(protectedTarget, "export const value = 1;\n"),
      writeFile(realTarget, "export const value = 2;\n"),
    ]);
    await symlink("real-target.ts", symlinkTarget);

    for (const target of [
      await realpath(outside),
      await realpath(protectedTarget),
      symlinkTarget,
    ]) {
      await expect(
        codeActionsWithResponse(root, {
          changes: {
            [pathToFileURL(target).href]: [textEdit("next", 0, 0, 0, 0)],
          },
        }),
      ).rejects.toThrow("unsupported or out-of-workspace");
    }

    const drift = controlledLspCodeActionsSandbox({
      diagnostics: [diagnostic("missing", 0, 21, 0, 32)],
      codeActions: async () => {
        await writeFile(source, "export const drifted = true;\n");
        return [];
      },
    });
    await expect(
      runner(root, drift.sandbox).run({
        path: "usage.ts",
        line: 1,
        character: 22,
      }),
    ).rejects.toThrow("LSP code action target changed during execution");
  });

  it("detects runtime drift and terminates timeout or cancellation", async () => {
    const root = await createWorkspace();
    const assets = await createFakeLspAssets(root);
    const runtimeDrift = controlledLspCodeActionsSandbox({
      diagnostics: [diagnostic("missing", 0, 21, 0, 32)],
      codeActions: async () => {
        await writeFile(assets.languageServerPath, "drifted");
        return [];
      },
    });
    await expect(
      new LspCodeActionsRunner({
        workspaceRoot: root,
        sandbox: runtimeDrift.sandbox,
        languageServerPath: assets.languageServerPath,
        typescriptServerPath: assets.typescriptServerPath,
      }).run({
        path: "usage.ts",
        line: 1,
        character: 22,
      }),
    ).rejects.toThrow(
      "LSP code action runtime assets changed during execution",
    );

    const hanging = controlledLspCodeActionsSandbox({
      diagnostics: [diagnostic("missing", 0, 21, 0, 32)],
      codeActions: () => new Promise(() => undefined),
    });
    await expect(
      runner(root, hanging.sandbox).run({
        path: "usage.ts",
        line: 1,
        character: 22,
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow("LSP code action timed out");
    expect(hanging.terminateCount()).toBeGreaterThan(0);

    const cancelled = controlledLspCodeActionsSandbox({
      diagnostics: [diagnostic("missing", 0, 21, 0, 32)],
      codeActions: () => new Promise(() => undefined),
    });
    const controller = new AbortController();
    const pending = runner(root, cancelled.sandbox).run({
      path: "usage.ts",
      line: 1,
      character: 22,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 10);
    await expect(pending).rejects.toThrow("LSP code action was aborted");
    expect(cancelled.terminateCount()).toBeGreaterThan(0);
  });

  it("isolates concurrent language-server sessions", async () => {
    const root = await createWorkspace();
    const sourceUri = pathToFileURL(
      await realpath(path.join(root, "usage.ts")),
    ).href;
    const sandbox = controlledLspCodeActionsSandbox({
      diagnostics: [diagnostic("missing", 0, 21, 0, 32)],
      codeActions: () => [
        {
          title: "Add import",
          kind: "quickfix",
          edit: {
            changes: {
              [sourceUri]: [textEdit("import {};\n", 0, 0, 0, 0)],
            },
          },
        },
      ],
    });
    const codeActions = runner(root, sandbox.sandbox);

    const results = await Promise.all([
      codeActions.run({
        path: "usage.ts",
        line: 1,
        character: 22,
      }),
      codeActions.run({
        path: "usage.ts",
        line: 1,
        character: 22,
      }),
    ]);

    expect(results.map((result) => result.details.status)).toEqual([
      "found",
      "found",
    ]);
    expect(sandbox.codeActionCount()).toBe(2);
  });
});

async function createWorkspace(): Promise<string> {
  const root = await createLspRenameWorkspace(temporaryRoots);
  await writeFile(
    path.join(root, "usage.ts"),
    'export const title = formatTitle(" value ");\n',
  );
  return root;
}

function runner(
  workspaceRoot: string,
  sandbox: Parameters<typeof controlledLspCodeActionsSandbox>[0] extends never
    ? never
    : ReturnType<typeof controlledLspCodeActionsSandbox>["sandbox"],
): LspCodeActionsRunner {
  return new LspCodeActionsRunner({ workspaceRoot, sandbox });
}

async function codeActionsWithResponse(
  root: string,
  edit: unknown,
): Promise<unknown> {
  const sandbox = controlledLspCodeActionsSandbox({
    diagnostics: [diagnostic("missing", 0, 21, 0, 32)],
    codeActions: () => [
      {
        title: "Apply fix",
        kind: "quickfix",
        edit,
      },
    ],
  });
  return runner(root, sandbox.sandbox).run({
    path: "usage.ts",
    line: 1,
    character: 22,
  });
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
