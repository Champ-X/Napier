import {
  mkdtemp,
  mkdir,
  open,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, expect, it } from "vitest";
import { digestVerificationWorkspace } from "../src/verification-workspace-digest.js";
import { settleVerificationWorkspace } from "../src/verification-workspace-snapshot.js";
import { createWorkspacePathSnapshot } from "../src/workspace-snapshot.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "napier-workspace-digest-")),
  );
  roots.push(root);
  return root;
}

it("preserves complete snapshot hashes, including directories and link targets", async () => {
  const root = await fixture();
  await mkdir(path.join(root, "empty"));
  await mkdir(path.join(root, "nested"));
  await writeFile(path.join(root, "nested/file.txt"), "canonical content");
  await symlink("nested/file.txt", path.join(root, "link"));
  await mkdir(path.join(root, "node_modules"));
  await writeFile(
    path.join(root, "node_modules/excluded"),
    "not a workspace entry",
  );
  const snapshot = await createWorkspacePathSnapshot(root, root, {
    includeDirectories: true,
  });
  expect(await digestVerificationWorkspace(root)).toEqual({
    sha256: snapshot.sha256,
    fileCount: snapshot.fileCount,
    bytes: snapshot.bytes,
    truncated: false,
  });
  await rm(path.join(root, "link"));
  await symlink("empty", path.join(root, "link"));
  expect(
    (await settleVerificationWorkspace(root, snapshot, "passed")).status,
  ).toBe("failed");
});

it("hashes content past 16 MiB and rejects a later-byte change", async () => {
  const root = await fixture();
  const file = path.join(root, "large.bin");
  await writeFile(file, Buffer.alloc(17 * 1024 * 1024));
  const before = await digestVerificationWorkspace(root);
  expect(before).toMatchObject({
    fileCount: 1,
    bytes: 17 * 1024 * 1024,
    truncated: false,
  });
  const handle = await open(file, "r+");
  try {
    await handle.write(Buffer.from([1]), 0, 1, 17 * 1024 * 1024 - 1);
  } finally {
    await handle.close();
  }
  expect(
    await settleVerificationWorkspace(root, before, "passed"),
  ).toMatchObject({
    status: "failed",
    snapshotStatus: "changed",
    workspaceSnapshotTruncated: false,
  });
});

it("hashes entries past the context file limit and rejects their changes", async () => {
  const root = await fixture();
  for (let batch = 0; batch < 21; batch += 1) {
    await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        writeFile(
          path.join(
            root,
            `file-${String(batch * 100 + index).padStart(4, "0")}`,
          ),
          "one",
        ),
      ),
    );
  }
  const before = await digestVerificationWorkspace(root);
  expect(before).toMatchObject({ fileCount: 2100, truncated: false });
  expect(
    await settleVerificationWorkspace(root, before, "passed"),
  ).toMatchObject({ status: "passed", snapshotStatus: "unchanged" });
  await writeFile(path.join(root, "file-2099"), "two");
  expect(
    await settleVerificationWorkspace(root, before, "passed"),
  ).toMatchObject({ status: "failed", snapshotStatus: "changed" });
});

it("retains fail-closed behavior for incomplete observations and honors cancellation", async () => {
  const root = await fixture();
  await writeFile(path.join(root, "a"), "a");
  await writeFile(path.join(root, "b"), "b");
  const before = await digestVerificationWorkspace(root, { maxEntries: 1 });
  expect(before.truncated).toBe(true);
  expect(
    await settleVerificationWorkspace(root, before, "passed"),
  ).toMatchObject({
    status: "failed",
    snapshotStatus: "indeterminate",
    workspaceSnapshotTruncated: true,
  });
  await expect(
    digestVerificationWorkspace(root, {
      signal: AbortSignal.abort(new Error("cancel digest")),
    }),
  ).rejects.toThrow("cancel digest");
  await expect(
    digestVerificationWorkspace(root, { maxEntries: 0 }),
  ).rejects.toThrow("limits are invalid");
});
