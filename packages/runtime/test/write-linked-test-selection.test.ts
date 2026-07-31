import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  captureWriteLinkedTestBeforeState,
  MAX_WRITE_LINKED_SYMBOLS_PER_FILE,
  MAX_WRITE_LINKED_TESTS,
  selectWriteLinkedTests,
} from "../src/write-linked-test-selection.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("write-linked test selection", () => {
  it("selects reverse-dependent tests and binds changed declarations", async () => {
    const workspaceRoot = await createWorkspace();
    const mathPath = path.join(workspaceRoot, "src/math.ts");
    const beforeSource =
      "export function sum(left: number, right: number) { return left + right; }\n";
    const afterSource =
      "export function sum(left: number, right: number) { return left - right; }\n";
    await writeFile(mathPath, beforeSource);
    await writeFile(
      path.join(workspaceRoot, "src/service.ts"),
      [
        'import { sum } from "./math.js";',
        "export const total = sum(2, 3);",
        "",
      ].join("\n"),
    );
    await writeFile(
      path.join(workspaceRoot, "test/service.test.ts"),
      [
        'import { expect, test } from "vitest";',
        'import { total } from "../src/service.js";',
        'test("total", () => expect(total).toBe(5));',
        "",
      ].join("\n"),
    );
    await writeFile(
      path.join(workspaceRoot, "test/unrelated.test.ts"),
      [
        'import { expect, test } from "vitest";',
        'test("unrelated", () => expect(true).toBe(true));',
        "",
      ].join("\n"),
    );
    const before = await captureWriteLinkedTestBeforeState(workspaceRoot, [
      { path: "src/math.ts", expectedSha256: sha256(beforeSource) },
    ]);
    await writeFile(mathPath, afterSource);

    const selection = await selectWriteLinkedTests({
      workspaceRoot,
      changedFiles: [
        { path: "src/math.ts", expectedSha256: sha256(afterSource) },
      ],
      before,
    });

    expect(selection).toEqual(
      expect.objectContaining({
        complete: true,
        selectedTests: ["test/service.test.ts"],
        scannedFileCount: 4,
        candidateTestCount: 2,
        omittedTestCount: 0,
        unresolvedImportCount: 0,
        graphTruncated: false,
      }),
    );
    expect(selection.changedSymbols).toEqual(["src/math.ts#sum"]);
    expect(selection.changedSymbolSetSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(selection.dependencyGraphSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(selection.selectionSnapshotSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("distinguishes no match from incomplete relative dependency evidence", async () => {
    const workspaceRoot = await createWorkspace();
    const isolated = "export const isolated = 1;\n";
    await writeFile(path.join(workspaceRoot, "src/isolated.ts"), isolated);
    await writeFile(
      path.join(workspaceRoot, "test/unrelated.test.ts"),
      'import { test } from "vitest"; test("ok", () => {});\n',
    );

    const noMatch = await selectWriteLinkedTests({
      workspaceRoot,
      changedFiles: [
        { path: "src/isolated.ts", expectedSha256: sha256(isolated) },
      ],
    });
    expect(noMatch).toEqual(
      expect.objectContaining({
        complete: true,
        selectedTests: [],
        graphTruncated: false,
      }),
    );

    const incompleteSource =
      'import { missing } from "./missing.js"; export const value = missing;\n';
    await writeFile(
      path.join(workspaceRoot, "src/isolated.ts"),
      incompleteSource,
    );
    const incomplete = await selectWriteLinkedTests({
      workspaceRoot,
      changedFiles: [
        {
          path: "src/isolated.ts",
          expectedSha256: sha256(incompleteSource),
        },
      ],
    });
    expect(incomplete).toEqual(
      expect.objectContaining({
        complete: false,
        graphTruncated: true,
        unresolvedImportCount: 1,
      }),
    );
  });

  it("does not execute helper modules as Vitest test targets", async () => {
    const workspaceRoot = await createWorkspace();
    const source = "export const value = 1;\n";
    await writeFile(path.join(workspaceRoot, "src/value.ts"), source);
    await writeFile(
      path.join(workspaceRoot, "test/value-helper.ts"),
      'export { value } from "../src/value.js";\n',
    );
    await writeFile(
      path.join(workspaceRoot, "test/value.test.ts"),
      'import { value } from "./value-helper.js"; export const observed = value;\n',
    );

    const selection = await selectWriteLinkedTests({
      workspaceRoot,
      changedFiles: [{ path: "src/value.ts", expectedSha256: sha256(source) }],
    });

    expect(selection).toEqual(
      expect.objectContaining({
        complete: true,
        candidateTestCount: 1,
        selectedTests: ["test/value.test.ts"],
      }),
    );
  });

  it("marks declaration association truncated at its per-file bound", async () => {
    const workspaceRoot = await createWorkspace();
    const lines = Array.from(
      { length: MAX_WRITE_LINKED_SYMBOLS_PER_FILE + 1 },
      (_, index) => `export const value${String(index)} = 0;`,
    );
    const beforeSource = `${lines.join("\n")}\n`;
    const sourcePath = path.join(workspaceRoot, "src/value.ts");
    await writeFile(sourcePath, beforeSource);
    const before = await captureWriteLinkedTestBeforeState(workspaceRoot, [
      { path: "src/value.ts", expectedSha256: sha256(beforeSource) },
    ]);
    const captured = new Set(
      before.files[0]!.symbols.map((symbol) => symbol.identity),
    );
    const omitted = lines
      .map((_, index) => `value${String(index)}`)
      .find((identity) => !captured.has(identity));
    expect(omitted).toBeDefined();
    const afterSource = beforeSource.replace(
      `export const ${omitted} = 0;`,
      `export const ${omitted} = 1;`,
    );
    await writeFile(sourcePath, afterSource);

    const selection = await selectWriteLinkedTests({
      workspaceRoot,
      changedFiles: [
        { path: "src/value.ts", expectedSha256: sha256(afterSource) },
      ],
      before,
    });

    expect(selection.changedSymbols).toEqual([]);
    expect(selection.changedSymbolsTruncated).toBe(true);
  });

  it("caps a broad reverse dependency set without claiming completeness", async () => {
    const workspaceRoot = await createWorkspace();
    const shared = "export const shared = 1;\n";
    await writeFile(path.join(workspaceRoot, "src/shared.ts"), shared);
    for (let index = 0; index < MAX_WRITE_LINKED_TESTS + 2; index += 1) {
      await writeFile(
        path.join(workspaceRoot, `test/shared-${String(index)}.test.ts`),
        [
          'import { shared } from "../src/shared.js";',
          `export const observed${String(index)} = shared;`,
          "",
        ].join("\n"),
      );
    }

    const selection = await selectWriteLinkedTests({
      workspaceRoot,
      changedFiles: [{ path: "src/shared.ts", expectedSha256: sha256(shared) }],
    });

    expect(selection.selectedTests).toHaveLength(MAX_WRITE_LINKED_TESTS);
    expect(selection).toEqual(
      expect.objectContaining({
        complete: false,
        graphTruncated: true,
        omittedTestCount: 2,
      }),
    );
  });

  it("scopes a monorepo change to its nearest package boundary", async () => {
    const workspaceRoot = await createWorkspace();
    const packageRoot = path.join(workspaceRoot, "packages/feature");
    await Promise.all([
      mkdir(path.join(packageRoot, "src"), { recursive: true }),
      mkdir(path.join(packageRoot, "test"), { recursive: true }),
    ]);
    const source = "export const scopedValue = 1;\n";
    await Promise.all([
      writeFile(path.join(packageRoot, "package.json"), '{"name":"feature"}\n'),
      writeFile(path.join(packageRoot, "src/value.ts"), source),
      writeFile(
        path.join(packageRoot, "test/value.test.ts"),
        'import "../src/value.js";\n',
      ),
      writeFile(
        path.join(workspaceRoot, "src/unrelated.ts"),
        'import "./missing.js";\n',
      ),
    ]);

    const selection = await selectWriteLinkedTests({
      workspaceRoot,
      changedFiles: [
        {
          path: "packages/feature/src/value.ts",
          expectedSha256: sha256(source),
        },
      ],
    });

    expect(selection).toEqual(
      expect.objectContaining({
        complete: true,
        scanRootPaths: ["packages/feature"],
        scannedFileCount: 2,
        selectedTests: ["packages/feature/test/value.test.ts"],
        unresolvedImportCount: 0,
      }),
    );
  });

  it("rejects changed source drift", async () => {
    const workspaceRoot = await createWorkspace();
    const source = "export const value = 1;\n";
    await writeFile(path.join(workspaceRoot, "src/value.ts"), source);

    await expect(
      selectWriteLinkedTests({
        workspaceRoot,
        changedFiles: [
          {
            path: "src/value.ts",
            expectedSha256: sha256("different"),
          },
        ],
      }),
    ).rejects.toThrow("changed source bytes");
    expect(
      await readFile(path.join(workspaceRoot, "src/value.ts"), "utf8"),
    ).toBe(source);
  });
});

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-linked-tests-"));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await Promise.all([
    mkdir(path.join(workspaceRoot, "src"), { recursive: true }),
    mkdir(path.join(workspaceRoot, "test"), { recursive: true }),
  ]);
  return workspaceRoot;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
