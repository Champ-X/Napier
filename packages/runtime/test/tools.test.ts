import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { applyWorkspacePatch, createWorkspaceTools } from "../src/tools.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function createFixture(): Promise<{
  root: string;
  workspaceRoot: string;
  dataRoot: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-tools-"));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  await Promise.all([
    mkdir(workspaceRoot, { recursive: true }),
    mkdir(dataRoot, { recursive: true }),
  ]);
  return { root, workspaceRoot, dataRoot };
}

describe("workspace tools", () => {
  it("returns a complete-file hash and exposes writes only when requested", async () => {
    const { workspaceRoot, dataRoot } = await createFixture();
    const source = "first line\nsecond line\n";
    await writeFile(path.join(workspaceRoot, "notes.txt"), source, "utf8");

    const readOnly = createWorkspaceTools(workspaceRoot);
    expect(readOnly.map((tool) => tool.name)).toEqual([
      "list_files",
      "read_file",
      "search_files",
      "list_symbols",
      "inspect_data",
      "inspect_code",
      "read_symbol",
    ]);
    const read = readOnly.find((tool) => tool.name === "read_file")!;
    const result = await read.execute("read-notes", {
      path: "notes.txt",
      startLine: 2,
      endLine: 2,
    });
    const digest = createHash("sha256").update(source).digest("hex");
    const secondLineDigest = createHash("sha256")
      .update("second line")
      .digest("hex");
    const lineAnchors = [{ line: 2, sha256: secondLineDigest }];
    expect(result.content[0]).toEqual(
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining(
          `"lineAnchors":[{"line":2,"sha256":"${secondLineDigest}"}]`,
        ),
      }),
    );
    expect(result.details).toEqual(
      expect.objectContaining({
        path: "notes.txt",
        pathSha256: createHash("sha256").update("notes.txt").digest("hex"),
        sha256: digest,
        sizeBytes: Buffer.byteLength(source),
        startLine: 2,
        endLine: 2,
        lineAnchors,
        lineAnchorsTruncated: false,
        lineAnchorSetSha256: createHash("sha256")
          .update(JSON.stringify(lineAnchors))
          .digest("hex"),
      }),
    );

    expect(
      createWorkspaceTools(workspaceRoot, {
        includeWriteTools: true,
        dataRoot,
      }).map((tool) => tool.name),
    ).toEqual([
      "list_files",
      "read_file",
      "search_files",
      "list_symbols",
      "inspect_data",
      "inspect_code",
      "read_symbol",
      "apply_patch",
    ]);
  });

  it("returns hash receipts for listed workspace entries", async () => {
    const { workspaceRoot } = await createFixture();
    await mkdir(path.join(workspaceRoot, "src"));
    await writeFile(path.join(workspaceRoot, "README.md"), "# Fixture\n");
    await writeFile(path.join(workspaceRoot, "src/index.ts"), "export {};\n");
    const list = createWorkspaceTools(workspaceRoot).find(
      (tool) => tool.name === "list_files",
    )!;

    const result = await list.execute("list-root", { path: ".", depth: 1 });

    const entries = ["README.md", "src", "src/index.ts"];
    expect(result.content[0]).toEqual(
      expect.objectContaining({
        type: "text",
        text: entries.join("\n"),
      }),
    );
    expect(result.details).toEqual({
      count: 3,
      truncated: false,
      pathSha256: createHash("sha256").update(".").digest("hex"),
      entrySetSha256: createHash("sha256")
        .update(JSON.stringify(entries))
        .digest("hex"),
    });
  });

  it("returns hash anchors for literal search matches", async () => {
    const { workspaceRoot } = await createFixture();
    await mkdir(path.join(workspaceRoot, "src"));
    const firstSource = "alpha\nneedle one\nomega\n";
    const secondSource = "needle two\n";
    await writeFile(path.join(workspaceRoot, "src/first.txt"), firstSource);
    await writeFile(path.join(workspaceRoot, "second.txt"), secondSource);
    const firstFileSha256 = createHash("sha256")
      .update(firstSource)
      .digest("hex");
    const secondFileSha256 = createHash("sha256")
      .update(secondSource)
      .digest("hex");
    const firstLineSha256 = createHash("sha256")
      .update("needle one")
      .digest("hex");
    const secondLineSha256 = createHash("sha256")
      .update("needle two")
      .digest("hex");
    const search = createWorkspaceTools(workspaceRoot).find(
      (tool) => tool.name === "search_files",
    )!;

    const result = await search.execute("search-needle", {
      query: "needle",
    });

    expect(result.content[0]).toEqual(
      expect.objectContaining({
        type: "text",
        text: [
          `second.txt:1 [lineSha256=${secondLineSha256} fileSha256=${secondFileSha256}]: needle two`,
          `src/first.txt:2 [lineSha256=${firstLineSha256} fileSha256=${firstFileSha256}]: needle one`,
        ].join("\n"),
      }),
    );
    const matches = [
      {
        path: "second.txt",
        line: 1,
        fileSha256: secondFileSha256,
        lineSha256: secondLineSha256,
        sizeBytes: Buffer.byteLength(secondSource),
      },
      {
        path: "src/first.txt",
        line: 2,
        fileSha256: firstFileSha256,
        lineSha256: firstLineSha256,
        sizeBytes: Buffer.byteLength(firstSource),
      },
    ];
    expect(result.details).toEqual({
      count: 2,
      truncated: false,
      matchSetSha256: createHash("sha256")
        .update(JSON.stringify(matches))
        .digest("hex"),
      matches,
    });
  });

  it("inspects structured data files with bounded sample receipts", async () => {
    const { workspaceRoot } = await createFixture();
    const csv = "name,score\nAda,98\nLinus,87\n";
    const jsonl = [
      JSON.stringify({ id: 1, status: "open", hidden: "alpha" }),
      JSON.stringify({ id: 2, status: "closed", hidden: "beta" }),
    ].join("\n");
    await writeFile(path.join(workspaceRoot, "scores.csv"), csv);
    await writeFile(path.join(workspaceRoot, "items.jsonl"), jsonl);
    const inspect = createWorkspaceTools(workspaceRoot).find(
      (tool) => tool.name === "inspect_data",
    )!;

    const csvResult = await inspect.execute("inspect-csv", {
      path: "scores.csv",
      maxRows: 1,
    });

    const csvColumns = ["name", "score"];
    const csvSample = [{ name: "Ada", score: "98" }];
    expect(csvResult.content[0]).toEqual(
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining('"columns":["name","score"]'),
      }),
    );
    expect(csvResult.content[0]!.text).toContain('"name": "Ada"');
    expect(csvResult.details).toEqual({
      path: "scores.csv",
      pathSha256: createHash("sha256").update("scores.csv").digest("hex"),
      format: "csv",
      sha256: createHash("sha256").update(csv).digest("hex"),
      sizeBytes: Buffer.byteLength(csv),
      rowCount: 2,
      columnCount: 2,
      truncated: true,
      columnSetSha256: createHash("sha256")
        .update(JSON.stringify(csvColumns))
        .digest("hex"),
      sampleSha256: createHash("sha256")
        .update(JSON.stringify(csvSample))
        .digest("hex"),
    });

    const jsonlResult = await inspect.execute("inspect-jsonl", {
      path: "items.jsonl",
      format: "jsonl",
      maxRows: 2,
    });
    expect(jsonlResult.details).toEqual(
      expect.objectContaining({
        format: "jsonl",
        rowCount: 2,
        columnCount: 3,
        truncated: false,
      }),
    );
    expect(jsonlResult.content[0]!.text).toContain('"status": "open"');
  });

  it("lists code symbols across a bounded workspace directory", async () => {
    const { workspaceRoot } = await createFixture();
    await mkdir(path.join(workspaceRoot, "src"));
    const python = [
      "class Notebook:",
      "    def run(self):",
      "        pass",
    ].join("\n");
    const source = [
      "export class Planner {",
      "  plan(): void {",
      "    return;",
      "  }",
      "}",
    ].join("\n");
    await writeFile(path.join(workspaceRoot, "bad.ts"), Buffer.from([0xff]));
    await writeFile(path.join(workspaceRoot, "notebook.py"), python);
    await writeFile(path.join(workspaceRoot, "notes.txt"), "not code\n");
    await writeFile(path.join(workspaceRoot, "src/planner.ts"), source);
    const listSymbols = createWorkspaceTools(workspaceRoot).find(
      (tool) => tool.name === "list_symbols",
    )!;

    const result = await listSymbols.execute("list-symbols", {
      path: ".",
      maxFiles: 10,
      maxSymbols: 10,
    });

    const pythonSha256 = createHash("sha256").update(python).digest("hex");
    const sourceSha256 = createHash("sha256").update(source).digest("hex");
    const languageCounts = {
      typescript: 1,
      javascript: 0,
      python: 1,
      go: 0,
      unknown: 0,
    };
    const indexedFiles = [
      {
        path: "notebook.py",
        pathSha256: createHash("sha256").update("notebook.py").digest("hex"),
        language: "python",
        sha256: pythonSha256,
        sizeBytes: Buffer.byteLength(python),
        totalLines: 3,
        symbolCount: 2,
      },
      {
        path: "src/planner.ts",
        pathSha256: createHash("sha256").update("src/planner.ts").digest("hex"),
        language: "typescript",
        sha256: sourceSha256,
        sizeBytes: Buffer.byteLength(source),
        totalLines: 5,
        symbolCount: 2,
      },
    ];
    const symbolReceipts = [
      {
        path: "notebook.py",
        language: "python",
        kind: "class",
        name: "Notebook",
        line: 1,
        fileSha256: pythonSha256,
        lineSha256: createHash("sha256")
          .update("class Notebook:")
          .digest("hex"),
        signatureSha256: createHash("sha256")
          .update("class Notebook:")
          .digest("hex"),
      },
      {
        path: "notebook.py",
        language: "python",
        kind: "function",
        name: "run",
        line: 2,
        fileSha256: pythonSha256,
        lineSha256: createHash("sha256")
          .update("    def run(self):")
          .digest("hex"),
        signatureSha256: createHash("sha256")
          .update("def run(self):")
          .digest("hex"),
      },
      {
        path: "src/planner.ts",
        language: "typescript",
        kind: "class",
        name: "Planner",
        line: 1,
        fileSha256: sourceSha256,
        lineSha256: createHash("sha256")
          .update("export class Planner {")
          .digest("hex"),
        signatureSha256: createHash("sha256")
          .update("export class Planner {")
          .digest("hex"),
      },
      {
        path: "src/planner.ts",
        language: "typescript",
        kind: "method",
        name: "plan",
        line: 2,
        fileSha256: sourceSha256,
        lineSha256: createHash("sha256")
          .update("  plan(): void {")
          .digest("hex"),
        signatureSha256: createHash("sha256")
          .update("plan(): void {")
          .digest("hex"),
      },
    ];
    expect(result.content[0]!.text).toContain("Napier symbol index metadata");
    expect(result.content[0]!.text).toContain(
      "notebook.py:2 python function run",
    );
    expect(result.content[0]!.text).toContain(
      "src/planner.ts:2 typescript method plan",
    );
    expect(result.details).toEqual({
      path: ".",
      pathSha256: createHash("sha256").update(".").digest("hex"),
      fileCount: 2,
      skippedFileCount: 1,
      symbolCount: 4,
      totalLines: 8,
      sizeBytes: Buffer.byteLength(python) + Buffer.byteLength(source),
      truncated: false,
      languageCounts,
      languageCountsSha256: createHash("sha256")
        .update(JSON.stringify(languageCounts))
        .digest("hex"),
      fileSetSha256: createHash("sha256")
        .update(JSON.stringify(indexedFiles))
        .digest("hex"),
      symbolSetSha256: createHash("sha256")
        .update(JSON.stringify(symbolReceipts))
        .digest("hex"),
    });
  });

  it("inspects code files with bounded symbol receipts", async () => {
    const { workspaceRoot } = await createFixture();
    await mkdir(path.join(workspaceRoot, "src"));
    const source = [
      "export interface AgentTask {",
      "  id: string;",
      "}",
      "",
      "export class Planner {",
      "  plan(input: string): string {",
      "    helper(input);",
      "    return input;",
      "  }",
      "}",
      "",
      "export const createPlan = () => new Planner();",
    ].join("\n");
    const python = [
      "class Notebook:",
      "    def run(self):",
      "        pass",
    ].join("\n");
    const go = [
      "package main",
      "",
      "type Runner struct{}",
      "func (r Runner) Run() {}",
    ].join("\n");
    await writeFile(path.join(workspaceRoot, "src/planner.ts"), source);
    await writeFile(path.join(workspaceRoot, "notebook.py"), python);
    await writeFile(path.join(workspaceRoot, "runner.go"), go);
    const inspect = createWorkspaceTools(workspaceRoot).find(
      (tool) => tool.name === "inspect_code",
    )!;

    const result = await inspect.execute("inspect-code", {
      path: "src/planner.ts",
      maxSymbols: 10,
    });

    const symbolReceipts = [
      {
        kind: "interface",
        name: "AgentTask",
        line: 1,
        lineSha256: createHash("sha256")
          .update("export interface AgentTask {")
          .digest("hex"),
        signatureSha256: createHash("sha256")
          .update("export interface AgentTask {")
          .digest("hex"),
      },
      {
        kind: "class",
        name: "Planner",
        line: 5,
        lineSha256: createHash("sha256")
          .update("export class Planner {")
          .digest("hex"),
        signatureSha256: createHash("sha256")
          .update("export class Planner {")
          .digest("hex"),
      },
      {
        kind: "method",
        name: "plan",
        line: 6,
        lineSha256: createHash("sha256")
          .update("  plan(input: string): string {")
          .digest("hex"),
        signatureSha256: createHash("sha256")
          .update("plan(input: string): string {")
          .digest("hex"),
      },
      {
        kind: "variable",
        name: "createPlan",
        line: 12,
        lineSha256: createHash("sha256")
          .update("export const createPlan = () => new Planner();")
          .digest("hex"),
        signatureSha256: createHash("sha256")
          .update("export const createPlan = () => new Planner();")
          .digest("hex"),
      },
    ];
    expect(result.content[0]!.text).toContain("Napier code metadata");
    expect(result.content[0]!.text).toContain("src/planner.ts:6 method plan");
    expect(result.details).toEqual({
      path: "src/planner.ts",
      pathSha256: createHash("sha256").update("src/planner.ts").digest("hex"),
      language: "typescript",
      sha256: createHash("sha256").update(source).digest("hex"),
      sizeBytes: Buffer.byteLength(source),
      totalLines: 12,
      symbolCount: 4,
      truncated: false,
      symbolSetSha256: createHash("sha256")
        .update(JSON.stringify(symbolReceipts))
        .digest("hex"),
    });

    const pythonResult = await inspect.execute("inspect-python", {
      path: "notebook.py",
    });
    expect(pythonResult.details).toEqual(
      expect.objectContaining({
        language: "python",
        symbolCount: 2,
      }),
    );
    expect(pythonResult.content[0]!.text).toContain(
      "notebook.py:2 function run",
    );

    const goResult = await inspect.execute("inspect-go", {
      path: "runner.go",
      maxSymbols: 1,
    });
    expect(goResult.details).toEqual(
      expect.objectContaining({
        language: "go",
        symbolCount: 1,
        truncated: true,
      }),
    );
    expect(goResult.content[0]!.text).toContain("runner.go:3 struct Runner");
  });

  it("reads a symbol source range with hash receipts", async () => {
    const { workspaceRoot } = await createFixture();
    await mkdir(path.join(workspaceRoot, "src"));
    const source = [
      "export class Planner {",
      "  plan(input: string): string {",
      "    return input;",
      "  }",
      "}",
      "",
      "export const createPlan = () => new Planner();",
    ].join("\n");
    await writeFile(path.join(workspaceRoot, "src/planner.ts"), source);
    const readSymbol = createWorkspaceTools(workspaceRoot).find(
      (tool) => tool.name === "read_symbol",
    )!;
    const classLineSha256 = createHash("sha256")
      .update("export class Planner {")
      .digest("hex");

    const result = await readSymbol.execute("read-symbol", {
      path: "src/planner.ts",
      line: 1,
      lineSha256: classLineSha256,
      maxLines: 20,
    });

    const selected = [
      "export class Planner {",
      "  plan(input: string): string {",
      "    return input;",
      "  }",
      "}",
    ].join("\n");
    const lineAnchors = selected.split("\n").map((line, index) => ({
      line: index + 1,
      sha256: createHash("sha256").update(line).digest("hex"),
    }));
    expect(result.content[0]!.text).toContain("Napier symbol source metadata");
    expect(result.content[0]!.text).toContain("export class Planner");
    expect(result.content[0]!.text).toContain("plan(input: string)");
    expect(result.details).toEqual({
      path: "src/planner.ts",
      pathSha256: createHash("sha256").update("src/planner.ts").digest("hex"),
      language: "typescript",
      sha256: createHash("sha256").update(source).digest("hex"),
      sizeBytes: Buffer.byteLength(source),
      totalLines: 7,
      startLine: 1,
      endLine: 5,
      symbolLine: 1,
      symbolKind: "class",
      symbolNameSha256: createHash("sha256").update("Planner").digest("hex"),
      lineSha256: classLineSha256,
      signatureSha256: classLineSha256,
      rangeSha256: createHash("sha256").update(selected).digest("hex"),
      observedLineCount: 5,
      truncated: false,
      lineAnchors,
      lineAnchorsTruncated: false,
      lineAnchorSetSha256: createHash("sha256")
        .update(JSON.stringify(lineAnchors))
        .digest("hex"),
    });

    await expect(
      readSymbol.execute("read-symbol-stale", {
        path: "src/planner.ts",
        line: 1,
        lineSha256: "0".repeat(64),
      }),
    ).rejects.toThrow("lineSha256 precondition failed");
  });

  it("creates and exact-replaces UTF-8 files with hash preconditions", async () => {
    const { workspaceRoot, dataRoot } = await createFixture();
    const created = await applyWorkspacePatch(workspaceRoot, dataRoot, {
      operation: "create",
      path: "report.md",
      expectedSha256: null,
      content: "# Report\n\nDraft evidence.\n",
    });
    expect(created).toEqual(
      expect.objectContaining({
        operation: "create",
        path: "report.md",
        pathSha256: createHash("sha256").update("report.md").digest("hex"),
        beforeSha256: null,
        beforeBytes: 0,
        editCount: 0,
      }),
    );
    expect(await readFile(path.join(workspaceRoot, "report.md"), "utf8")).toBe(
      "# Report\n\nDraft evidence.\n",
    );

    const updated = await applyWorkspacePatch(workspaceRoot, dataRoot, {
      operation: "replace",
      path: "report.md",
      expectedSha256: created.afterSha256,
      edits: [
        {
          oldText: "Draft evidence.",
          newText: "Verified evidence.",
        },
      ],
    });
    expect(updated).toEqual(
      expect.objectContaining({
        operation: "replace",
        beforeSha256: created.afterSha256,
        editCount: 1,
      }),
    );
    expect(updated.afterSha256).not.toBe(created.afterSha256);
    expect(await readFile(path.join(workspaceRoot, "report.md"), "utf8")).toBe(
      "# Report\n\nVerified evidence.\n",
    );
  });

  it("creates missing parent directories only when create opts in", async () => {
    const { workspaceRoot, dataRoot } = await createFixture();
    await expect(
      applyWorkspacePatch(workspaceRoot, dataRoot, {
        operation: "create",
        path: "artifacts/reports/summary.md",
        expectedSha256: null,
        content: "# Summary\n",
      }),
    ).rejects.toThrow("parent path does not exist");

    const createdDirectories = ["artifacts", "artifacts/reports"];
    const created = await applyWorkspacePatch(workspaceRoot, dataRoot, {
      operation: "create",
      path: "artifacts/reports/summary.md",
      expectedSha256: null,
      content: "# Summary\n",
      createParentDirectories: true,
    });

    expect(created).toEqual(
      expect.objectContaining({
        operation: "create",
        path: "artifacts/reports/summary.md",
        beforeSha256: null,
        editCount: 0,
        createdParentDirectoryCount: 2,
        createdParentDirectorySetSha256: createHash("sha256")
          .update(JSON.stringify(createdDirectories))
          .digest("hex"),
      }),
    );
    expect(
      await readFile(
        path.join(workspaceRoot, "artifacts/reports/summary.md"),
        "utf8",
      ),
    ).toBe("# Summary\n");
    expect(await readdir(path.join(workspaceRoot, "artifacts"))).toEqual([
      "reports",
    ]);
  });

  it("replaces lines by read_file hash anchors without retyping old text", async () => {
    const { workspaceRoot, dataRoot } = await createFixture();
    const source = "title: Draft\nstatus: pending\nnotes: keep\n";
    await writeFile(path.join(workspaceRoot, "hashline.txt"), source, "utf8");
    const digest = createHash("sha256").update(source).digest("hex");
    const statusLineDigest = createHash("sha256")
      .update("status: pending")
      .digest("hex");

    const updated = await applyWorkspacePatch(workspaceRoot, dataRoot, {
      operation: "hashline_replace",
      path: "hashline.txt",
      expectedSha256: digest,
      edits: [
        {
          line: 2,
          anchorSha256: statusLineDigest,
          newText: "status: verified",
        },
      ],
    });

    expect(updated).toEqual(
      expect.objectContaining({
        operation: "hashline_replace",
        beforeSha256: digest,
        editCount: 1,
      }),
    );
    expect(
      await readFile(path.join(workspaceRoot, "hashline.txt"), "utf8"),
    ).toBe("title: Draft\nstatus: verified\nnotes: keep\n");
  });

  it("replaces source ranges by read_symbol range hashes", async () => {
    const { workspaceRoot, dataRoot } = await createFixture();
    await mkdir(path.join(workspaceRoot, "src"));
    const target = path.join(workspaceRoot, "src/service.ts");
    const source = [
      "export class Service {",
      "  run(): string {",
      '    return "old";',
      "  }",
      "}",
      "",
      "export const untouched = true;",
    ].join("\n");
    await writeFile(target, source, "utf8");
    const digest = createHash("sha256").update(source).digest("hex");
    const range = [
      "export class Service {",
      "  run(): string {",
      '    return "old";',
      "  }",
      "}",
    ].join("\n");
    const replacement = [
      "export class Service {",
      "  run(): string {",
      '    return "new";',
      "  }",
      "",
      "  status(): string {",
      '    return "ok";',
      "  }",
      "}",
    ].join("\n");

    const updated = await applyWorkspacePatch(workspaceRoot, dataRoot, {
      operation: "hashrange_replace",
      path: "src/service.ts",
      expectedSha256: digest,
      edits: [
        {
          startLine: 1,
          endLine: 5,
          rangeSha256: createHash("sha256").update(range).digest("hex"),
          newText: replacement,
        },
      ],
    });

    expect(updated).toEqual(
      expect.objectContaining({
        operation: "hashrange_replace",
        beforeSha256: digest,
        editCount: 1,
      }),
    );
    expect(await readFile(target, "utf8")).toBe(
      `${replacement}\n\nexport const untouched = true;`,
    );
  });

  it("rejects stale or ambiguous edits without changing the target", async () => {
    const { workspaceRoot, dataRoot } = await createFixture();
    const target = path.join(workspaceRoot, "state.txt");
    const source = "same\nsame\n";
    await writeFile(target, source, "utf8");
    const digest = createHash("sha256").update(source).digest("hex");

    await expect(
      applyWorkspacePatch(workspaceRoot, dataRoot, {
        operation: "replace",
        path: "state.txt",
        expectedSha256: "0".repeat(64),
        edits: [{ oldText: "same", newText: "changed" }],
      }),
    ).rejects.toThrow("precondition failed");
    await expect(
      applyWorkspacePatch(workspaceRoot, dataRoot, {
        operation: "replace",
        path: "state.txt",
        expectedSha256: digest,
        edits: [{ oldText: "same", newText: "changed" }],
      }),
    ).rejects.toThrow("ambiguous");

    expect(await readFile(target, "utf8")).toBe(source);
    expect(
      (await readdir(workspaceRoot)).filter((name) =>
        name.includes(".napier-"),
      ),
    ).toEqual([]);
    expect(await readdir(path.join(dataRoot, "file-edit-locks"))).toEqual([]);
  });

  it("rejects stale or ambiguous hashline edits without changing the target", async () => {
    const { workspaceRoot, dataRoot } = await createFixture();
    const target = path.join(workspaceRoot, "hashline-state.txt");
    const source = "same\nunique\nsame\n";
    await writeFile(target, source, "utf8");
    const digest = createHash("sha256").update(source).digest("hex");
    const sameDigest = createHash("sha256").update("same").digest("hex");
    const uniqueDigest = createHash("sha256").update("unique").digest("hex");

    await expect(
      applyWorkspacePatch(workspaceRoot, dataRoot, {
        operation: "hashline_replace",
        path: "hashline-state.txt",
        expectedSha256: digest,
        edits: [
          {
            line: 2,
            anchorSha256: sameDigest,
            newText: "changed",
          },
        ],
      }),
    ).rejects.toThrow("did not match line 2");
    await expect(
      applyWorkspacePatch(workspaceRoot, dataRoot, {
        operation: "hashline_replace",
        path: "hashline-state.txt",
        expectedSha256: digest,
        edits: [{ anchorSha256: sameDigest, newText: "changed" }],
      }),
    ).rejects.toThrow("ambiguous");
    await expect(
      applyWorkspacePatch(workspaceRoot, dataRoot, {
        operation: "hashline_replace",
        path: "hashline-state.txt",
        expectedSha256: digest,
        edits: [{ anchorSha256: uniqueDigest, newText: "changed" }],
      }),
    ).resolves.toEqual(
      expect.objectContaining({ operation: "hashline_replace" }),
    );

    expect(await readFile(target, "utf8")).toBe("same\nchanged\nsame\n");
  });

  it("rejects stale or overlapping hashrange edits without changing the target", async () => {
    const { workspaceRoot, dataRoot } = await createFixture();
    const target = path.join(workspaceRoot, "range-state.ts");
    const source = ["one", "two", "three", "four"].join("\n");
    await writeFile(target, source, "utf8");
    const digest = createHash("sha256").update(source).digest("hex");
    const firstRangeSha256 = createHash("sha256")
      .update(["one", "two"].join("\n"))
      .digest("hex");
    const secondRangeSha256 = createHash("sha256")
      .update(["two", "three"].join("\n"))
      .digest("hex");

    await expect(
      applyWorkspacePatch(workspaceRoot, dataRoot, {
        operation: "hashrange_replace",
        path: "range-state.ts",
        expectedSha256: digest,
        edits: [
          {
            startLine: 1,
            endLine: 2,
            rangeSha256: "0".repeat(64),
            newText: "changed",
          },
        ],
      }),
    ).rejects.toThrow("rangeSha256 precondition failed");
    await expect(
      applyWorkspacePatch(workspaceRoot, dataRoot, {
        operation: "hashrange_replace",
        path: "range-state.ts",
        expectedSha256: digest,
        edits: [
          {
            startLine: 1,
            endLine: 2,
            rangeSha256: firstRangeSha256,
            newText: "changed",
          },
          {
            startLine: 2,
            endLine: 3,
            rangeSha256: secondRangeSha256,
            newText: "also changed",
          },
        ],
      }),
    ).rejects.toThrow("overlaps");

    expect(await readFile(target, "utf8")).toBe(source);
  });

  it("serializes concurrent writers so only one matching hash can commit", async () => {
    const { workspaceRoot, dataRoot } = await createFixture();
    const target = path.join(workspaceRoot, "counter.txt");
    const source = "value=0\n";
    await writeFile(target, source, "utf8");
    const digest = createHash("sha256").update(source).digest("hex");

    const results = await Promise.allSettled([
      applyWorkspacePatch(workspaceRoot, dataRoot, {
        operation: "replace",
        path: "counter.txt",
        expectedSha256: digest,
        edits: [{ oldText: "value=0", newText: "value=1" }],
      }),
      applyWorkspacePatch(workspaceRoot, dataRoot, {
        operation: "replace",
        path: "counter.txt",
        expectedSha256: digest,
        edits: [{ oldText: "value=0", newText: "value=2" }],
      }),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(["value=1\n", "value=2\n"]).toContain(
      await readFile(target, "utf8"),
    );
  });

  it("recovers an edit lock only after its owner process is gone", async () => {
    const { workspaceRoot, dataRoot } = await createFixture();
    const target = path.join(workspaceRoot, "recover.txt");
    const source = "before\n";
    await writeFile(target, source, "utf8");
    const digest = createHash("sha256").update(source).digest("hex");
    const locksRoot = path.join(dataRoot, "file-edit-locks");
    await mkdir(locksRoot);
    const canonicalTarget = await realpath(target);
    const lockIdentity =
      process.platform === "darwin" || process.platform === "win32"
        ? canonicalTarget.toLowerCase()
        : canonicalTarget;
    await writeFile(
      path.join(
        locksRoot,
        `${createHash("sha256").update(lockIdentity).digest("hex")}.lock`,
      ),
      `${JSON.stringify({
        pid: 2_147_483_647,
        acquiredAt: "2026-07-25T00:00:00.000Z",
      })}\n`,
      "utf8",
    );

    await expect(
      applyWorkspacePatch(workspaceRoot, dataRoot, {
        operation: "replace",
        path: "recover.txt",
        expectedSha256: digest,
        edits: [{ oldText: "before", newText: "after" }],
      }),
    ).resolves.toEqual(expect.objectContaining({ operation: "replace" }));
    expect(await readFile(target, "utf8")).toBe("after\n");
    expect(await readdir(locksRoot)).toEqual([]);
  });

  it("rejects oversized output and invalid UTF-8 without partial files", async () => {
    const { workspaceRoot, dataRoot } = await createFixture();
    await expect(
      applyWorkspacePatch(workspaceRoot, dataRoot, {
        operation: "create",
        path: "oversized.txt",
        expectedSha256: null,
        content: "x".repeat(256 * 1024 + 1),
      }),
    ).rejects.toThrow("output exceeds");
    await expect(
      readFile(path.join(workspaceRoot, "oversized.txt")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    await writeFile(
      path.join(workspaceRoot, "invalid.txt"),
      Buffer.from([0xff, 0xfe]),
    );
    const read = createWorkspaceTools(workspaceRoot).find(
      (tool) => tool.name === "read_file",
    )!;
    await expect(
      read.execute("read-invalid", { path: "invalid.txt" }),
    ).rejects.toThrow("valid UTF-8");
  });

  it("rejects protected paths and symlinks that resolve outside the workspace", async () => {
    const { root, workspaceRoot, dataRoot } = await createFixture();
    const outside = path.join(root, "outside");
    await mkdir(outside);
    await writeFile(path.join(outside, "secret.txt"), "outside\n", "utf8");
    await symlink(
      path.join(outside, "secret.txt"),
      path.join(workspaceRoot, "secret-link.txt"),
    );
    await symlink(outside, path.join(workspaceRoot, "outside-link"));

    const read = createWorkspaceTools(workspaceRoot).find(
      (tool) => tool.name === "read_file",
    )!;
    await expect(
      read.execute("read-link", { path: "secret-link.txt" }),
    ).rejects.toThrow("resolves outside");
    await expect(
      applyWorkspacePatch(workspaceRoot, dataRoot, {
        operation: "create",
        path: "outside-link/new.txt",
        expectedSha256: null,
        content: "blocked\n",
      }),
    ).rejects.toThrow("symlink");
    await expect(
      applyWorkspacePatch(workspaceRoot, dataRoot, {
        operation: "create",
        path: ".git/config",
        expectedSha256: null,
        content: "blocked\n",
      }),
    ).rejects.toThrow("protected path segment");
  });
});
