import { execFile } from "node:child_process";
import { lstat, mkdir, readFile, readdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  canonicalJson,
  sha256,
  sha256File,
} from "../packages/runtime/dist/index.js";

const execFileAsync = promisify(execFile);
const MAX_RUNTIME_FILES = 1_024;
const MAX_RUNTIME_BYTES = 512 * 1024 * 1024;

export async function createOpenWebComparisonBrowserRuntime(input) {
  const sourceExecutable = await resolveHeadlessShell(input.sourceExecutable);
  const sourceRoot = path.dirname(sourceExecutable);
  const runtimeRoot = path.join(
    input.temporaryRoot,
    "omp-browser-runtime-image",
  );
  await mkdir(runtimeRoot, { recursive: false, mode: 0o700 });
  await execFileAsync("/bin/cp", ["-cR", `${sourceRoot}/.`, runtimeRoot], {
    timeout: 120_000,
    maxBuffer: 64 * 1024,
  });
  const canonicalRuntimeRoot = await realpath(runtimeRoot);
  const executablePath = path.join(
    canonicalRuntimeRoot,
    "chrome-headless-shell",
  );
  const [sourceSha256, executableSha256, manifest] = await Promise.all([
    sha256File(sourceExecutable),
    sha256File(executablePath),
    runtimeManifest(runtimeRoot),
  ]);
  if (sourceSha256 !== executableSha256) {
    throw new Error("Comparison Browser runtime executable binding failed");
  }
  return {
    root: canonicalRuntimeRoot,
    executablePath,
    executableSha256,
    runtimeSetSha256: sha256(canonicalJson(manifest.entries)),
    fileCount: manifest.fileCount,
    totalBytes: manifest.totalBytes,
  };
}

export async function assertOpenWebComparisonBrowserRuntimeCurrent(runtime) {
  const canonicalRoot = await realpath(runtime.root);
  const canonicalExecutable = await realpath(runtime.executablePath);
  if (
    canonicalRoot !== runtime.root ||
    canonicalExecutable !== runtime.executablePath ||
    path.dirname(canonicalExecutable) !== canonicalRoot
  ) {
    throw new Error("Comparison Browser runtime changed");
  }
  const [executableSha256, manifest] = await Promise.all([
    sha256File(canonicalExecutable),
    runtimeManifest(canonicalRoot),
  ]);
  if (
    executableSha256 !== runtime.executableSha256 ||
    manifest.fileCount !== runtime.fileCount ||
    manifest.totalBytes !== runtime.totalBytes ||
    sha256(canonicalJson(manifest.entries)) !== runtime.runtimeSetSha256
  ) {
    throw new Error("Comparison Browser runtime changed");
  }
}

async function resolveHeadlessShell(override) {
  const candidates = override
    ? [override]
    : await installedHeadlessShellCandidates();
  for (const candidate of candidates) {
    try {
      const executable = await realpath(candidate);
      const info = await lstat(executable);
      if (
        info.isFile() &&
        !info.isSymbolicLink() &&
        path.basename(executable) === "chrome-headless-shell" &&
        info.size > 0
      ) {
        return executable;
      }
    } catch {
      // Try the next isolated Browser runtime.
    }
  }
  throw new Error("Isolated comparison Browser runtime is unavailable");
}

async function installedHeadlessShellCandidates() {
  const platform =
    process.arch === "arm64"
      ? "chrome-headless-shell-mac-arm64"
      : "chrome-headless-shell-mac-x64";
  const cacheRoot = path.join(homedir(), "Library", "Caches", "ms-playwright");
  const entries = await readdir(cacheRoot, { withFileTypes: true }).catch(
    () => [],
  );
  return entries
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.isSymbolicLink() &&
        /^chromium_headless_shell-[0-9]+$/u.test(entry.name),
    )
    .sort((left, right) => revision(right.name) - revision(left.name))
    .map((entry) =>
      path.join(cacheRoot, entry.name, platform, "chrome-headless-shell"),
    );
}

async function runtimeManifest(root) {
  const entries = [];
  let totalBytes = 0;
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        const canonical = await realpath(target);
        assertWithin(root, canonical);
        if (entries.length >= MAX_RUNTIME_FILES) {
          throw new Error("Comparison Browser runtime exceeds bounds");
        }
        entries.push({
          path: path.relative(root, target),
          symlinkTarget: path.relative(root, canonical),
        });
        continue;
      }
      if (entry.isDirectory()) {
        await visit(target);
        continue;
      }
      const info = await lstat(target);
      if (!info.isFile()) continue;
      totalBytes += info.size;
      if (
        entries.length >= MAX_RUNTIME_FILES ||
        totalBytes > MAX_RUNTIME_BYTES
      ) {
        throw new Error("Comparison Browser runtime exceeds bounds");
      }
      entries.push({
        path: path.relative(root, target),
        bytes: info.size,
        sha256: sha256(await readFile(target)),
      });
    }
  };
  await visit(root);
  entries.sort((left, right) => left.path.localeCompare(right.path));
  return { entries, fileCount: entries.length, totalBytes };
}

function revision(value) {
  return Number(value.slice(value.lastIndexOf("-") + 1));
}

function assertWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (
    relative.startsWith(`..${path.sep}`) ||
    relative === ".." ||
    path.isAbsolute(relative)
  ) {
    throw new Error("Comparison Browser runtime symlink escapes its image");
  }
}
