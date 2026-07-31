import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { canonicalJson, sha256 } from "../src/ed25519.js";
import { commitLspRename } from "../src/lsp-rename-commit.js";
import type { LspRenameFile } from "../src/lsp-rename-workspace-edit.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("coordinated LSP rename commit", () => {
  it("stages and applies every file under one verified plan", async () => {
    const fixture = await createFixture();

    const result = await commitLspRename({
      ...fixture,
      sourcePreviewResultSha256: "a".repeat(64),
      files: fixture.files,
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: "applied",
        postcondition: "verified",
        fileCount: 2,
        editCount: 2,
        committedFileCount: 2,
        restoredFileCount: 0,
        rollbackAttempted: false,
        durable: true,
      }),
    );
    await expectWorkspace(fixture, fixture.after);
    await expectNoTemporaryFiles(fixture.workspaceRoot);
  });

  it("rejects stale input and cancellation before changing a target", async () => {
    const stale = await createFixture();
    await writeFile(
      path.join(stale.workspaceRoot, stale.paths[0]!),
      "export const externallyChanged = 1;\n",
    );
    await expect(
      commitLspRename({
        ...stale,
        sourcePreviewResultSha256: "b".repeat(64),
        files: stale.files,
      }),
    ).rejects.toThrow("preview is stale");
    expect(
      await readFile(path.join(stale.workspaceRoot, stale.paths[1]!), "utf8"),
    ).toBe(stale.before[1]);

    const cancelled = await createFixture();
    const controller = new AbortController();
    let links = 0;
    await expect(
      commitLspRename({
        ...cancelled,
        sourcePreviewResultSha256: "c".repeat(64),
        files: cancelled.files,
        signal: controller.signal,
        async linkFile(source, destination) {
          const { link } = await import("node:fs/promises");
          await link(source, destination);
          links += 1;
          if (links === cancelled.files.length) controller.abort();
        },
      }),
    ).rejects.toThrow("aborted before commit");
    await expectWorkspace(cancelled, cancelled.before);
    await expectNoTemporaryFiles(cancelled.workspaceRoot);
  });

  it("rejects a forged preview binding before acquiring write state", async () => {
    const fixture = await createFixture();
    const forged = structuredClone(fixture.files);
    forged[0]!.edits[0]!.newTextSha256 = "0".repeat(64);

    await expect(
      commitLspRename({
        ...fixture,
        sourcePreviewResultSha256: "1".repeat(64),
        files: forged,
      }),
    ).rejects.toThrow("edit binding");
    await expectWorkspace(fixture, fixture.before);
    await expectNoTemporaryFiles(fixture.workspaceRoot);
  });

  it("restores earlier files when a later coordinated commit fails", async () => {
    const fixture = await createFixture();
    let commits = 0;
    const result = await commitLspRename({
      ...fixture,
      sourcePreviewResultSha256: "d".repeat(64),
      files: fixture.files,
      async renameFile(source, destination) {
        if (source.endsWith(".tmp")) {
          commits += 1;
          if (commits === 2) {
            throw new Error("PRIVATE_SECOND_COMMIT_FAILURE");
          }
        }
        await rename(source, destination);
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: "rolled_back",
        postcondition: "verified",
        committedFileCount: 1,
        restoredFileCount: 1,
        rollbackAttempted: true,
        rollbackVerified: true,
        errorSha256: sha256("PRIVATE_SECOND_COMMIT_FAILURE"),
      }),
    );
    await expectWorkspace(fixture, fixture.before);
    await expectNoTemporaryFiles(fixture.workspaceRoot);
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });

  it("reports indeterminate when verified rollback cannot be completed", async () => {
    const fixture = await createFixture();
    let commits = 0;
    const result = await commitLspRename({
      ...fixture,
      sourcePreviewResultSha256: "e".repeat(64),
      files: fixture.files,
      async renameFile(source, destination) {
        if (source.endsWith(".tmp")) {
          commits += 1;
          if (commits === 2) {
            throw new Error("PRIVATE_COMMIT_FAILURE");
          }
        }
        if (source.endsWith(".bak")) {
          throw new Error("PRIVATE_ROLLBACK_FAILURE");
        }
        await rename(source, destination);
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: "indeterminate",
        postcondition: "indeterminate",
        committedFileCount: 1,
        restoredFileCount: 0,
        recoveryArtifactCount: 1,
        rollbackAttempted: true,
        rollbackVerified: false,
        errorSha256: sha256("PRIVATE_ROLLBACK_FAILURE"),
      }),
    );
    expect(
      await readFile(
        path.join(fixture.workspaceRoot, fixture.paths[0]!),
        "utf8",
      ),
    ).toBe(fixture.after[0]);
    expect(
      await readFile(
        path.join(fixture.workspaceRoot, fixture.paths[1]!),
        "utf8",
      ),
    ).toBe(fixture.before[1]);
    await expectRecoveryArtifacts(fixture.workspaceRoot, 1);
  });

  it("allows only one concurrent writer for the complete target set", async () => {
    const fixture = await createFixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const firstCommit = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let blocked = true;
    const first = commitLspRename({
      ...fixture,
      sourcePreviewResultSha256: "f".repeat(64),
      files: fixture.files,
      async renameFile(source, destination) {
        if (blocked && source.endsWith(".tmp")) {
          blocked = false;
          entered();
          await gate;
        }
        await rename(source, destination);
      },
    });
    await firstCommit;

    await expect(
      commitLspRename({
        ...fixture,
        sourcePreviewResultSha256: "f".repeat(64),
        files: fixture.files,
      }),
    ).rejects.toThrow("already being edited");
    release();
    await expect(first).resolves.toEqual(
      expect.objectContaining({ status: "applied" }),
    );
  });

  it("settles a commit already in progress after cancellation is observed", async () => {
    const fixture = await createFixture();
    const controller = new AbortController();
    let commits = 0;

    const result = await commitLspRename({
      ...fixture,
      sourcePreviewResultSha256: "0".repeat(64),
      files: fixture.files,
      signal: controller.signal,
      async renameFile(source, destination) {
        await rename(source, destination);
        if (source.endsWith(".tmp") && ++commits === 1) controller.abort();
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: "applied",
        postcondition: "verified",
        committedFileCount: 2,
        cancellationObserved: true,
      }),
    );
    await expectWorkspace(fixture, fixture.after);
  });
});

async function createFixture(): Promise<{
  workspaceRoot: string;
  dataRoot: string;
  paths: string[];
  before: string[];
  after: string[];
  files: LspRenameFile[];
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-rename-commit-"));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  await mkdir(path.join(workspaceRoot, "src"), { recursive: true });
  const paths = ["src/consumer.ts", "src/definition.ts"];
  const before = [
    "export const second = currentName;\n",
    "export const currentName = 1;\n",
  ];
  const after = before.map((source) =>
    source.replace("currentName", "canonicalName"),
  );
  await Promise.all(
    paths.map((target, index) =>
      writeFile(path.join(workspaceRoot, target), before[index]!),
    ),
  );
  return {
    workspaceRoot,
    dataRoot,
    paths,
    before,
    after,
    files: paths.map((target, index) =>
      renameFile(target, before[index]!, "currentName", "canonicalName"),
    ),
  };
}

function renameFile(
  target: string,
  source: string,
  oldText: string,
  newText: string,
): LspRenameFile {
  const start = source.indexOf(oldText);
  if (start < 0) throw new Error("Test rename source is invalid");
  const edit = {
    path: target,
    pathSha256: sha256(target),
    fileSha256: sha256(source),
    startLine: 1,
    startCharacter: start + 1,
    endLine: 1,
    endCharacter: start + oldText.length + 1,
    rangeSha256: sha256(
      canonicalJson({
        startLine: 1,
        startCharacter: start + 1,
        endLine: 1,
        endCharacter: start + oldText.length + 1,
      }),
    ),
    oldText,
    oldTextSha256: sha256(oldText),
    newText,
    newTextSha256: sha256(newText),
  };
  return {
    path: target,
    pathSha256: edit.pathSha256,
    fileSha256: edit.fileSha256,
    edits: [edit],
  };
}

async function expectWorkspace(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  expected: string[],
): Promise<void> {
  expect(
    await Promise.all(
      fixture.paths.map((target) =>
        readFile(path.join(fixture.workspaceRoot, target), "utf8"),
      ),
    ),
  ).toEqual(expected);
}

async function expectNoTemporaryFiles(workspaceRoot: string): Promise<void> {
  const entries = await readdir(path.join(workspaceRoot, "src"));
  expect(entries.some((entry) => entry.includes(".napier-rename-"))).toBe(
    false,
  );
}

async function expectRecoveryArtifacts(
  workspaceRoot: string,
  expected: number,
): Promise<void> {
  const entries = await readdir(path.join(workspaceRoot, "src"));
  expect(entries.filter((entry) => entry.endsWith(".bak"))).toHaveLength(
    expected,
  );
  expect(entries.some((entry) => entry.endsWith(".tmp"))).toBe(false);
}
