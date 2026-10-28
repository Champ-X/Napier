import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const legacyCommit = "3ba5bda77f69fa0f6e61ad572cfa123e1c0b8479";
const digest = (value) => createHash("sha256").update(value).digest("hex");
const firstPath = "src/d000/file00000.ts";
const runtime = (name) =>
  import(pathToFileURL(path.join(repo, "packages/runtime/dist", name)));

async function worker(input) {
  const { createSubagentWorktree, removeSubagentWorktree } = await runtime(
    "subagent-worktree-files.js",
  );
  const { readWorktreeSnapshot } = await runtime(
    "subagent-worktree-snapshot.js",
  );
  const { saveWorktreeBaseline } = await runtime(
    "subagent-worktree-baseline.js",
  );
  let legacy;
  if (input.mode === "legacy") {
    const ts = (await import("typescript")).default;
    const source = await readFile(input.legacySource, "utf8");
    const compiled = ts
      .transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
      })
      .outputText.replace(
        /from "(\.\/[^"]+)"/gu,
        (_, specifier) =>
          `from "${pathToFileURL(path.join(repo, "packages/runtime/dist", specifier)).href}"`,
      );
    legacy = await import(
      `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
    );
  }
  globalThis.gc?.();
  const startRss = process.memoryUsage().rss;
  let peakRss = startRss;
  const sample = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }, 10);
  const started = performance.now();
  let session, error, gitRoot;
  try {
    if (input.mode === "git_overlay") {
      gitRoot = path.join(input.dataRoot, "git-candidate");
      await run("git", [
        "-C",
        input.workspaceRoot,
        "worktree",
        "add",
        "--detach",
        "--no-checkout",
        gitRoot,
        "HEAD",
      ]);
      await run("git", ["-C", gitRoot, "read-tree", "HEAD"]);
      const copyReceipt = { clonedFiles: 0, copiedFiles: 0 };
      const baseline = await readWorktreeSnapshot(input.workspaceRoot, {
        retainPaths: new Set([firstPath]),
        copyTo: gitRoot,
        copyReceipt,
      });
      const observed = await readWorktreeSnapshot(input.workspaceRoot);
      assert.equal(observed.contentSha256, baseline.contentSha256);
      const baselineSha256 = await saveWorktreeBaseline(gitRoot, baseline);
      session = {
        root: gitRoot,
        sourceSnapshotSha256: baseline.contentSha256,
        sourceFileCount: baseline.fileCount,
        sourceBytes: baseline.bytes,
        copyReceipt,
        baselineSha256,
      };
    } else {
      session = await (
        legacy?.createSubagentWorktree ?? createSubagentWorktree
      )({
        workspaceRoot: input.workspaceRoot,
        dataRoot: input.dataRoot,
        ownerId: `worker_bench_${process.pid}`,
        taskId: "task_benchmark123",
        writePaths: [firstPath],
        forceCopy: input.mode === "copy",
      });
    }
  } catch (caught) {
    error = caught.message;
  }
  const prepareMs = performance.now() - started;
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
  clearInterval(sample);
  const result = {
    mode: input.mode,
    fileCount: input.fileCount,
    trial: input.trial,
    prepareMs,
    startRssBytes: startRss,
    sampledPeakRssBytes: peakRss,
    sampledRssGrowthBytes: peakRss - startRss,
    processHighWaterRssBytes: process.resourceUsage().maxRSS * 1024,
    ...(error ? { status: "rejected", error } : { status: "prepared" }),
  };
  if (session) {
    assert.equal(session.sourceFileCount, input.fileCount);
    assert.equal(
      await readFile(path.join(session.root, firstPath), "utf8"),
      await readFile(path.join(input.workspaceRoot, firstPath), "utf8"),
    );
    assert.equal(
      await readFile(path.join(session.root, "untracked.txt"), "utf8"),
      "uncommitted untracked content\n",
    );
    const preparedDisk = await diskUsage(session.root);
    const copied = path.join(session.root, firstPath);
    await writeFile(copied, "candidate isolated edit\n");
    assert.match(
      await readFile(path.join(input.workspaceRoot, firstPath), "utf8"),
      /dirty user edit/u,
    );
    Object.assign(result, {
      sourceBytes: session.sourceBytes,
      sourceSnapshotSha256: session.sourceSnapshotSha256,
      copyReceipt: session.copyReceipt,
      dirtyAndUntrackedPreserved: true,
      candidateWriteIsolated: true,
      disk: preparedDisk,
      baselineDisk: await fileDisk(`${session.root}.baseline.json`),
    });
    if (gitRoot) {
      const admin = (
        await run("git", ["-C", gitRoot, "rev-parse", "--absolute-git-dir"])
      ).stdout.trim();
      result.gitAdministrativeDisk = await diskUsage(admin);
      await run("git", [
        "-C",
        input.workspaceRoot,
        "worktree",
        "remove",
        "--force",
        gitRoot,
      ]);
      await rm(`${gitRoot}.baseline.json`);
    } else await removeSubagentWorktree(session.root);
  }
  await writeFile(input.result, `${JSON.stringify(result)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
}

async function fileDisk(file) {
  const info = await lstat(file);
  return {
    logicalBytes: info.size,
    reportedAllocatedBytes: info.blocks * 512,
    files: 1,
  };
}
async function diskUsage(root) {
  const total = { logicalBytes: 0, reportedAllocatedBytes: 0, files: 0 };
  const visit = async (directory) => {
    for (const child of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, child.name);
      if (child.isDirectory()) await visit(target);
      else {
        const entry = await fileDisk(target);
        total.logicalBytes += entry.logicalBytes;
        total.reportedAllocatedBytes += entry.reportedAllocatedBytes;
        total.files += 1;
      }
    }
  };
  await visit(root);
  return total;
}

async function generate(root, count) {
  await mkdir(root);
  for (let first = 0; first < count - 1; first += 100) {
    const directory = path.join(
      root,
      "src",
      `d${String(Math.floor(first / 100)).padStart(3, "0")}`,
    );
    await mkdir(directory, { recursive: true });
    await Promise.all(
      Array.from(
        { length: Math.min(100, count - 1 - first) },
        async (_, offset) => {
          const index = first + offset;
          const header = `export const value${index} = ${index};\n`;
          const content =
            header +
            "//" +
            "x".repeat(4096 - Buffer.byteLength(header) - 3) +
            "\n";
          await writeFile(
            path.join(directory, `file${String(index).padStart(5, "0")}.ts`),
            content,
          );
        },
      ),
    );
  }
  await run("git", ["init", "-q", root]);
  await run("git", ["-C", root, "add", "."]);
  await run("git", [
    "-C",
    root,
    "-c",
    "user.name=Benchmark",
    "-c",
    "user.email=benchmark@example.invalid",
    "commit",
    "-qm",
    "synthetic source baseline",
  ]);
  await writeFile(
    path.join(root, firstPath),
    (await readFile(path.join(root, firstPath), "utf8")).replace(
      "export const",
      "// dirty user edit\nexport const",
    ),
  );
  await writeFile(
    path.join(root, "untracked.txt"),
    "uncommitted untracked content\n",
  );
}

async function main(output) {
  if (!output)
    throw new Error(
      "Usage: node scripts/benchmark-subagent-workspace.mjs OUTPUT.json [TRIALS]",
    );
  const destination = path.resolve(output),
    reservation = await open(destination, "wx", 0o600);
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "napier-workspace-scale-")),
  );
  const results = [];
  const sources = await sourceManifest();
  try {
    const legacySource = path.join(root, "legacy.ts");
    const old = (
      await run(
        "git",
        [
          "show",
          `${legacyCommit}:packages/runtime/src/subagent-worktree-files.ts`,
        ],
        { cwd: repo },
      )
    ).stdout;
    await writeFile(legacySource, old);
    const trials = Number(process.argv[3] ?? 3);
    if (!Number.isSafeInteger(trials) || trials < 1 || trials > 5)
      throw new Error("Trials must be 1-5");
    for (const count of [5_000, 20_000]) {
      const workspaceRoot = path.join(root, `source-${count}`);
      await generate(workspaceRoot, count);
      const indexHash = digest(
        await readFile(path.join(workspaceRoot, ".git/index")),
      );
      for (let trial = 0; trial < trials; trial += 1) {
        const modes =
          trial % 2 === 0
            ? ["cow", "copy", "git_overlay"]
            : ["git_overlay", "copy", "cow"];
        if (trial === 0) modes.unshift("legacy");
        for (const mode of modes) {
          const dataRoot = path.join(root, `data-${count}-${trial}-${mode}`);
          await mkdir(dataRoot);
          const result = path.join(
            root,
            `result-${count}-${trial}-${mode}.json`,
          );
          const config = path.join(
            root,
            `input-${count}-${trial}-${mode}.json`,
          );
          await writeFile(
            config,
            JSON.stringify({
              workspaceRoot,
              dataRoot,
              fileCount: count,
              trial,
              mode,
              result,
              legacySource,
            }),
          );
          await run(
            process.execPath,
            ["--expose-gc", fileURLToPath(import.meta.url), "--worker", config],
            { cwd: repo, maxBuffer: 1024 * 1024 },
          );
          const measurement = JSON.parse(await readFile(result, "utf8"));
          results.push(measurement);
          assert.equal(
            digest(await readFile(path.join(workspaceRoot, ".git/index"))),
            indexHash,
          );
          process.stdout.write(
            `${count} files ${mode} trial ${trial + 1}: ${measurement.status}, ${Math.round(measurement.prepareMs)} ms, RSS ${Math.round(measurement.sampledPeakRssBytes / 1048576)} MiB\n`,
          );
          if (mode !== "legacy") assert.equal(measurement.status, "prepared");
          else assert.match(measurement.error, /file limit exceeded/u);
        }
      }
    }
    assert.deepEqual(
      await sourceManifest(),
      sources,
      "Benchmark implementation changed during measurement",
    );
    const receipt = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      host: {
        platform: process.platform,
        arch: process.arch,
        release: os.release(),
        node: process.version,
        git: (await run("git", ["--version"])).stdout.trim(),
      },
      legacy: {
        commit: legacyCommit,
        forkSourceSha256: digest(old),
        boundary:
          "Fixed historical fork function transpiled with current helper modules; not a complete old release benchmark. Legacy RSS includes the TypeScript transpiler and is not comparable to successful new preparations.",
      },
      method: {
        syntheticFileBytes: 4096,
        trials,
        independentProcesses: true,
        gcBeforePreparation: true,
        rssSampleIntervalMs: 10,
        diskBoundary:
          "stat.blocks reports allocated blocks, including shared COW extents; this is not exclusive physical disk usage. Directory blocks omitted.",
        gitOverlay:
          "Real detached worktree with no checkout, HEAD index, same streamed dirty-content overlay and baseline verification as COW; includes Git registration and baseline capture.",
        qualityBoundary:
          "No model requests or task-quality claims. Small synthetic files and warm OS caches; repeated host measurements only.",
      },
      sources,
      measurements: results,
    };
    await reservation.writeFile(`${JSON.stringify(receipt, null, 2)}\n`);
    await reservation.sync();
  } catch (error) {
    await reservation.writeFile(
      `${JSON.stringify({ status: "failed", error: error.message, measurements: results }, null, 2)}\n`,
    );
    await reservation.sync();
    throw error;
  } finally {
    await reservation.close();
    await rm(root, { recursive: true, force: true });
  }
}

async function sourceManifest() {
  const modules = [
    "subagent-worktree-files",
    "subagent-worktree-snapshot",
    "subagent-worktree-policy",
    "subagent-worktree-baseline",
    "subagent-worktree-diff",
    "subagent-worktree-storage",
    "workspace-file-scope",
    "ed25519",
  ];
  const names = [
    "scripts/benchmark-subagent-workspace.mjs",
    ...modules.flatMap((name) => [
      `packages/runtime/src/${name}.ts`,
      `packages/runtime/dist/${name}.js`,
    ]),
  ];
  return Promise.all(
    names
      .sort()
      .map(async (file) => ({
        path: file,
        sha256: digest(await readFile(path.join(repo, file))),
      })),
  );
}

if (process.argv[2] === "--worker")
  await worker(JSON.parse(await readFile(process.argv[3], "utf8")));
else await main(process.argv[2]);
