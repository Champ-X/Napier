import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { sha256 } from "../src/ed25519.js";
import { createSubagentWorktreeFileTool } from "../src/subagent-worktree-file-tool.js";
import type { SubagentWorktreeSession } from "../src/subagent-worktree-files.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("coder candidate file tool", () => {
  it("deletes and moves only explicitly authorized private files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-candidate-file-"));
    temporaryRoots.push(root);
    await mkdir(path.join(root, "src"));
    const deleted = "export const deleted = true;\n";
    const moved = "export const moved = true;\n";
    await Promise.all([
      writeFile(path.join(root, "src/delete.ts"), deleted),
      writeFile(path.join(root, "src/source.ts"), moved),
    ]);
    const session = {
      root,
      writePaths: ["src/delete.ts", "src/destination.ts", "src/source.ts"],
    } as SubagentWorktreeSession;
    const tool = createSubagentWorktreeFileTool(session, async (operation) =>
      operation(),
    );

    const deletedResult = await tool.execute("delete", {
      operation: "delete",
      path: "src/delete.ts",
      expectedSha256: sha256(deleted),
    });
    expect(deletedResult.details).toEqual(
      expect.objectContaining({
        operation: "delete",
        beforeSha256: sha256(deleted),
        afterSha256: null,
      }),
    );
    await expect(
      readFile(path.join(root, "src/delete.ts")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const movedResult = await tool.execute("move", {
      operation: "move",
      sourcePath: "src/source.ts",
      destinationPath: "src/destination.ts",
      expectedSourceSha256: sha256(moved),
      expectedDestinationSha256: null,
    });
    expect(movedResult.details).toEqual(
      expect.objectContaining({
        operation: "move",
        beforeSha256: sha256(moved),
        afterSha256: sha256(moved),
      }),
    );
    await expect(
      readFile(path.join(root, "src/destination.ts"), "utf8"),
    ).resolves.toBe(moved);
    await expect(
      readFile(path.join(root, "src/source.ts")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects undeclared, stale, occupied, and non-canonical targets", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-candidate-file-"));
    temporaryRoots.push(root);
    await mkdir(path.join(root, "src"));
    const source = "export const source = true;\n";
    await Promise.all([
      writeFile(path.join(root, "src/source.ts"), source),
      writeFile(path.join(root, "src/occupied.ts"), "occupied\n"),
    ]);
    const session = {
      root,
      writePaths: [
        "src/destination.ts",
        "src/occupied.ts",
        "src/raced.ts",
        "src/source.ts",
      ],
    } as SubagentWorktreeSession;
    const tool = createSubagentWorktreeFileTool(session, async (operation) =>
      operation(),
    );

    await expect(
      tool.execute("undeclared", {
        operation: "delete",
        path: "src/undeclared.ts",
        expectedSha256: sha256(source),
      }),
    ).rejects.toThrow("declared write paths");
    await expect(
      tool.execute("stale", {
        operation: "delete",
        path: "src/source.ts",
        expectedSha256: "0".repeat(64),
      }),
    ).rejects.toThrow("precondition failed");
    await expect(
      tool.execute("occupied", {
        operation: "move",
        sourcePath: "src/source.ts",
        destinationPath: "src/occupied.ts",
        expectedSourceSha256: sha256(source),
        expectedDestinationSha256: null,
      }),
    ).rejects.toThrow("already exists");
    await expect(
      readFile(path.join(root, "src/source.ts"), "utf8"),
    ).resolves.toBe(source);

    const racingTool = createSubagentWorktreeFileTool(
      session,
      async (operation) => operation(),
      {
        async linkFile(sourcePath, destinationPath) {
          await writeFile(destinationPath, "external winner\n");
          await link(sourcePath, destinationPath);
        },
      },
    );
    await expect(
      racingTool.execute("raced", {
        operation: "move",
        sourcePath: "src/source.ts",
        destinationPath: "src/raced.ts",
        expectedSourceSha256: sha256(source),
        expectedDestinationSha256: null,
      }),
    ).rejects.toMatchObject({ code: "EEXIST" });
    await expect(
      readFile(path.join(root, "src/raced.ts"), "utf8"),
    ).resolves.toBe("external winner\n");
    await expect(
      readFile(path.join(root, "src/source.ts"), "utf8"),
    ).resolves.toBe(source);
  });
});
