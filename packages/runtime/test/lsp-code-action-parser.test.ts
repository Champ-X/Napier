import { describe, expect, it } from "vitest";

import {
  MAX_LSP_CODE_ACTION_RESPONSE_ACTIONS,
  MAX_LSP_CODE_ACTIONS,
  parseLspCodeActionResponse,
} from "../src/lsp-code-action-parser.js";
import { range, textEdit } from "./lsp-rename-test-fixture.js";

describe("LSP Code Action response contract", () => {
  it("accepts insertion edits while discarding commands, data, and diagnostics", () => {
    const parsed = parseLspCodeActionResponse([
      {
        title: 'Add import from "./definition"',
        kind: "quickfix",
        diagnostics: [{ message: "PRIVATE_DIAGNOSTIC" }],
        isPreferred: true,
        tags: [1],
        edit: {
          documentChanges: [
            {
              textDocument: {
                uri: "file:///workspace/usage.ts",
                version: 1,
              },
              edits: [
                textEdit(
                  'import { formatTitle } from "./definition";\n\n',
                  0,
                  0,
                  0,
                  0,
                ),
              ],
            },
          ],
        },
        command: {
          title: "",
          command: "_typescript.applyCodeActionCommand",
          arguments: ["PRIVATE_ARGUMENT"],
        },
        data: { private: "PRIVATE_DATA" },
      },
    ]);

    expect(parsed).toEqual({
      actions: [
        {
          title: 'Add import from "./definition"',
          kind: "quickfix",
          isPreferred: true,
          commandIgnored: true,
          edits: [
            {
              uri: "file:///workspace/usage.ts",
              range: range(0, 0, 0, 0),
              newText: 'import { formatTitle } from "./definition";\n\n',
              documentVersion: 1,
            },
          ],
        },
      ],
      omittedActionCount: 0,
      truncated: false,
    });
    expect(JSON.stringify(parsed)).not.toContain("PRIVATE_");
  });

  it("omits command-only, disabled, and edit-free alternatives", () => {
    const parsed = parseLspCodeActionResponse([
      {
        title: "Run a command",
        command: "_typescript.private",
        arguments: ["PRIVATE_ARGUMENT"],
      },
      {
        title: "Disabled fix",
        kind: "quickfix",
        disabled: { reason: "Not available" },
        edit: { changes: {} },
      },
      {
        title: "No edit",
        kind: "quickfix",
      },
    ]);

    expect(parsed).toEqual({
      actions: [],
      omittedActionCount: 3,
      truncated: false,
    });
  });

  it("rejects non-quick-fix, unknown, annotated, and resource-operation shapes", () => {
    expect(() =>
      parseLspCodeActionResponse([
        {
          title: "Extract function",
          kind: "refactor.extract",
          edit: {
            changes: {
              "file:///workspace/file.ts": [textEdit("next", 0, 0, 0, 0)],
            },
          },
        },
      ]),
    ).toThrow("not a quick fix");
    expect(() =>
      parseLspCodeActionResponse([
        {
          title: "Looks like a quick fix",
          kind: "quickfixevil",
          edit: {
            changes: {
              "file:///workspace/file.ts": [textEdit("next", 0, 0, 0, 0)],
            },
          },
        },
      ]),
    ).toThrow("not a quick fix");
    expect(() =>
      parseLspCodeActionResponse([
        {
          title: "Unknown",
          kind: "quickfix",
          privateField: true,
          edit: { changes: {} },
        },
      ]),
    ).toThrow("malformed");
    expect(() =>
      parseLspCodeActionResponse([
        {
          title: "Invalid tag",
          kind: "quickfix",
          tags: [2],
          edit: { changes: {} },
        },
      ]),
    ).toThrow("invalid tags");
    expect(() =>
      parseLspCodeActionResponse([
        {
          title: "Annotated",
          kind: "quickfix",
          edit: {
            changeAnnotations: {},
            changes: {},
          },
        },
      ]),
    ).toThrow("annotated edits");
    expect(() =>
      parseLspCodeActionResponse([
        {
          title: "Create a file",
          kind: "quickfix",
          edit: {
            documentChanges: [
              {
                kind: "create",
                uri: "file:///workspace/generated.ts",
              },
            ],
          },
        },
      ]),
    ).toThrow("not a text edit");
  });

  it("bounds response and exposed alternative counts", () => {
    const action = (index: number) => ({
      title: `Fix ${String(index)}`,
      kind: "quickfix",
      edit: {
        changes: {
          "file:///workspace/file.ts": [
            textEdit(String(index), index, 0, index, 0),
          ],
        },
      },
    });
    const parsed = parseLspCodeActionResponse(
      Array.from({ length: MAX_LSP_CODE_ACTIONS + 1 }, (_, index) =>
        action(index),
      ),
    );
    expect(parsed.actions).toHaveLength(MAX_LSP_CODE_ACTIONS);
    expect(parsed.omittedActionCount).toBe(1);
    expect(parsed.truncated).toBe(true);

    expect(() =>
      parseLspCodeActionResponse(
        Array.from(
          { length: MAX_LSP_CODE_ACTION_RESPONSE_ACTIONS + 1 },
          (_, index) => action(index),
        ),
      ),
    ).toThrow(`more than ${MAX_LSP_CODE_ACTION_RESPONSE_ACTIONS} actions`);
  });

  it("accepts a null response but rejects malformed command and title fields", () => {
    expect(parseLspCodeActionResponse(null)).toEqual({
      actions: [],
      omittedActionCount: 0,
      truncated: false,
    });
    expect(() =>
      parseLspCodeActionResponse([
        {
          title: "Invalid command",
          kind: "quickfix",
          command: { title: "Run", command: 1 },
          edit: {
            changes: {
              "file:///workspace/file.ts": [textEdit("next", 0, 0, 0, 0)],
            },
          },
        },
      ]),
    ).toThrow("invalid command");
    expect(() =>
      parseLspCodeActionResponse([
        {
          title: "line\nbreak",
          kind: "quickfix",
          edit: { changes: {} },
        },
      ]),
    ).toThrow("malformed");
  });
});
