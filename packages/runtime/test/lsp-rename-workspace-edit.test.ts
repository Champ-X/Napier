import { describe, expect, it } from "vitest";

import {
  assertLspRenamePreviewBytes,
  canonicalLspRenameEdits,
  lspRenameFiles,
  MAX_LSP_RENAME_EDITS,
  MAX_LSP_RENAME_FILES,
  MAX_LSP_RENAME_NEW_NAME_CHARS,
  MAX_LSP_RENAME_PREVIEW_BYTES,
  parseLspRenameWorkspaceEdit,
  parsePrepareRenameResult,
  prepareRenameReceipt,
  type LspRenameEdit,
  validateLspRenameNewName,
} from "../src/lsp-rename-workspace-edit.js";
import { range, textEdit } from "./lsp-rename-test-fixture.js";

describe("LSP rename WorkspaceEdit contract", () => {
  it("parses standard changes and versioned documentChanges", () => {
    expect(
      parseLspRenameWorkspaceEdit({
        changes: {
          "file:///workspace/first.ts": [textEdit("nextName", 0, 13, 0, 20)],
        },
      }),
    ).toEqual([
      {
        uri: "file:///workspace/first.ts",
        range: range(0, 13, 0, 20),
        newText: "nextName",
      },
    ]);
    expect(
      parseLspRenameWorkspaceEdit({
        documentChanges: [
          {
            textDocument: {
              uri: "file:///workspace/second.ts",
              version: 2,
            },
            edits: [textEdit("nextName", 1, 0, 1, 7)],
          },
        ],
      }),
    ).toEqual([
      {
        uri: "file:///workspace/second.ts",
        range: range(1, 0, 1, 7),
        newText: "nextName",
      },
    ]);
  });

  it("accepts standard prepare variants without retaining placeholders", () => {
    const direct = parsePrepareRenameResult(range(0, 1, 0, 8));
    const placeholder = parsePrepareRenameResult({
      range: range(1, 2, 1, 9),
      placeholder: "PRIVATE_SYMBOL",
    });
    const fallback = parsePrepareRenameResult({ defaultBehavior: true });

    expect(direct).toEqual({ kind: "range", range: range(0, 1, 0, 8) });
    expect(prepareRenameReceipt(placeholder)).toEqual({
      kind: "range",
      range: range(1, 2, 1, 9),
      placeholderSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(JSON.stringify(prepareRenameReceipt(placeholder))).not.toContain(
      "PRIVATE_SYMBOL",
    );
    expect(fallback).toEqual({ kind: "default" });
  });

  it("rejects resource operations, annotations, mixed shapes, and invalid edits", () => {
    expect(() =>
      parseLspRenameWorkspaceEdit({
        changes: {},
        documentChanges: [],
      }),
    ).toThrow("cannot contain both");
    expect(() =>
      parseLspRenameWorkspaceEdit({
        documentChanges: [
          {
            kind: "rename",
            oldUri: "file:///old.ts",
            newUri: "file:///new.ts",
          },
        ],
      }),
    ).toThrow("not a text edit");
    expect(() =>
      parseLspRenameWorkspaceEdit({
        changeAnnotations: {},
        changes: {},
      }),
    ).toThrow("annotated edits");
    expect(() =>
      parseLspRenameWorkspaceEdit({
        changes: {},
        experimentalOperation: true,
      }),
    ).toThrow("unsupported fields");
    expect(() =>
      parseLspRenameWorkspaceEdit({
        changes: {
          "file:///workspace/file.ts": [
            {
              ...textEdit("nextName", 0, 1, 0, 8),
              annotationId: "confirm",
            },
          ],
        },
      }),
    ).toThrow("annotated edits");
    expect(() =>
      parseLspRenameWorkspaceEdit({
        changes: {
          "file:///workspace/file.ts": [
            {
              ...textEdit("nextName", 0, 1, 0, 8),
              insertTextFormat: 2,
            },
          ],
        },
      }),
    ).toThrow("malformed");
    expect(() =>
      parseLspRenameWorkspaceEdit({
        changes: {
          "file:///workspace/file.ts": [textEdit("next\u0000Name", 0, 1, 0, 8)],
        },
      }),
    ).toThrow("malformed");
    expect(() =>
      parseLspRenameWorkspaceEdit({
        changes: {
          "file:///workspace/file.ts": [textEdit("nextName", 0, 1, 0, 1)],
        },
      }),
    ).toThrow("invalid range");
  });

  it("fails closed when file or edit limits are exceeded", () => {
    const files = Object.fromEntries(
      Array.from({ length: MAX_LSP_RENAME_FILES + 1 }, (_, index) => [
        `file:///workspace/file-${String(index)}.ts`,
        [textEdit("nextName", 0, 0, 0, 1)],
      ]),
    );
    expect(() => parseLspRenameWorkspaceEdit({ changes: files })).toThrow(
      `more than ${MAX_LSP_RENAME_FILES} files`,
    );

    const edits = Array.from({ length: MAX_LSP_RENAME_EDITS + 1 }, (_, index) =>
      textEdit("nextName", index, 0, index, 1),
    );
    expect(() =>
      parseLspRenameWorkspaceEdit({
        changes: { "file:///workspace/file.ts": edits },
      }),
    ).toThrow(`more than ${MAX_LSP_RENAME_EDITS} edits`);
  });

  it("canonicalizes files while rejecting overlap, duplicates, and file drift", () => {
    const first = renameEdit({
      path: "first.ts",
      startCharacter: 1,
      endCharacter: 4,
    });
    const second = renameEdit({
      path: "first.ts",
      startCharacter: 6,
      endCharacter: 9,
    });
    const canonical = canonicalLspRenameEdits([second, first]);
    expect(canonical.map((edit) => edit.startCharacter)).toEqual([1, 6]);
    expect(lspRenameFiles(canonical)).toEqual([
      expect.objectContaining({
        path: "first.ts",
        edits: canonical,
      }),
    ]);
    expect(() =>
      canonicalLspRenameEdits([
        first,
        renameEdit({
          path: "first.ts",
          startCharacter: 3,
          endCharacter: 7,
        }),
      ]),
    ).toThrow("overlapping");
    expect(() => canonicalLspRenameEdits([first, { ...first }])).toThrow(
      "overlapping",
    );
    expect(() =>
      canonicalLspRenameEdits([
        first,
        {
          ...second,
          fileSha256: "f".repeat(64),
        },
      ]),
    ).toThrow("drifting");
  });

  it("bounds proposed names before launching a language server", () => {
    expect(() => validateLspRenameNewName("nextName")).not.toThrow();
    expect(() => validateLspRenameNewName(" nextName")).toThrow("newName");
    expect(() => validateLspRenameNewName("next\nName")).toThrow("newName");
    expect(() =>
      validateLspRenameNewName("n".repeat(MAX_LSP_RENAME_NEW_NAME_CHARS + 1)),
    ).toThrow("newName");
  });

  it("fails closed when aggregate live preview text exceeds its byte budget", () => {
    expect(
      assertLspRenamePreviewBytes([
        renameEdit({
          path: "within.ts",
          startCharacter: 1,
          endCharacter: 4,
        }),
      ]),
    ).toBe(7);
    const oversized = Array.from({ length: 17 }, (_, index) =>
      renameEdit({
        path: `file-${String(index)}.ts`,
        startCharacter: 1,
        endCharacter: 4,
        oldText: "o".repeat(1_000),
        newText: "n".repeat(1_000),
      }),
    );
    expect(() => assertLspRenamePreviewBytes(oversized)).toThrow(
      `exceeds ${MAX_LSP_RENAME_PREVIEW_BYTES}`,
    );
  });
});

function renameEdit(
  input: Partial<LspRenameEdit> & {
    path: string;
    startCharacter: number;
    endCharacter: number;
  },
): LspRenameEdit {
  return {
    pathSha256: "a".repeat(64),
    fileSha256: "b".repeat(64),
    startLine: 1,
    endLine: 1,
    rangeSha256: "c".repeat(64),
    oldText: "old",
    oldTextSha256: "d".repeat(64),
    newText: "next",
    newTextSha256: "e".repeat(64),
    ...input,
  };
}
