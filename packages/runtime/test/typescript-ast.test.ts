import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyWorkspacePatch,
  MAX_TYPESCRIPT_AST_FILE_BYTES,
  TypescriptAstRunner,
} from "../src/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("TypeScript AST query and edit preview", () => {
  it("queries exact nested syntax and applies a structured preview through CAS", async () => {
    const fixture = await createFixture();
    const source = [
      'import { format } from "./format.js";',
      "",
      "export interface Price {",
      "  amount: number;",
      "}",
      "",
      "export class Calculator {",
      "  private factor = 2;",
      "",
      "  constructor(readonly currency: string) {}",
      "",
      "  calculate(input: number): number {",
      "    return input * this.factor;",
      "  }",
      "}",
      "",
      "export function createCalculator(): Calculator {",
      "  return new Calculator(format());",
      "}",
      "",
      "export const identity = (value: number) => value;",
    ].join("\n");
    await writeFile(path.join(fixture.workspaceRoot, "calculator.ts"), source);
    const runner = new TypescriptAstRunner(fixture.workspaceRoot);

    const query = await runner.query({
      path: "calculator.ts",
      selector: {
        kind: "method",
        name: "calculate",
        ancestorKind: "class",
        ancestorName: "Calculator",
      },
    });

    expect(query.details).toEqual(
      expect.objectContaining({
        action: "query",
        status: "found",
        complete: true,
        language: "typescript",
        parseDiagnosticCount: 0,
        matchedNodeCount: 1,
        returnedNodeCount: 1,
        omittedNodeCount: 0,
        typescriptVersion: "5.9.3",
      }),
    );
    expect(query.nodes).toEqual([
      expect.objectContaining({
        kind: "method",
        name: "calculate",
        startLine: 12,
        endLine: 14,
        parentKind: "class",
        parentName: "Calculator",
        nodeSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    ]);
    const before = await readFile(
      path.join(fixture.workspaceRoot, "calculator.ts"),
      "utf8",
    );
    const preview = await runner.previewEdit({
      path: "calculator.ts",
      expectedSha256: query.details.fileSha256,
      selector: {
        kind: "method",
        name: "calculate",
        ancestorKind: "class",
        ancestorName: "Calculator",
      },
      nodeSha256: query.nodes[0]!.nodeSha256,
      operation: "replace",
      replacement: [
        "calculate(input: number): number {",
        "    return input * this.factor * 3;",
        "  }",
      ].join("\n"),
    });

    expect(
      await readFile(path.join(fixture.workspaceRoot, "calculator.ts"), "utf8"),
    ).toBe(before);
    expect(preview.details).toEqual(
      expect.objectContaining({
        action: "edit_preview",
        operation: "replace",
        targetKind: "method",
        fileSha256: query.details.fileSha256,
        targetNodeSha256: query.nodes[0]!.nodeSha256,
        applicationContextExpanded: false,
        afterFileSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(preview.applicationOldText).toContain("return input * this.factor;");
    expect(preview.applicationNewText).toContain(
      "return input * this.factor * 3;",
    );

    const patch = await applyWorkspacePatch(
      fixture.workspaceRoot,
      fixture.dataRoot,
      {
        operation: "replace",
        path: preview.path,
        expectedSha256: preview.details.fileSha256,
        edits: [
          {
            oldText: preview.applicationOldText,
            newText: preview.applicationNewText,
          },
        ],
      },
    );
    expect(patch.afterSha256).toBe(preview.details.afterFileSha256);
    expect(
      await readFile(path.join(fixture.workspaceRoot, "calculator.ts"), "utf8"),
    ).toContain("return input * this.factor * 3;");
  });

  it("expands duplicate node text into one unique exact patch", async () => {
    const fixture = await createFixture();
    const source = [
      "class First {",
      "  run() {",
      "    return 1;",
      "  }",
      "}",
      "",
      "class Second {",
      "  run() {",
      "    return 1;",
      "  }",
      "}",
    ].join("\n");
    await writeFile(path.join(fixture.workspaceRoot, "duplicate.ts"), source);
    const runner = new TypescriptAstRunner(fixture.workspaceRoot);
    const query = await runner.query({
      path: "duplicate.ts",
      selector: {
        kind: "method",
        name: "run",
        ancestorKind: "class",
        ancestorName: "Second",
      },
    });
    const preview = await runner.previewEdit({
      path: "duplicate.ts",
      expectedSha256: query.details.fileSha256,
      selector: {
        kind: "method",
        name: "run",
        ancestorKind: "class",
        ancestorName: "Second",
      },
      nodeSha256: query.nodes[0]!.nodeSha256,
      operation: "replace",
      replacement: "run() {\n    return 2;\n  }",
    });

    expect(preview.details.applicationContextExpanded).toBe(true);
    expect(source.indexOf(preview.applicationOldText)).toBe(
      source.lastIndexOf(preview.applicationOldText),
    );
    expect(preview.applicationOldText).toContain("class Second");
    expect(preview.applicationNewText).toContain("return 2");
  });

  it("previews insert and remove operations while rejecting syntax regressions", async () => {
    const fixture = await createFixture();
    const source = [
      "class Worker {",
      "  run(): number {",
      "    return 1;",
      "  }",
      "}",
    ].join("\n");
    await writeFile(path.join(fixture.workspaceRoot, "worker.ts"), source);
    const runner = new TypescriptAstRunner(fixture.workspaceRoot);
    const query = await runner.query({
      path: "worker.ts",
      selector: { kind: "method", name: "run" },
    });
    const nodeSha256 = query.nodes[0]!.nodeSha256;
    const inserted = await runner.previewEdit({
      path: "worker.ts",
      expectedSha256: query.details.fileSha256,
      selector: { kind: "method", name: "run" },
      nodeSha256,
      operation: "insert_before",
      replacement: "stop(): void {}",
    });
    const removed = await runner.previewEdit({
      path: "worker.ts",
      expectedSha256: query.details.fileSha256,
      selector: { kind: "method", name: "run" },
      nodeSha256,
      operation: "remove",
    });

    expect(inserted.applicationNewText).toContain("stop(): void {}");
    expect(inserted.applicationNewText).toContain("run(): number");
    expect(removed.applicationNewText).toBe("");
    await expect(
      runner.previewEdit({
        path: "worker.ts",
        expectedSha256: query.details.fileSha256,
        selector: { kind: "method", name: "run" },
        nodeSha256,
        operation: "replace",
        replacement: "run(: {",
      }),
    ).rejects.toThrow("syntax diagnostics");

    const commentedSource = [
      "class CommentedWorker {",
      "  /** Existing method contract. */",
      "  run(): number {",
      "    return 1;",
      "  } // Existing result note.",
      "}",
    ].join("\n");
    await writeFile(
      path.join(fixture.workspaceRoot, "commented.ts"),
      commentedSource,
    );
    const commentedQuery = await runner.query({
      path: "commented.ts",
      selector: { kind: "method", name: "run" },
    });
    const commentedNodeSha256 = commentedQuery.nodes[0]!.nodeSha256;
    await expect(
      runner.previewEdit({
        path: "commented.ts",
        expectedSha256: commentedQuery.details.fileSha256,
        selector: { kind: "method", name: "run" },
        nodeSha256: commentedNodeSha256,
        operation: "insert_before",
        replacement: "start(): void {}",
      }),
    ).rejects.toThrow("refuses attached comments");
    await expect(
      runner.previewEdit({
        path: "commented.ts",
        expectedSha256: commentedQuery.details.fileSha256,
        selector: { kind: "method", name: "run" },
        nodeSha256: commentedNodeSha256,
        operation: "insert_after",
        replacement: "stop(): void {}",
      }),
    ).rejects.toThrow("refuses attached comments");
    await expect(
      runner.previewEdit({
        path: "commented.ts",
        expectedSha256: commentedQuery.details.fileSha256,
        selector: { kind: "method", name: "run" },
        nodeSha256: commentedNodeSha256,
        operation: "remove",
      }),
    ).rejects.toThrow("refuses attached comments");
  });

  it("fails closed on stale evidence, unsafe paths, malformed source, and cancellation", async () => {
    const fixture = await createFixture();
    await writeFile(
      path.join(fixture.workspaceRoot, "valid.ts"),
      "export const value = 1;\n",
    );
    await writeFile(
      path.join(fixture.workspaceRoot, "broken.ts"),
      "export function broken( {\n",
    );
    await mkdir(path.join(fixture.workspaceRoot, ".git"));
    await writeFile(
      path.join(fixture.workspaceRoot, ".git/config.ts"),
      "export const secret = 1;\n",
    );
    await writeFile(
      path.join(fixture.workspaceRoot, "large.ts"),
      Buffer.alloc(MAX_TYPESCRIPT_AST_FILE_BYTES + 1, 0x20),
    );
    await writeFile(
      path.join(fixture.workspaceRoot, "invalid.ts"),
      Buffer.from([0xc3, 0x28]),
    );
    await symlink(
      path.join(fixture.workspaceRoot, "valid.ts"),
      path.join(fixture.workspaceRoot, "linked.ts"),
    );
    const runner = new TypescriptAstRunner(fixture.workspaceRoot);
    const query = await runner.query({
      path: "valid.ts",
      selector: { kind: "variable", name: "value" },
    });

    await expect(
      runner.previewEdit({
        path: "valid.ts",
        expectedSha256: "0".repeat(64),
        selector: { kind: "variable", name: "value" },
        nodeSha256: query.nodes[0]!.nodeSha256,
        operation: "remove",
      }),
    ).rejects.toThrow("expectedSha256");
    await expect(
      runner.previewEdit({
        path: "valid.ts",
        expectedSha256: query.details.fileSha256,
        selector: { kind: "variable", name: "value" },
        nodeSha256: "0".repeat(64),
        operation: "remove",
      }),
    ).rejects.toThrow("does not match");
    await expect(
      runner.query({
        path: "../outside.ts",
        selector: { kind: "variable" },
      }),
    ).rejects.toThrow("escapes");
    await expect(
      runner.query({
        path: "private-missing.ts",
        selector: { kind: "variable" },
      }),
    ).rejects.toThrow("ast_query target is unavailable");
    await expect(
      runner.query({
        path: ".git/config.ts",
        selector: { kind: "variable" },
      }),
    ).rejects.toThrow("protected");
    await expect(
      runner.query({
        path: "linked.ts",
        selector: { kind: "variable" },
      }),
    ).rejects.toThrow("symlink");
    await expect(
      runner.query({
        path: "large.ts",
        selector: { kind: "variable" },
      }),
    ).rejects.toThrow("files up to");
    await expect(
      runner.query({
        path: "invalid.ts",
        selector: { kind: "variable" },
      }),
    ).rejects.toThrow("valid UTF-8");
    await expect(
      runner.query({
        path: "broken.ts",
        selector: { kind: "function" },
      }),
    ).rejects.toThrow("syntax diagnostics");
    const controller = new AbortController();
    controller.abort();
    await expect(
      runner.query({
        path: "valid.ts",
        selector: { kind: "variable" },
        signal: controller.signal,
      }),
    ).rejects.toThrow();
  });

  it("isolates concurrent TypeScript and JavaScript queries", async () => {
    const fixture = await createFixture();
    await Promise.all([
      writeFile(
        path.join(fixture.workspaceRoot, "first.ts"),
        "export function first() { return 1; }\n",
      ),
      writeFile(
        path.join(fixture.workspaceRoot, "second.js"),
        "export function second() { return 2; }\n",
      ),
    ]);
    const runner = new TypescriptAstRunner(fixture.workspaceRoot);
    const [first, second] = await Promise.all([
      runner.query({
        path: "first.ts",
        selector: { kind: "function", name: "first" },
      }),
      runner.query({
        path: "second.js",
        selector: { kind: "function", name: "second" },
      }),
    ]);

    expect(first.nodes[0]).toEqual(expect.objectContaining({ name: "first" }));
    expect(first.details.language).toBe("typescript");
    expect(second.nodes[0]).toEqual(
      expect.objectContaining({ name: "second" }),
    );
    expect(second.details.language).toBe("javascript");
    expect(first.details.nodeSetSha256).not.toBe(second.details.nodeSetSha256);
  });
});

async function createFixture(): Promise<{
  root: string;
  workspaceRoot: string;
  dataRoot: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-typescript-ast-"));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  await Promise.all([
    mkdir(workspaceRoot, { recursive: true }),
    mkdir(dataRoot, { recursive: true }),
  ]);
  return { root, workspaceRoot, dataRoot };
}
