import { execFile, spawn } from "node:child_process";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { commitWorkspaceChanges } from "../src/workspace-change-commit.js";
import { trackWorktreeReads } from "../src/subagent-worktree-read-set.js";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import {
  createSubagentWorktree,
  finalizeSubagentWorktree,
} from "../src/subagent-worktree-files.js";
import {
  SUBAGENT_CANDIDATE_RETENTION_MS,
  SUBAGENT_CANDIDATE_APPLY_TTL_MS,
} from "../src/subagent-candidate-store.js";
import {
  deliveryManager,
  digest,
  patchCandidate,
} from "./subagent-worktree-delivery-fixture.js";

const run = promisify(execFile);
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function harness() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-candidate-delivery-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace"),
    dataRoot = path.join(root, "data");
  await Promise.all([mkdir(workspaceRoot), mkdir(dataRoot)]);
  await Promise.all([
    writeFile(path.join(workspaceRoot, "a.ts"), "export const a = 1;\n"),
    writeFile(path.join(workspaceRoot, "b.ts"), "export const b = 1;\n"),
    writeFile(path.join(workspaceRoot, "README.md"), "before\n"),
  ]);
  return { root, workspaceRoot, dataRoot };
}

async function candidate(
  h: Awaited<ReturnType<typeof harness>>,
  value = "export const a = 2;\n",
) {
  const manager = deliveryManager(h);
  const session = await manager.createWorktree("task_candidate123", ["a.ts"]);
  await patchCandidate(
    manager,
    session,
    "a.ts",
    "export const a = 1;\n",
    value,
  );
  return {
    manager,
    session,
    preview: await manager.storePreview(session, digest("outcome")),
  };
}

async function child(
  h: Awaited<ReturnType<typeof harness>>,
  previewId: string,
  mode: string,
  suffix = mode,
) {
  const config = path.join(h.root, `${suffix}.json`),
    output = path.join(h.root, `${suffix}-result.json`);
  await writeFile(config, JSON.stringify({ ...h, previewId, mode, output }));
  const entry = fileURLToPath(
    new URL("./subagent-worktree-delivery-child.ts", import.meta.url),
  );
  const process = spawn(
    globalThis.process.execPath,
    ["--import", "tsx", entry, config],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let stderr = "";
  process.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const ended = await new Promise<{
    code: number | null;
    signal: string | null;
  }>((resolve, reject) => {
    process.on("error", reject);
    process.on("exit", (code, signal) => resolve({ code, signal }));
  });
  if (ended.code !== 0 && ended.signal !== "SIGKILL") throw new Error(stderr);
  return { ...ended, output };
}

describe("retained coder delivery", () => {
  it("delivers two disjoint coders from dirty Git bytes while preserving unrelated changes", async () => {
    const h = await harness();
    await run("git", ["init", "-q", h.workspaceRoot]);
    await run("git", ["-C", h.workspaceRoot, "add", "."]);
    await run("git", [
      "-C",
      h.workspaceRoot,
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-qm",
      "baseline",
    ]);
    const dirtyA = "export const a = 11; // user dirty\n",
      dirtyB = "export const b = 12; // user dirty\n";
    await Promise.all([
      writeFile(path.join(h.workspaceRoot, "a.ts"), dirtyA),
      writeFile(path.join(h.workspaceRoot, "b.ts"), dirtyB),
      writeFile(path.join(h.workspaceRoot, "untracked.txt"), "user content\n"),
    ]);
    const indexBefore = await readFile(
      path.join(h.workspaceRoot, ".git/index"),
    );
    const manager = deliveryManager(h);
    const [left, right] = await Promise.all([
      manager.createWorktree("task_leftdelivery", ["a.ts"]),
      manager.createWorktree("task_rightdelivery", ["b.ts"]),
    ]);
    for (const [session, file] of [
      [left, "a.ts"],
      [right, "b.ts"],
    ] as const) {
      await manager
        .createCoderTools(session)
        .find((tool) => tool.name === "read_file")!
        .execute("read", { path: file });
    }
    expect(await readFile(path.join(left.root, "untracked.txt"), "utf8")).toBe(
      "user content\n",
    );
    await Promise.all([
      patchCandidate(manager, left, "a.ts", dirtyA, dirtyA.replace("11", "21")),
      patchCandidate(
        manager,
        right,
        "b.ts",
        dirtyB,
        dirtyB.replace("12", "22"),
      ),
    ]);
    await writeFile(
      path.join(h.workspaceRoot, "README.md"),
      "unrelated user edit\n",
    );
    const first = await manager.storePreview(left, digest("left"));
    await manager.apply(first.id);
    const second = await manager.storePreview(right, digest("right"));
    expect((await deliveryManager(h).apply(second.id)).details.status).toBe(
      "applied",
    );
    expect(await readFile(path.join(h.workspaceRoot, "a.ts"), "utf8")).toBe(
      dirtyA.replace("11", "21"),
    );
    expect(await readFile(path.join(h.workspaceRoot, "b.ts"), "utf8")).toBe(
      dirtyB.replace("12", "22"),
    );
    expect(
      await readFile(path.join(h.workspaceRoot, "README.md"), "utf8"),
    ).toBe("unrelated user edit\n");
    expect(await readFile(path.join(h.workspaceRoot, ".git/index"))).toEqual(
      indexBefore,
    );
  });

  it("commits mixed-case paths in the transaction's canonical order", async () => {
    const h = await harness();
    const upper = "export const z = 1;\n";
    await writeFile(path.join(h.workspaceRoot, "Z.ts"), upper);
    const manager = deliveryManager(h),
      session = await manager.createWorktree("task_ordered123", [
        "a.ts",
        "Z.ts",
      ]);
    await patchCandidate(
      manager,
      session,
      "a.ts",
      "export const a = 1;\n",
      "export const a = 2;\n",
    );
    await patchCandidate(
      manager,
      session,
      "Z.ts",
      upper,
      upper.replace("1", "2"),
    );
    const preview = await manager.storePreview(session, digest("ordering"));
    expect((await manager.apply(preview.id)).details.committedFileCount).toBe(
      2,
    );
  });

  it("three-way merges disjoint lines and binds diagnostics to the new before and after hashes", async () => {
    const h = await harness();
    const base = "export const a = 1;\n\n// separator\n\nexport const z = 1;\n";
    await writeFile(path.join(h.workspaceRoot, "a.ts"), base);
    const manager = deliveryManager(h),
      session = await manager.createWorktree("task_threelines1", ["a.ts"]);
    await patchCandidate(
      manager,
      session,
      "a.ts",
      base,
      base.replace("a = 1", "a = 2"),
    );
    const preview = await manager.storePreview(session, digest("three-way"));
    await writeFile(
      path.join(h.workspaceRoot, "a.ts"),
      base.replace("z = 1", "z = 9"),
    );
    expect((await manager.apply(preview.id)).details.status).toBe("applied");
    expect(await readFile(path.join(h.workspaceRoot, "a.ts"), "utf8")).toBe(
      base.replace("a = 1", "a = 2").replace("z = 1", "z = 9"),
    );
  });

  it("retains overlapping candidates across restart and permits retry after conflict resolution", async () => {
    const h = await harness(),
      { preview } = await candidate(h);
    await writeFile(
      path.join(h.workspaceRoot, "a.ts"),
      "export const a = 3;\n",
    );
    await expect(deliveryManager(h).apply(preview.id)).rejects.toThrow(
      "overlapping edits",
    );
    expect(
      (await deliveryManager(h).inspectPreview(preview.id)).source.changes[0]
        ?.afterText,
    ).toContain("a = 2");
    await writeFile(
      path.join(h.workspaceRoot, "a.ts"),
      "export const a = 1;\n",
    );
    expect((await deliveryManager(h).apply(preview.id)).details.status).toBe(
      "applied",
    );
  });

  it.each(["read_file", "search_files", "list_symbols"])(
    "refuses changed dependencies recorded by %s",
    async (toolName) => {
      const h = await harness(),
        manager = deliveryManager(h),
        session = await manager.createWorktree("task_dependency1", ["a.ts"]);
      const tool = manager
        .createCoderTools(session)
        .find((tool) => tool.name === toolName)!;
      await tool.execute(
        "read-dependency",
        toolName === "read_file" ? { path: "b.ts" } : { path: ".", query: "b" },
      );
      await patchCandidate(
        manager,
        session,
        "a.ts",
        "export const a = 1;\n",
        "export const a = 2;\n",
      );
      const preview = await manager.storePreview(session, digest("dependency"));
      await writeFile(
        path.join(h.workspaceRoot, "b.ts"),
        "export const b = 99;\n",
      );
      await expect(manager.apply(preview.id)).rejects.toThrow(
        "read dependency changed",
      );
      expect((await manager.inspectPreview(preview.id)).state).toBeUndefined();
    },
  );

  it("tracks missing-file reads and directory names without treating listed file contents as reads", async () => {
    const h = await harness(),
      manager = deliveryManager(h),
      session = await manager.createWorktree("task_names12345", ["a.ts"]);
    const tools = manager.createCoderTools(session);
    await tools
      .find((tool) => tool.name === "list_files")!
      .execute("list", { path: "." });
    await expect(
      tools
        .find((tool) => tool.name === "read_file")!
        .execute("missing", { path: "missing.ts" }),
    ).rejects.toThrow();
    await patchCandidate(
      manager,
      session,
      "a.ts",
      "export const a = 1;\n",
      "export const a = 2;\n",
    );
    const preview = await manager.storePreview(session, digest("names"));
    await writeFile(
      path.join(h.workspaceRoot, "b.ts"),
      "export const b = 99;\n",
    );
    expect((await manager.apply(preview.id)).details.status).toBe("applied");
  });

  it.each(["missing-file", "directory-name", "symlink-ancestor"])(
    "rejects changed discovery evidence: %s",
    async (kind) => {
      const h = await harness(),
        manager = deliveryManager(h),
        session = await manager.createWorktree("task_discovery1", ["a.ts"]);
      const tools = manager.createCoderTools(session);
      if (kind === "directory-name")
        await tools
          .find((tool) => tool.name === "list_files")!
          .execute("list", { path: "." });
      else
        await expect(
          tools
            .find((tool) => tool.name === "read_file")!
            .execute("read", { path: "missing/b.ts" }),
        ).rejects.toThrow();
      await patchCandidate(
        manager,
        session,
        "a.ts",
        "export const a = 1;\n",
        "export const a = 2;\n",
      );
      const preview = await manager.storePreview(session, digest(kind));
      if (kind === "symlink-ancestor")
        await symlink(h.workspaceRoot, path.join(h.workspaceRoot, "missing"));
      else {
        await mkdir(path.join(h.workspaceRoot, "missing"));
        if (kind === "missing-file")
          await writeFile(
            path.join(h.workspaceRoot, "missing/b.ts"),
            "new dependency\n",
          );
      }
      await expect(manager.apply(preview.id)).rejects.toThrow(
        kind === "symlink-ancestor" ? "symlinks" : "read dependency changed",
      );
      expect(
        await readFile(path.join(h.workspaceRoot, "a.ts"), "utf8"),
      ).toContain("a = 1");
    },
  );

  it("conservatively tracks unknown tools over the complete visible source", async () => {
    const h = await harness(),
      manager = deliveryManager(h),
      session = await manager.createWorktree("task_unknown123", ["a.ts"]);
    const tools = trackWorktreeReads(
      [
        {
          name: "new_command_tool",
          label: "unknown",
          description: "fixture",
          parameters: Type.Object({}),
          async execute() {
            return {
              content: [
                {
                  type: "text" as const,
                  text: await readFile(path.join(session.root, "b.ts"), "utf8"),
                },
              ],
              details: {},
            };
          },
        },
      ],
      session,
    );
    await tools[0]!.execute("unknown", {});
    await patchCandidate(
      manager,
      session,
      "a.ts",
      "export const a = 1;\n",
      "export const a = 2;\n",
    );
    const preview = await manager.storePreview(session, digest("unknown"));
    await writeFile(path.join(h.workspaceRoot, "b.ts"), "changed dependency\n");
    await expect(manager.apply(preview.id)).rejects.toThrow(
      "read dependency changed: . (tree)",
    );
  });

  it("rechecks a read dependency after diagnostics without consuming the retained candidate", async () => {
    const h = await harness();
    const manager = deliveryManager(h, {
      lifecycleDiagnostics: {
        async observeBefore(changes) {
          await writeFile(
            path.join(h.workspaceRoot, "b.ts"),
            "dependency drift during diagnostics\n",
          );
          return {
            entries: changes.map((change) => ({ change })),
            omittedFileCount: 0,
          };
        },
        async observeAfter() {
          throw new Error("must not commit");
        },
        unavailable() {
          throw new Error("must not commit");
        },
      },
    });
    const session = await manager.createWorktree("task_depdiag123", ["a.ts"]);
    await manager
      .createCoderTools(session)
      .find((tool) => tool.name === "read_file")!
      .execute("read", { path: "b.ts" });
    await patchCandidate(
      manager,
      session,
      "a.ts",
      "export const a = 1;\n",
      "export const a = 2;\n",
    );
    const preview = await manager.storePreview(session, digest("diag"));
    await expect(manager.apply(preview.id)).rejects.toThrow(
      "read dependency changed",
    );
    expect((await manager.inspectPreview(preview.id)).state).toBeUndefined();
    expect(
      await readFile(path.join(h.workspaceRoot, "a.ts"), "utf8"),
    ).toContain("a = 1");
  });

  it("handles non-Git copy fallback and detects baseline tampering and chmod", async () => {
    const h = await harness();
    await mkdir(path.join(h.workspaceRoot, "empty"));
    const session = await createSubagentWorktree({
      ...h,
      ownerId: "worker_fallback",
      taskId: "task_fallback123",
      writePaths: ["a.ts"],
      forceCopy: true,
    });
    expect(session.copyReceipt).toEqual({ copiedFiles: 3, clonedFiles: 0 });
    expect((await stat(path.join(session.root, "empty"))).isDirectory()).toBe(
      true,
    );
    await chmod(path.join(session.root, "b.ts"), 0o755);
    await expect(finalizeSubagentWorktree(session)).rejects.toThrow(
      "changed a file mode",
    );
    await writeFile(`${session.root}.baseline.json`, "{}");
    await expect(finalizeSubagentWorktree(session)).rejects.toThrow(
      "baseline binding changed",
    );
  });

  it("probes unsupported reflinks once per source/destination filesystem pair", async () => {
    const h = await harness();
    const session = await createSubagentWorktree({
      ...h,
      ownerId: "worker_probe_once",
      taskId: "task_probeonce1",
      writePaths: ["a.ts"],
    });
    expect(
      session.copyReceipt.clonedFiles + session.copyReceipt.copiedFiles,
    ).toBe(3);
    if (session.copyReceipt.cloneFallbackCode) {
      expect(session.copyReceipt.cloneAttempts).toBe(1);
      expect(session.copyReceipt.copiedFiles).toBe(3);
    } else {
      expect(session.copyReceipt.clonedFiles).toBe(3);
    }
  });

  it("rejects candidate copying into another workspace or data root and tampered content", async () => {
    const h = await harness(),
      { preview } = await candidate(h);
    const other = await harness();
    await cp(
      path.join(h.dataRoot, "subagent-candidates"),
      path.join(other.dataRoot, "subagent-candidates"),
      { recursive: true },
    );
    await expect(deliveryManager(other).apply(preview.id)).rejects.toThrow(
      "workspace binding changed",
    );
    const file = path.join(
      h.dataRoot,
      "subagent-candidates",
      `${preview.id.slice("subworkpreview_".length)}.json`,
    );
    await writeFile(
      file,
      (await readFile(file, "utf8")).replace("a = 2", "a = 9"),
    );
    await expect(deliveryManager(h).apply(preview.id)).rejects.toThrow(
      "path binding is invalid",
    );
  });

  it("retains expired results for inspection and reclaims them only after the retention window", async () => {
    const h = await harness(),
      { preview } = await candidate(h);
    const later = Date.now() + SUBAGENT_CANDIDATE_APPLY_TTL_MS + 1000;
    const manager = deliveryManager(h, { now: () => new Date(later) });
    await expect(manager.apply(preview.id)).rejects.toThrow("expired");
    expect(await manager.prunePreviews([preview.id])).toBe(0);
    expect((await manager.inspectPreview(preview.id)).source.taskId).toBe(
      "task_candidate123",
    );
    expect(
      await deliveryManager(h, {
        now: () => new Date(later + SUBAGENT_CANDIDATE_RETENTION_MS),
      }).prunePreviews([preview.id]),
    ).toBe(1);
    await expect(manager.inspectPreview(preview.id)).rejects.toThrow(
      "preview not found",
    );
  });

  it.each(["before_commit", "after_commit"])(
    "does not replay after independent process SIGKILL at %s",
    async (mode) => {
      const h = await harness(),
        { preview } = await candidate(h);
      expect((await child(h, preview.id, mode)).signal).toBe("SIGKILL");
      const target = path.join(h.workspaceRoot, "a.ts"),
        before = await stat(target);
      await expect(deliveryManager(h).apply(preview.id)).rejects.toThrow(
        "requires reconciliation",
      );
      expect(
        (await deliveryManager(h).inspectPreview(preview.id)).state?.status,
      ).toBe("applying");
      expect(await readFile(target, "utf8")).toContain(
        mode === "after_commit" ? "a = 2" : "a = 1",
      );
      const after = await stat(target);
      expect([after.ino, after.mtimeMs]).toEqual([before.ino, before.mtimeMs]);
      expect(
        await deliveryManager(h, {
          now: () =>
            new Date(Date.now() + SUBAGENT_CANDIDATE_RETENTION_MS + 1000),
        }).prunePreviews([preview.id]),
      ).toBe(0);
    },
  );

  it("uses the same apply lock through data-root path aliases", async () => {
    const h = await harness(),
      { preview } = await candidate(h);
    const alias = path.join(h.root, "data-alias");
    await symlink(h.dataRoot, alias);
    let commits = 0;
    const commitChanges: typeof commitWorkspaceChanges = async (options) => {
      commits += 1;
      await new Promise((resolve) => setTimeout(resolve, 30));
      return commitWorkspaceChanges(options);
    };
    const outcomes = await Promise.allSettled([
      deliveryManager(h, { commitChanges }).apply(preview.id),
      deliveryManager({ ...h, dataRoot: alias }, { commitChanges }).apply(
        preview.id,
      ),
    ]);
    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);
    expect(commits).toBe(1);
    expect(
      (await deliveryManager(h).inspectPreview(preview.id)).state?.status,
    ).toBe("settled");
  });

  it("serializes independent processes and returns a persisted receipt after a lost response", async () => {
    const h = await harness(),
      { preview } = await candidate(h);
    const results = await Promise.all([
      child(h, preview.id, "normal", "left"),
      child(h, preview.id, "normal", "right"),
    ]);
    const responses = await Promise.all(
      results.map(async (result) =>
        JSON.parse(await readFile(result.output, "utf8")),
      ),
    );
    expect(
      responses.some(
        (response) => response.result?.details.status === "applied",
      ),
    ).toBe(true);
    expect(
      (await readFile(path.join(h.dataRoot, "commits.log"), "utf8"))
        .trim()
        .split("\n"),
    ).toHaveLength(1);
    const target = path.join(h.workspaceRoot, "a.ts"),
      before = await stat(target);
    expect((await deliveryManager(h).apply(preview.id)).summary).toContain(
      "Stored merge receipt reused",
    );
    const after = await stat(target);
    expect([after.ino, after.mtimeMs]).toEqual([before.ino, before.mtimeMs]);
  });
});
