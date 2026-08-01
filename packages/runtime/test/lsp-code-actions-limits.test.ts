import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  LspCodeActionsRunner,
  MAX_LSP_CODE_ACTIONS,
  MAX_LSP_RENAME_EDITS,
  MAX_LSP_RENAME_FILES,
  MAX_LSP_RENAME_PREVIEW_BYTES,
} from "../src/index.js";
import {
  controlledLspCodeActionsSandbox,
  diagnostic,
} from "./lsp-code-actions-test-fixture.js";
import { textEdit } from "./lsp-rename-test-fixture.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("LSP Code Actions aggregate limits", () => {
  it("bounds total edits across alternatives", async () => {
    const root = await createWorkspace();
    const targetUri = "file:///outside-total-edit-limit.ts";
    const sandbox = controlledLspCodeActionsSandbox({
      diagnostics: [diagnostic("missing", 0, 21, 0, 32)],
      codeActions: () =>
        Array.from({ length: MAX_LSP_CODE_ACTIONS }, (_, actionIndex) => ({
          title: `Fix ${String(actionIndex)}`,
          kind: "quickfix",
          edit: {
            changes: {
              [targetUri]: Array.from({ length: 17 }, (_, editIndex) =>
                textEdit("x", 0, editIndex, 0, editIndex),
              ),
            },
          },
        })),
    });

    await expect(run(root, sandbox.sandbox)).rejects.toThrow(
      `exceed ${MAX_LSP_RENAME_EDITS} total edits`,
    );
  });

  it("bounds aggregate old and new preview text across alternatives", async () => {
    const root = await createWorkspace();
    const targetUri = "file:///outside-preview-limit.ts";
    const sandbox = controlledLspCodeActionsSandbox({
      diagnostics: [diagnostic("missing", 0, 21, 0, 32)],
      codeActions: () =>
        Array.from({ length: MAX_LSP_CODE_ACTIONS }, (_, actionIndex) => ({
          title: `Fix ${String(actionIndex)}`,
          kind: "quickfix",
          edit: {
            changes: {
              [targetUri]: [0, 1, 2].map((character) =>
                textEdit("x".repeat(800), 0, character, 0, character),
              ),
            },
          },
        })),
    });

    await expect(run(root, sandbox.sandbox)).rejects.toThrow(
      `LSP code action preview exceeds ${MAX_LSP_RENAME_PREVIEW_BYTES}`,
    );
  });

  it("bounds distinct target files across alternatives", async () => {
    const root = await createWorkspace();
    const targets = Array.from(
      { length: MAX_LSP_RENAME_FILES + 2 },
      (_, index) => `file:///outside-target-${String(index)}.ts`,
    );
    const sandbox = controlledLspCodeActionsSandbox({
      diagnostics: [diagnostic("missing", 0, 21, 0, 32)],
      codeActions: () =>
        [targets.slice(0, 17), targets.slice(17)].map((uris, actionIndex) => ({
          title: `Fix files ${String(actionIndex)}`,
          kind: "quickfix",
          edit: {
            changes: Object.fromEntries(
              uris.map((uri) => [uri, [textEdit("x", 0, 0, 0, 0)]]),
            ),
          },
        })),
    });

    await expect(run(root, sandbox.sandbox)).rejects.toThrow(
      `exceed ${MAX_LSP_RENAME_FILES} total files`,
    );
  });

  it("bounds sequential Code Action resolve requests and marks truncation", async () => {
    const root = await createWorkspace();
    const targetUri = pathToFileURL(
      await realpath(path.join(root, "usage.ts")),
    ).href;
    const sandbox = controlledLspCodeActionsSandbox({
      diagnostics: [diagnostic("missing", 0, 21, 0, 32)],
      codeActions: () =>
        Array.from({ length: MAX_LSP_CODE_ACTIONS + 1 }, (_, index) => ({
          title: `Resolve ${String(index)}`,
          kind: "quickfix",
          data: { index },
        })),
      codeActionResolve: (action) => {
        const index =
          record(action) &&
          record(action["data"]) &&
          Number.isSafeInteger(action["data"]["index"])
            ? Number(action["data"]["index"])
            : -1;
        return {
          ...(record(action) ? action : {}),
          edit: {
            changes: {
              [targetUri]: [textEdit(`fix${String(index)}`, 0, 0, 0, 0)],
            },
          },
        };
      },
    });

    const result = await run(root, sandbox.sandbox);

    expect(result.details).toEqual(
      expect.objectContaining({
        actionCount: MAX_LSP_CODE_ACTIONS,
        omittedActionCount: 1,
        truncated: true,
        resolveRequestCount: MAX_LSP_CODE_ACTIONS,
        resolvedActionCount: MAX_LSP_CODE_ACTIONS,
        resolveOmittedCount: 1,
      }),
    );
    expect(sandbox.resolveCount()).toBe(MAX_LSP_CODE_ACTIONS);
  });

  it("marks an exhausted resolve budget even when no action becomes usable", async () => {
    const root = await createWorkspace();
    const sandbox = controlledLspCodeActionsSandbox({
      diagnostics: [diagnostic("missing", 0, 21, 0, 32)],
      codeActions: () =>
        Array.from({ length: MAX_LSP_CODE_ACTIONS + 1 }, (_, index) => ({
          title: `Unproductive ${String(index)}`,
          kind: "quickfix",
          data: { index },
        })),
      codeActionResolve: (action) => action,
    });

    const result = await run(root, sandbox.sandbox);

    expect(result.details).toEqual(
      expect.objectContaining({
        status: "not_found",
        actionCount: 0,
        omittedActionCount: MAX_LSP_CODE_ACTIONS + 1,
        truncated: true,
        resolveRequestCount: MAX_LSP_CODE_ACTIONS,
        resolvedActionCount: 0,
        resolveOmittedCount: MAX_LSP_CODE_ACTIONS + 1,
      }),
    );
    expect(sandbox.resolveCount()).toBe(MAX_LSP_CODE_ACTIONS);
  });
});

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-code-action-limits-"));
  temporaryRoots.push(root);
  const target = path.join(root, "usage.ts");
  await Promise.all([
    writeFile(
      path.join(root, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { strict: true, noEmit: true } }),
    ),
    writeFile(target, 'export const title = formatTitle(" value ");\n'),
  ]);
  return root;
}

async function run(
  root: string,
  sandbox: ReturnType<typeof controlledLspCodeActionsSandbox>["sandbox"],
): Promise<Awaited<ReturnType<LspCodeActionsRunner["run"]>>> {
  return new LspCodeActionsRunner({
    workspaceRoot: root,
    sandbox,
  }).run({
    path: "usage.ts",
    line: 1,
    character: 22,
  });
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
