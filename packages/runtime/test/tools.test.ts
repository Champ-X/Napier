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
    ]);
    const read = readOnly.find((tool) => tool.name === "read_file")!;
    const result = await read.execute("read-notes", {
      path: "notes.txt",
      startLine: 2,
      endLine: 2,
    });
    const digest = createHash("sha256").update(source).digest("hex");
    expect(result.content[0]).toEqual(
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining(`"sha256":"${digest}"`),
      }),
    );
    expect(result.details).toEqual(
      expect.objectContaining({
        path: "notes.txt",
        sha256: digest,
        sizeBytes: Buffer.byteLength(source),
        startLine: 2,
        endLine: 2,
      }),
    );

    expect(
      createWorkspaceTools(workspaceRoot, {
        includeWriteTools: true,
        dataRoot,
      }).map((tool) => tool.name),
    ).toEqual(["list_files", "read_file", "search_files", "apply_patch"]);
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
