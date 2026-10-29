import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
  symlink,
  chmod,
  truncate,
  stat,
  utimes,
  appendFile,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ExecutionPlan, ThreadDetail } from "@napier/contracts";
import {
  projectTaskDeliverables,
  taskArtifactFacts,
} from "@napier/contracts/task-narrative";
import { afterEach, expect, it, vi } from "vitest";
import { sha256 } from "/Users/champ/orca/Napier/packages/runtime/src/ed25519.ts";
import { inspectTaskDeliverables } from "/tmp/napier-g01-budget-before-inspector.ts";

const hooks = vi.hoisted(() => ({
  afterRead: undefined as (() => Promise<void>) | undefined,
  beforeRead: undefined as (() => Promise<void>) | undefined,
  bytesRead: 0,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      return {
        stat: () => handle.stat(),
        close: () => handle.close(),
        read: async (
          buffer: Buffer,
          offset: number,
          length: number,
          position: number,
        ) => {
          const before = hooks.beforeRead;
          hooks.beforeRead = undefined;
          await before?.();
          const result = await handle.read(buffer, offset, length, position);
          hooks.bytesRead += result.bytesRead;
          const hook = hooks.afterRead;
          hooks.afterRead = undefined;
          await hook?.();
          return result;
        },
      };
    },
  };
});

const roots: string[] = [];
afterEach(async () => {
  hooks.afterRead = undefined;
  hooks.beforeRead = undefined;
  hooks.bytesRead = 0;
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function root() {
  const value = await mkdtemp(
    path.join(tmpdir(), "napier-declared-inspection-"),
  );
  roots.push(value);
  return value;
}
function plan(paths: string[], bytes = "") {
  return {
    id: "plan_test",
    threadId: "thread_test",
    status: "active",
    revision: 2,
    artifacts: paths.map((file, i) => ({
      id: `file_${i}`,
      path: file,
      kind: "file",
      description: "report",
      status: "verified",
      sha256: sha256(bytes),
      sizeBytes: Buffer.byteLength(bytes),
      evidence: "asserted",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-02",
    })),
  } as ExecutionPlan;
}
function narrative(
  p: ExecutionPlan,
): NonNullable<ThreadDetail["taskNarrative"]> {
  return {
    phase: "ended",
    phaseLabel: "Ended",
    currentAction: "Inspect",
    completedItems: [],
    deliverables: projectTaskDeliverables([p]),
  };
}

it("distinguishes leaf/parent symlinks, non-files and unsupported artifacts from missing bytes", async () => {
  const dir = await root();
  await mkdir(path.join(dir, "real"));
  await writeFile(path.join(dir, "real/file.txt"), "");
  await symlink(path.join(dir, "real/file.txt"), path.join(dir, "link.txt"));
  await symlink(path.join(dir, "real"), path.join(dir, "linked"));
  const p = plan(["link.txt", "linked/file.txt", "real", "missing.txt"]);
  const result = await inspectTaskDeliverables(narrative(p), dir);
  const observed = Object.fromEntries(
    result.deliverables!.map((entry) => [entry.path, entry.observation]),
  );
  expect(observed["link.txt"]).toMatchObject({
    status: "unchecked",
    reason: "symlink",
  });
  expect(observed["linked/file.txt"]).toMatchObject({
    status: "unchecked",
    reason: "symlink",
  });
  expect(observed["real"]).toMatchObject({
    status: "unchecked",
    reason: "not_regular_file",
  });
  expect(observed["missing.txt"]).toMatchObject({ status: "missing" });
  p.artifacts[0]!.kind = "directory";
  expect(
    (await inspectTaskDeliverables(narrative(p), dir)).deliverables!.find(
      (entry) => entry.path === "link.txt",
    )!.observation,
  ).toMatchObject({ status: "unchecked", reason: "unsupported_kind" });
});

it.skipIf(process.platform === "win32")(
  "does not open or wait for a declared FIFO",
  async () => {
    const dir = await root(),
      fifo = path.join(dir, "pipe");
    await promisify(execFile)("mkfifo", [fifo]);
    const result = await inspectTaskDeliverables(
      narrative(plan(["pipe"])),
      dir,
    );
    expect(result.deliverables![0]!.observation).toMatchObject({
      status: "unchecked",
      reason: "not_regular_file",
    });
  },
  2_000,
);

it("limits filesystem inspections even for zero-byte files and keeps uninspected versions", async () => {
  const dir = await root(),
    paths = Array.from({ length: 65 }, (_, i) => `file-${i}.txt`);
  await Promise.all(paths.map((name) => writeFile(path.join(dir, name), "")));
  const p = plan(paths),
    result = await inspectTaskDeliverables(narrative(p), dir);
  expect(result.deliverables).toHaveLength(65);
  expect(
    result.deliverables!.filter(
      (entry) => entry.observation?.status === "matched",
    ),
  ).toHaveLength(64);
  expect(
    result.deliverables!.filter(
      (entry) => entry.observation?.reason === "budget_exceeded",
    ),
  ).toHaveLength(1);
  expect(taskArtifactFacts([p], result.deliverables).status).not.toBe("passed");
});

it("bounds both a single file and total bytes without treating a skipped file as missing", async () => {
  const dir = await root(),
    content = "x".repeat(8 * 1024 * 1024);
  const p = plan(["a", "b", "c", "d", "e"], content);
  await Promise.all(
    p.artifacts.map((entry) => writeFile(path.join(dir, entry.path), content)),
  );
  const result = await inspectTaskDeliverables(narrative(p), dir);
  expect(hooks.bytesRead).toBe(32 * 1024 * 1024);
  expect(
    result.deliverables!.filter(
      (entry) => entry.observation?.status === "matched",
    ),
  ).toHaveLength(4);
  expect(
    result.deliverables!.filter(
      (entry) => entry.observation?.reason === "budget_exceeded",
    ),
  ).toHaveLength(1);
  await truncate(path.join(dir, "a"), 8 * 1024 * 1024 + 1);
  const oversized = await inspectTaskDeliverables(narrative(plan(["a"])), dir);
  expect(oversized.deliverables![0]).toMatchObject({
    accessibility: "unchecked",
    verification: "unverified",
    observation: { status: "unchecked", reason: "budget_exceeded" },
  });
});

it("keeps actual read bytes within the file budget when a file grows after its descriptor check", async () => {
  const dir = await root(),
    file = path.join(dir, "report"),
    content = "x".repeat(8 * 1024 * 1024);
  await writeFile(file, content);
  hooks.beforeRead = () => appendFile(file, "y");
  const result = await inspectTaskDeliverables(
    narrative(plan(["report"], content)),
    dir,
  );
  expect(hooks.bytesRead).toBe(8 * 1024 * 1024);
  expect(result.deliverables![0]!.observation).toMatchObject({
    status: "unchecked",
    reason: "unstable",
  });
});

it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "marks unreadable bytes unchecked",
  async () => {
    const dir = await root(),
      file = path.join(dir, "report");
    await writeFile(file, "");
    await chmod(file, 0);
    try {
      expect(
        (await inspectTaskDeliverables(narrative(plan(["report"])), dir))
          .deliverables![0]!.observation,
      ).toMatchObject({ status: "unchecked", reason: "unreadable" });
    } finally {
      await chmod(file, 0o600);
    }
  },
);

it("rejects a real same-size write during observation even when mtime is restored", async () => {
  const dir = await root(),
    file = path.join(dir, "report");
  await writeFile(file, "before");
  const before = await stat(file);
  hooks.afterRead = async () => {
    await writeFile(file, "after!");
    await utimes(file, before.atime, before.mtime);
  };
  const result = await inspectTaskDeliverables(
    narrative(plan(["report"], "before")),
    dir,
  );
  expect(result.deliverables![0]!.observation).toMatchObject({
    status: "unchecked",
    reason: "unstable",
  });
  expect(result.deliverables![0]!.observation?.sha256).toBeUndefined();
});

it("does not revive an older verified artifact when the latest declaration is unavailable", async () => {
  const dir = await root(),
    older = plan(["report"], "old"),
    newer = structuredClone(older);
  newer.id = "plan_new";
  newer.artifacts[0]!.id = "new";
  newer.artifacts[0]!.status = "missing";
  newer.artifacts[0]!.updatedAt = "2026-01-03";
  const n = {
    ...narrative(older),
    deliverables: projectTaskDeliverables([older, newer]),
  };
  const result = await inspectTaskDeliverables(n, dir);
  expect(result.deliverables).toHaveLength(1);
  expect(result.deliverables![0]).toMatchObject({
    planId: "plan_new",
    artifact: { id: "new" },
    observation: { status: "missing" },
    previousVersions: [expect.objectContaining({ planId: "plan_test" })],
  });
});
