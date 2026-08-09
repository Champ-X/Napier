import { spawn } from "node:child_process";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  canonicalJson,
  createReceipt,
  FAST_CORE_FINAL_CHECK_HEAD,
  FAST_CORE_FINAL_CHECK_EXCLUSIONS,
  sha256,
  verifyFastCoreFinalCheckReceipt,
} from "./skill-load-fast-core-evidence-lib.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const MAX_OUTPUT_BYTES = 128 * 1024 * 1024;
const PROTECTED_PATHS = new Set([
  ".env",
  "goal.md",
  "docs/napier-interview-deep-dive.zh-CN.md",
]);
const excludedPaths = new Set(
  FAST_CORE_FINAL_CHECK_EXCLUSIONS.map((entry) => entry.path),
);

const options = parseArgs(process.argv.slice(2));
if (options.mode === "verify") {
  const receipt = JSON.parse(await readFile(options.path, "utf8"));
  verifyFastCoreFinalCheckReceipt(receipt);
  const currentTree = await captureTaskTree();
  if (currentTree.manifestSha256 !== receipt.taskTree.manifestSha256) {
    throw new Error("Final-check receipt does not match the current task tree");
  }
  process.stdout.write(
    `${canonicalJson({ result: "verified", receiptSha256: receipt.receiptSha256, taskTreeManifestSha256: currentTree.manifestSha256 })}\n`,
  );
  process.exit(0);
}

const exactHead = await gitText(["rev-parse", "HEAD"]);
if (exactHead !== FAST_CORE_FINAL_CHECK_HEAD) {
  throw new Error(`Final-check HEAD is not the locked baseline: ${exactHead}`);
}
const preCheckTaskTree = await captureTaskTree();
const child = await runChild("npm", ["run", "check"]);
const postCheckTaskTree = await captureTaskTree();
if (
  preCheckTaskTree.manifestSha256 !== postCheckTaskTree.manifestSha256 ||
  canonicalJson(preCheckTaskTree) !== canonicalJson(postCheckTaskTree)
) {
  throw new Error("Task tree changed while npm run check was executing");
}
if (child.code !== 0) {
  throw new Error(`npm run check failed with exit code ${String(child.code)}`);
}
const receipt = createReceipt({
  kind: "napier.skill-load-fast-core-final-check",
  schemaVersion: 1,
  command: "npm run check",
  exactHead,
  taskTree: preCheckTaskTree,
  preCheckTaskTreeManifestSha256: preCheckTaskTree.manifestSha256,
  postCheckTaskTreeManifestSha256: postCheckTaskTree.manifestSha256,
  exitCode: child.code,
  suiteCounts: parseSuiteCounts(child.stdout.toString("utf8")),
  stdoutBytes: child.stdout.byteLength,
  stdoutSha256: sha256(child.stdout),
  stderrBytes: child.stderr.byteLength,
  stderrSha256: sha256(child.stderr),
});
verifyFastCoreFinalCheckReceipt(receipt);
await mkdir(path.dirname(options.path), { recursive: true });
await writeFile(options.path, `${JSON.stringify(receipt, null, 2)}\n`);
process.stdout.write(
  `${canonicalJson({ result: "passed", receiptSha256: receipt.receiptSha256, taskTreeManifestSha256: receipt.taskTree.manifestSha256, suiteCounts: receipt.suiteCounts })}\n`,
);

async function captureTaskTree() {
  const changedPaths = await gitPaths();
  const entries = [];
  for (const targetPath of changedPaths) {
    if (PROTECTED_PATHS.has(targetPath) || excludedPaths.has(targetPath)) {
      continue;
    }
    const absolutePath = path.join(REPO_ROOT, targetPath);
    const info = await lstat(absolutePath).catch((error) => {
      if (error?.code === "ENOENT") return undefined;
      throw error;
    });
    if (!info) {
      entries.push({ path: targetPath, state: "deleted" });
      continue;
    }
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error(
        `Final-check task path is not a regular file: ${targetPath}`,
      );
    }
    const bytes = await readFile(absolutePath);
    entries.push({
      path: targetPath,
      state: "file",
      sizeBytes: bytes.byteLength,
      contentSha256: sha256(bytes),
    });
  }
  const payload = {
    algorithm: "sha256_canonical_json_v1",
    exclusions: FAST_CORE_FINAL_CHECK_EXCLUSIONS,
    entries,
  };
  return {
    ...payload,
    entryCount: entries.length,
    manifestSha256: sha256(canonicalJson(payload)),
  };
}

async function gitPaths() {
  const [changed, untracked] = await Promise.all([
    gitBytes(["diff", "--name-only", "-z", "HEAD", "--"]),
    gitBytes(["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  return [...new Set([...nulPaths(changed), ...nulPaths(untracked)])].sort();
}

function nulPaths(bytes) {
  return bytes.toString("utf8").split("\0").filter(Boolean);
}

function parseSuiteCounts(stdout) {
  const plain = stdout.replace(/\u001b\[[0-9;]*m/gu, "");
  const matches = [
    ...plain.matchAll(
      /Tests\s+(\d+) passed(?:\s+\|\s+(\d+) skipped)?\s+\(\d+\)/gu,
    ),
  ];
  if (matches.length !== 7) {
    throw new Error(
      `Final-check expected 7 Vitest suite summaries, observed ${String(matches.length)}`,
    );
  }
  const counts = matches.map((match) => ({
    passed: Number(match[1]),
    skipped: Number(match[2] ?? 0),
  }));
  return {
    rootTests: counts[0].passed,
    cliTestsPassed: counts[1].passed,
    cliTestsSkipped: counts[1].skipped,
    serverTests: counts[2].passed,
    webTests: counts[3].passed,
    contractsTests: counts[4].passed,
    runtimeTestsPassed: counts[5].passed,
    runtimeTestsSkipped: counts[5].skipped,
    sdkTests: counts[6].passed,
  };
}

function parseArgs(args) {
  if (
    args.length !== 2 ||
    (args[0] !== "--output" && args[0] !== "--verify") ||
    !args[1]
  ) {
    throw new Error(
      "Usage: run-skill-load-final-check.mjs --output|--verify PATH",
    );
  }
  return {
    mode: args[0] === "--output" ? "write" : "verify",
    path: path.resolve(args[1]),
  };
}

async function gitText(args) {
  return (await gitBytes(args)).toString("utf8").trim();
}

async function gitBytes(args) {
  const child = await runChild("git", args, false);
  if (child.code !== 0) throw new Error("Final-check git command failed");
  return child.stdout;
}

function runChild(command, args, echo = true) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: REPO_ROOT,
      env:
        command === "npm"
          ? { ...process.env, NAPIER_FINAL_CHECK_IN_PROGRESS: "1" }
          : process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    const collect = (chunks, destination) => (chunk) => {
      const bytes = Buffer.from(chunk);
      outputBytes += bytes.byteLength;
      if (outputBytes > MAX_OUTPUT_BYTES) {
        child.kill("SIGTERM");
        return;
      }
      chunks.push(bytes);
      if (echo) destination.write(bytes);
    };
    child.stdout.on("data", collect(stdout, process.stdout));
    child.stderr.on("data", collect(stderr, process.stderr));
    child.once("error", reject);
    child.once("close", (code) => {
      if (outputBytes > MAX_OUTPUT_BYTES) {
        reject(new Error("Final-check output exceeded its byte limit"));
        return;
      }
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      });
    });
  });
}
