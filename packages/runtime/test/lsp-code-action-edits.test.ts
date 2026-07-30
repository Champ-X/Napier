import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { sha256 } from "../src/ed25519.js";
import { materializeLspCodeActions } from "../src/lsp-code-action-edits.js";
import { range } from "./lsp-rename-test-fixture.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("LSP Code Action edit materialization", () => {
  it("rejects an edit materialized against a newer source snapshot", async () => {
    const root = await createWorkspace();
    const sourcePath = "source.ts";
    const source = path.join(root, sourcePath);
    const original = "export const value = missing;\n";
    await writeFile(source, "export const changed = true;\n");

    await expect(
      materializeLspCodeActions(
        {
          workspaceRoot: root,
          sourcePath,
          sourcePathSha256: sha256(sourcePath),
          sourceFileSha256: sha256(original),
        },
        [action(pathToFileURL(await realpath(source)).href, 1)],
      ),
    ).rejects.toThrow("source changed before materialization");
  });

  it("accepts source version one but rejects versioned unopened targets", async () => {
    const root = await createWorkspace();
    const sourcePath = "source.ts";
    const source = path.join(root, sourcePath);
    const sourceText = await readFile(source, "utf8");
    const options = {
      workspaceRoot: root,
      sourcePath,
      sourcePathSha256: sha256(sourcePath),
      sourceFileSha256: sha256(sourceText),
    };
    await expect(
      materializeLspCodeActions(options, [
        action(pathToFileURL(await realpath(source)).href, 1),
      ]),
    ).resolves.toEqual(
      expect.objectContaining({
        actions: [expect.objectContaining({ title: "Apply fix" })],
      }),
    );
    await expect(
      materializeLspCodeActions(options, [
        action(pathToFileURL(await realpath(source)).href, 2),
      ]),
    ).rejects.toThrow("incompatible document version");

    const other = path.join(root, "other.ts");
    await writeFile(other, "export const other = true;\n");
    await expect(
      materializeLspCodeActions(options, [
        action(pathToFileURL(await realpath(other)).href, 1),
      ]),
    ).rejects.toThrow("incompatible document version");
  });

  it("honors cancellation before filesystem materialization", async () => {
    const root = await createWorkspace();
    const sourcePath = "source.ts";
    const controller = new AbortController();
    controller.abort();

    await expect(
      materializeLspCodeActions(
        {
          workspaceRoot: root,
          sourcePath,
          sourcePathSha256: sha256(sourcePath),
          sourceFileSha256: "a".repeat(64),
          signal: controller.signal,
        },
        [],
      ),
    ).rejects.toThrow("was aborted");
  });
});

async function createWorkspace(): Promise<string> {
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "napier-code-action-edits-"),
  );
  temporaryRoots.push(temporaryRoot);
  const root = await realpath(temporaryRoot);
  await writeFile(
    path.join(root, "source.ts"),
    "export const value = missing;\n",
  );
  return root;
}

function action(uri: string, documentVersion: number) {
  return {
    title: "Apply fix",
    kind: "quickfix",
    isPreferred: true,
    commandIgnored: false,
    edits: [
      {
        uri,
        range: range(0, 0, 0, 0),
        newText: "import {};\n",
        documentVersion,
      },
    ],
  };
}
