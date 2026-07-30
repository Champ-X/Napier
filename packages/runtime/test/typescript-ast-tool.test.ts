import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createTypescriptAstTools,
  typescriptAstToolCallArgumentsLedgerProjection,
  typescriptAstToolOutputLedgerProjection,
} from "../src/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("TypeScript AST Agent tools", () => {
  it("returns actionable live previews and hash-only durable projections", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-ast-tool-"));
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const source = [
      "export class PrivateCalculator {",
      "  privateFactor = 2;",
      "",
      "  calculatePrivate(input: number): number {",
      "    return input * this.privateFactor;",
      "  }",
      "}",
    ].join("\n");
    await writeFile(path.join(workspaceRoot, "private.ts"), source);
    const tools = createTypescriptAstTools(workspaceRoot);
    const queryTool = tools.find((tool) => tool.name === "ast_query")!;
    const editTool = tools.find((tool) => tool.name === "ast_edit_preview")!;
    const selector = {
      kind: "method" as const,
      name: "calculatePrivate",
      ancestorKind: "class" as const,
      ancestorName: "PrivateCalculator",
    };
    const queried = await queryTool.execute("ast-query", {
      path: "private.ts",
      selector,
      maxResults: 10,
    });
    const nodeSha256 = queried.content[0]!.text.match(
      /nodeSha256=([a-f0-9]{64})/u,
    )?.[1];
    expect(nodeSha256).toBeDefined();
    expect(queried.content[0]!.text).toContain("calculatePrivate");
    expect(queried.content[0]!.text).toContain("PrivateCalculator");
    expect(JSON.stringify(queried.details)).not.toContain("Private");

    const replacement = [
      "calculatePrivate(input: number): number {",
      "    return input * this.privateFactor * 3;",
      "  }",
    ].join("\n");
    const previewed = await editTool.execute("ast-edit", {
      path: "private.ts",
      expectedSha256: queried.details.fileSha256,
      selector,
      nodeSha256: nodeSha256!,
      operation: "replace",
      replacement,
    });

    expect(previewed.content[0]!.text).toContain(
      "return input * this.privateFactor;",
    );
    expect(previewed.content[0]!.text).toContain(
      "return input * this.privateFactor * 3;",
    );
    expect(previewed.details).toEqual(
      expect.objectContaining({
        action: "edit_preview",
        operation: "replace",
        targetKind: "method",
        targetNodeSha256: nodeSha256,
        replacementSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        resultSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    const callProjection = typescriptAstToolCallArgumentsLedgerProjection(
      "ast_edit_preview",
      {
        path: "private.ts",
        expectedSha256: queried.details.fileSha256,
        selector,
        nodeSha256,
        operation: "replace",
        replacement,
      },
    );
    const outputProjection = typescriptAstToolOutputLedgerProjection(
      previewed.content[0]!.text,
      previewed,
    );
    const durable = JSON.stringify({ callProjection, outputProjection });
    expect(callProjection).toEqual(
      expect.objectContaining({
        action: "edit_preview",
        selectorKind: "method",
        selectorNameSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        replacementBytes: Buffer.byteLength(replacement),
        replacementSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        inputSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(outputProjection).toEqual(
      expect.objectContaining({
        outputRedacted: true,
        outputSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        resultSha256: previewed.details.resultSha256,
      }),
    );
    expect(durable).not.toContain("private.ts");
    expect(durable).not.toContain("PrivateCalculator");
    expect(durable).not.toContain("calculatePrivate");
    expect(durable).not.toContain("privateFactor");
  });
});
