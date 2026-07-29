import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createWorkspaceFileApplyTool,
  createWorkspaceFilePreviewTool,
  applyWorkspacePatch,
  LocalStore,
  WorkspaceFileMutationManager,
  workspaceFileToolCallArgumentsLedgerProjection,
  workspaceFileToolOutputLedgerProjection,
} from "../src/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Workspace File Mutation Manager", () => {
  it("initializes a missing configured workspace root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-file-init-"));
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const dataRoot = path.join(root, "data");
    const store = new LocalStore({ workspaceRoot, dataRoot });
    await store.initialize();
    const manager = new WorkspaceFileMutationManager({
      store,
      workspaceRoot,
      dataRoot,
    });

    await manager.initialize();

    expect((await lstat(workspaceRoot)).isDirectory()).toBe(true);
    store.close();
  });

  it("creates directories, moves bytes, trashes, survives restart, and restores", async () => {
    const harness = await createHarness();
    const createPreview = await harness.manager.preview(
      harness.thread.id,
      harness.run.id,
      {
        operation: "create_directory",
        path: "artifacts/reports",
        createParentDirectories: true,
      },
    );
    expect(createPreview).toEqual(
      expect.objectContaining({
        operation: "create_directory",
        destinationPath: "artifacts/reports",
        createdDirectoryCount: 2,
        reversible: false,
      }),
    );
    const created = await harness.manager.apply(
      harness.thread.id,
      harness.run.id,
      createPreview.id,
    );
    expect(created.evidence).toEqual(
      expect.objectContaining({
        operation: "create_directory",
        entryKind: "directory",
        createdDirectoryCount: 2,
        postcondition: "verified",
      }),
    );
    expect(
      (
        await lstat(path.join(harness.workspaceRoot, "artifacts/reports"))
      ).isDirectory(),
    ).toBe(true);

    const source = path.join(harness.workspaceRoot, "draft.txt");
    await writeFile(source, "draft\n");
    const movePreview = await harness.manager.preview(
      harness.thread.id,
      harness.run.id,
      {
        operation: "move",
        sourcePath: "draft.txt",
        destinationPath: "artifacts/reports/final.txt",
      },
    );
    const moved = await harness.manager.apply(
      harness.thread.id,
      harness.run.id,
      movePreview.id,
    );
    expect(moved.evidence).toEqual(
      expect.objectContaining({
        operation: "move",
        entryKind: "file",
        fileCount: 1,
        bytes: 6,
        postcondition: "verified",
      }),
    );
    await expect(readFile(source)).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      await readFile(
        path.join(harness.workspaceRoot, "artifacts/reports/final.txt"),
        "utf8",
      ),
    ).toBe("draft\n");

    const trashPreview = await harness.manager.preview(
      harness.thread.id,
      harness.run.id,
      {
        operation: "trash",
        path: "artifacts/reports",
      },
    );
    const trashed = await harness.manager.apply(
      harness.thread.id,
      harness.run.id,
      trashPreview.id,
    );
    expect(trashed.evidence).toEqual(
      expect.objectContaining({
        operation: "trash",
        reversible: true,
        postcondition: "verified",
        trashId: trashPreview.trashId,
      }),
    );
    await expect(
      lstat(path.join(harness.workspaceRoot, "artifacts/reports")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect((await harness.manager.listTrash(harness.thread.id)).items).toEqual([
      expect.objectContaining({
        id: trashPreview.trashId,
        originalPath: "artifacts/reports",
        entryKind: "directory",
      }),
    ]);
    const events = await harness.store.listEvents(harness.thread.id);
    expect(JSON.stringify(events)).not.toContain("artifacts/reports");
    expect(
      events
        .filter((event) => event.type === "workspace.file.mutated")
        .map((event) => event.payload["operation"]),
    ).toEqual(["create_directory", "move", "trash"]);
    harness.store.close();

    const restartedStore = new LocalStore({
      workspaceRoot: harness.workspaceRoot,
      dataRoot: harness.dataRoot,
    });
    await restartedStore.initialize();
    const restarted = new WorkspaceFileMutationManager({
      store: restartedStore,
      workspaceRoot: harness.workspaceRoot,
      dataRoot: harness.dataRoot,
    });
    await restarted.initialize();
    expect((await restarted.listTrash(harness.thread.id)).items).toHaveLength(
      1,
    );
    const restored = await restarted.restoreTrash(
      harness.thread.id,
      trashPreview.trashId!,
    );
    expect(restored).toEqual(
      expect.objectContaining({
        restoredPath: "artifacts/reports",
        evidence: expect.objectContaining({
          operation: "restore",
          initiatedBy: "operator",
          postcondition: "verified",
        }),
      }),
    );
    expect(
      await readFile(
        path.join(harness.workspaceRoot, "artifacts/reports/final.txt"),
        "utf8",
      ),
    ).toBe("draft\n");
    expect((await restarted.listTrash(harness.thread.id)).items).toEqual([]);
    restartedStore.close();
  });

  it("rejects stale, occupied, expired, foreign, and concurrent previews without overwrite", async () => {
    let now = new Date("2026-07-30T00:00:00.000Z");
    const harness = await createHarness({ now: () => now });
    await writeFile(path.join(harness.workspaceRoot, "source.txt"), "one\n");
    const stale = await harness.manager.preview(
      harness.thread.id,
      harness.run.id,
      {
        operation: "move",
        sourcePath: "source.txt",
        destinationPath: "stale.txt",
      },
    );
    await writeFile(path.join(harness.workspaceRoot, "source.txt"), "two\n");
    await expect(
      harness.manager.apply(harness.thread.id, harness.run.id, stale.id),
    ).rejects.toThrow("stale");
    expect(
      await readFile(path.join(harness.workspaceRoot, "source.txt"), "utf8"),
    ).toBe("two\n");

    const occupied = await harness.manager.preview(
      harness.thread.id,
      harness.run.id,
      {
        operation: "move",
        sourcePath: "source.txt",
        destinationPath: "occupied.txt",
      },
    );
    await writeFile(path.join(harness.workspaceRoot, "occupied.txt"), "keep\n");
    await expect(
      harness.manager.apply(harness.thread.id, harness.run.id, occupied.id),
    ).rejects.toThrow("already exists");
    expect(
      await readFile(path.join(harness.workspaceRoot, "occupied.txt"), "utf8"),
    ).toBe("keep\n");

    await mkdir(path.join(harness.workspaceRoot, "destination-parent"));
    const replacedParent = await harness.manager.preview(
      harness.thread.id,
      harness.run.id,
      {
        operation: "move",
        sourcePath: "source.txt",
        destinationPath: "destination-parent/final.txt",
      },
    );
    await rename(
      path.join(harness.workspaceRoot, "destination-parent"),
      path.join(harness.workspaceRoot, "original-destination-parent"),
    );
    await mkdir(path.join(harness.workspaceRoot, "destination-parent"));
    await expect(
      harness.manager.apply(
        harness.thread.id,
        harness.run.id,
        replacedParent.id,
      ),
    ).rejects.toThrow("stale");

    const expiring = await harness.manager.preview(
      harness.thread.id,
      harness.run.id,
      {
        operation: "move",
        sourcePath: "source.txt",
        destinationPath: "expired.txt",
      },
    );
    now = new Date("2026-07-30T00:06:00.000Z");
    await expect(
      harness.manager.apply(harness.thread.id, harness.run.id, expiring.id),
    ).rejects.toThrow(/expired|not found/u);

    now = new Date("2026-07-30T00:07:00.000Z");
    const concurrent = await harness.manager.preview(
      harness.thread.id,
      harness.run.id,
      {
        operation: "move",
        sourcePath: "source.txt",
        destinationPath: "final.txt",
      },
    );
    const secondThread = await harness.store.createThread({
      title: "Other",
      agentId: harness.store.listAgents()[0]!.id,
    });
    const secondRun = await harness.store.createRun({
      threadId: secondThread.id,
      agentId: harness.store.listAgents()[0]!.id,
    });
    await expect(
      harness.manager.apply(secondThread.id, secondRun.id, concurrent.id),
    ).rejects.toThrow("not found");
    const attempts = await Promise.allSettled([
      harness.manager.apply(harness.thread.id, harness.run.id, concurrent.id),
      harness.manager.apply(harness.thread.id, harness.run.id, concurrent.id),
    ]);
    expect(
      attempts.filter((attempt) => attempt.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      attempts.filter((attempt) => attempt.status === "rejected"),
    ).toHaveLength(1);
    expect(
      await readFile(path.join(harness.workspaceRoot, "final.txt"), "utf8"),
    ).toBe("two\n");
    harness.store.close();
  });

  it("preserves a preview when cancellation happens before apply", async () => {
    const harness = await createHarness();
    await writeFile(path.join(harness.workspaceRoot, "source.txt"), "value\n");
    const preview = await harness.manager.preview(
      harness.thread.id,
      harness.run.id,
      {
        operation: "move",
        sourcePath: "source.txt",
        destinationPath: "destination.txt",
      },
    );
    const controller = new AbortController();
    controller.abort();
    await expect(
      harness.manager.apply(
        harness.thread.id,
        harness.run.id,
        preview.id,
        "agent",
        controller.signal,
      ),
    ).rejects.toThrow("aborted");
    await expect(
      harness.manager.apply(harness.thread.id, harness.run.id, preview.id),
    ).resolves.toEqual(
      expect.objectContaining({
        evidence: expect.objectContaining({ operation: "move" }),
      }),
    );
    harness.store.close();
  });

  it("rejects symlinks, protected descendants, and incomplete scopes", async () => {
    const harness = await createHarness();
    const outside = path.join(harness.root, "outside.txt");
    await writeFile(outside, "outside\n");
    await symlink(outside, path.join(harness.workspaceRoot, "link.txt"));
    await expect(
      harness.manager.preview(harness.thread.id, harness.run.id, {
        operation: "trash",
        path: "link.txt",
      }),
    ).rejects.toThrow("symlink");
    await mkdir(path.join(harness.workspaceRoot, "bundle/.git"), {
      recursive: true,
    });
    await expect(
      harness.manager.preview(harness.thread.id, harness.run.id, {
        operation: "trash",
        path: "bundle",
      }),
    ).rejects.toThrow("protected");
    await expect(
      harness.manager.preview(harness.thread.id, harness.run.id, {
        operation: "create_directory",
        path: "../escape",
      }),
    ).rejects.toThrow("escapes");
    await expect(
      harness.manager.preview(harness.thread.id, harness.run.id, {
        operation: "create_directory",
        path: ".napier/escape",
      }),
    ).rejects.toThrow("protected");
    await mkdir(path.join(harness.workspaceRoot, ".git"));
    await writeFile(path.join(harness.workspaceRoot, ".git/config"), "local\n");
    await expect(
      harness.manager.preview(harness.thread.id, harness.run.id, {
        operation: "trash",
        path: ".GIT/config",
      }),
    ).rejects.toThrow("protected");
    harness.store.close();
  });

  it("fails cross-device movement without copying or deleting source bytes", async () => {
    const exdev = Object.assign(new Error("cross device"), { code: "EXDEV" });
    const harness = await createHarness({
      renameEntry: vi.fn(async () => {
        throw exdev;
      }),
    });
    await writeFile(path.join(harness.workspaceRoot, "source.txt"), "value\n");
    const preview = await harness.manager.preview(
      harness.thread.id,
      harness.run.id,
      {
        operation: "trash",
        path: "source.txt",
      },
    );
    await expect(
      harness.manager.apply(harness.thread.id, harness.run.id, preview.id),
    ).rejects.toThrow("one filesystem");
    expect(
      await readFile(path.join(harness.workspaceRoot, "source.txt"), "utf8"),
    ).toBe("value\n");
    expect((await harness.manager.listTrash(harness.thread.id)).items).toEqual(
      [],
    );
    expect(
      await readdir(path.join(harness.dataRoot, "workspace-trash")),
    ).toEqual([]);
    harness.store.close();
  });

  it("shares target locks with apply_patch", async () => {
    let releaseRename: (() => void) | undefined;
    let markRenameEntered: (() => void) | undefined;
    const renameEntered = new Promise<void>((resolve) => {
      markRenameEntered = resolve;
    });
    const renameGate = new Promise<void>((resolve) => {
      releaseRename = resolve;
    });
    const harness = await createHarness({
      renameEntry: async (source, destination) => {
        markRenameEntered!();
        await renameGate;
        await rename(source, destination);
      },
    });
    const source = "value\n";
    await writeFile(path.join(harness.workspaceRoot, "source.txt"), source);
    const preview = await harness.manager.preview(
      harness.thread.id,
      harness.run.id,
      {
        operation: "move",
        sourcePath: "source.txt",
        destinationPath: "destination.txt",
      },
    );
    const moving = harness.manager.apply(
      harness.thread.id,
      harness.run.id,
      preview.id,
    );
    await renameEntered;
    await expect(
      applyWorkspacePatch(harness.workspaceRoot, harness.dataRoot, {
        operation: "replace",
        path: "source.txt",
        expectedSha256: createHash("sha256").update(source).digest("hex"),
        edits: [{ oldText: "value", newText: "changed" }],
      }),
    ).rejects.toThrow("already being edited");
    releaseRename!();
    await moving;
    expect(
      await readFile(
        path.join(harness.workspaceRoot, "destination.txt"),
        "utf8",
      ),
    ).toBe(source);
    harness.store.close();
  });

  it("records an indeterminate result when post-rename observation is lost", async () => {
    const harness = await createHarness({
      renameEntry: async (source, destination) => {
        await rename(source, destination);
        await unlink(destination);
      },
    });
    await writeFile(path.join(harness.workspaceRoot, "source.txt"), "value\n");
    const preview = await harness.manager.preview(
      harness.thread.id,
      harness.run.id,
      {
        operation: "move",
        sourcePath: "source.txt",
        destinationPath: "destination.txt",
      },
    );
    const result = await harness.manager.apply(
      harness.thread.id,
      harness.run.id,
      preview.id,
    );
    expect(result.evidence).toEqual(
      expect.objectContaining({
        operation: "move",
        postcondition: "indeterminate",
      }),
    );
    expect(result.evidence.afterSha256).toBeUndefined();
    harness.store.close();
  });

  it("blocks restore after trash bytes drift", async () => {
    const harness = await createHarness();
    await writeFile(path.join(harness.workspaceRoot, "source.txt"), "value\n");
    const preview = await harness.manager.preview(
      harness.thread.id,
      harness.run.id,
      { operation: "trash", path: "source.txt" },
    );
    await harness.manager.apply(harness.thread.id, harness.run.id, preview.id);
    await writeFile(
      path.join(
        harness.dataRoot,
        "workspace-trash",
        preview.trashId!,
        "payload",
      ),
      "tampered\n",
    );
    await expect(
      harness.manager.restoreTrash(harness.thread.id, preview.trashId!),
    ).rejects.toThrow("drifted");
    expect(
      (await harness.manager.listTrash(harness.thread.id)).items,
    ).toHaveLength(1);
    harness.store.close();
  });
});

describe("Workspace File Agent tools", () => {
  it("previews and applies with path-redacted Ledger projections", async () => {
    const harness = await createHarness();
    await writeFile(path.join(harness.workspaceRoot, "source.txt"), "value\n");
    const context = {
      threadId: harness.thread.id,
      runId: harness.run.id,
    };
    const previewTool = createWorkspaceFilePreviewTool(
      harness.manager,
      context,
    );
    const applyTool = createWorkspaceFileApplyTool(harness.manager, context);
    const preview = await previewTool.execute("preview", {
      action: "preview",
      operation: "move",
      sourcePath: "source.txt",
      destinationPath: "destination.txt",
    });
    expect(preview.content[0]?.text).toContain("Source: source.txt");
    expect(preview.details).toEqual(
      expect.objectContaining({
        action: "preview",
        operation: "move",
        sourcePathSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    const applied = await applyTool.execute("apply", {
      previewId: preview.details.previewId!,
    });
    expect(applied.content[0]?.text).toContain("Destination: destination.txt");
    expect(applied.details).toEqual(
      expect.objectContaining({
        action: "apply",
        operation: "move",
        postcondition: "verified",
      }),
    );

    const projectedInput = workspaceFileToolCallArgumentsLedgerProjection(
      "workspace_file_preview",
      {
        action: "preview",
        operation: "move",
        sourcePath: "TOP_SECRET_SOURCE",
        destinationPath: "TOP_SECRET_DESTINATION",
      },
    );
    expect(JSON.stringify(projectedInput)).not.toContain("TOP_SECRET");
    const projectedOutput = workspaceFileToolOutputLedgerProjection(
      "TOP_SECRET_OUTPUT",
      applied,
    );
    expect(JSON.stringify(projectedOutput)).not.toContain("TOP_SECRET");
    harness.store.close();
  });
});

async function createHarness(options?: {
  now?: () => Date;
  renameEntry?: typeof import("node:fs/promises").rename;
}) {
  const root = await mkdtemp(path.join(tmpdir(), "napier-file-mutation-"));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  await Promise.all([
    mkdir(workspaceRoot, { recursive: true }),
    mkdir(dataRoot, { recursive: true }),
  ]);
  const store = new LocalStore({ workspaceRoot, dataRoot });
  await store.initialize();
  const thread = store.listThreads()[0]!;
  const run = store.listRuns(thread.id)[0]!;
  const manager = new WorkspaceFileMutationManager({
    store,
    workspaceRoot,
    dataRoot,
    ...(options?.now ? { now: options.now } : {}),
    ...(options?.renameEntry ? { renameEntry: options.renameEntry } : {}),
  });
  await manager.initialize();
  return {
    root,
    workspaceRoot,
    dataRoot,
    store,
    thread,
    run,
    manager,
  };
}
