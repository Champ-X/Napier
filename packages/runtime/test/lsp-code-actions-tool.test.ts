import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  createLspCodeActionsTool,
  lspCodeActionsToolCallArgumentsLedgerProjection,
  lspCodeActionsToolOutputLedgerProjection,
  MAX_LSP_RENAME_TOOL_OUTPUT_BYTES,
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

describe("LSP Code Actions Agent tool boundary", () => {
  it("returns live edit previews without exposing ignored commands", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-code-action-tool-"));
    temporaryRoots.push(root);
    const target = path.join(root, "private-usage.ts");
    await writeFile(target, 'export const title = formatTitle(" value ");\n');
    const targetUri = pathToFileURL(await realpath(target)).href;
    const sandbox = controlledLspCodeActionsSandbox({
      diagnostics: [diagnostic("PRIVATE_DIAGNOSTIC", 0, 21, 0, 32)],
      codeActions: () => [
        {
          title: "Add import",
          kind: "quickfix",
          isPreferred: true,
          edit: {
            changes: {
              [targetUri]: [
                textEdit(
                  'import { formatTitle } from "./definition.js";\n\n',
                  0,
                  0,
                  0,
                  0,
                ),
              ],
            },
          },
          command: {
            title: "",
            command: "_typescript.PRIVATE_COMMAND",
            arguments: ["PRIVATE_ARGUMENT"],
          },
        },
      ],
    });
    const tool = createLspCodeActionsTool({
      workspaceRoot: root,
      sandbox: sandbox.sandbox,
    });

    const result = await tool.execute("code-action-1", {
      path: "private-usage.ts",
      line: 1,
      character: 22,
    });
    const output =
      result.content[0]?.type === "text" ? result.content[0].text : "";

    expect(output).toContain('ACTION 1 "Add import"');
    expect(output).toContain("Preferred: true");
    expect(output).toContain("Command ignored: true");
    expect(output).toContain("No command ran and no file changed.");
    expect(output).not.toContain("PRIVATE_DIAGNOSTIC");
    expect(output).not.toContain("PRIVATE_COMMAND");
    expect(output).not.toContain("PRIVATE_ARGUMENT");
  });

  it("fails closed when formatted alternatives exceed the Agent output budget", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-code-action-output-limit-"),
    );
    temporaryRoots.push(root);
    const target = path.join(root, "usage.ts");
    await writeFile(target, "x".repeat(40));
    const targetUri = pathToFileURL(await realpath(target)).href;
    const sandbox = controlledLspCodeActionsSandbox({
      diagnostics: [diagnostic("missing", 0, 0, 0, 1)],
      codeActions: () => [
        {
          title: "Escaped insertions",
          kind: "quickfix",
          edit: {
            changes: {
              [targetUri]: Array.from({ length: 32 }, (_, index) =>
                textEdit("\\".repeat(1_000), 0, index, 0, index),
              ),
            },
          },
        },
      ],
    });
    const tool = createLspCodeActionsTool({
      workspaceRoot: root,
      sandbox: sandbox.sandbox,
    });

    await expect(
      tool.execute("code-action-output-limit", {
        path: "usage.ts",
        line: 1,
        character: 1,
      }),
    ).rejects.toThrow(
      `LSP code action tool output exceeds ${MAX_LSP_RENAME_TOOL_OUTPUT_BYTES}`,
    );
  });

  it("projects call arguments and live output as hashes only", () => {
    const target = "src/private-usage.ts";
    const args = {
      path: target,
      line: 4,
      character: 7,
      timeoutMs: 2_000,
    };
    const call = lspCodeActionsToolCallArgumentsLedgerProjection(args);
    const output = lspCodeActionsToolOutputLedgerProjection("PRIVATE_OUTPUT", {
      details: { resultSha256: "a".repeat(64) },
    });
    const durable = JSON.stringify({ call, output });

    expect(call).toEqual(
      expect.objectContaining({
        kind: "napier.redacted-tool-arguments",
        redacted: true,
        pathSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        positionSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        inputSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(output).toEqual(
      expect.objectContaining({
        outputRedacted: true,
        outputSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        outputBytes: 14,
        resultSha256: "a".repeat(64),
      }),
    );
    expect(durable).not.toContain(target);
    expect(durable).not.toContain("PRIVATE_OUTPUT");
  });
});
