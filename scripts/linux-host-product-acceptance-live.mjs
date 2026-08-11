import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { canonicalJson, sha256 } from "../packages/runtime/dist/index.js";

const NODE_VERSION = "v24.16.0";
const COMMAND_TIMEOUT_MS = 20 * 60 * 1_000;
const MAX_OUTPUT_BYTES = 256 * 1024;
const STAGE19_ARTIFACT =
  "docs/artifacts/linux-host-product-acceptance-stage19.json";
const STAGE19_SOURCE_FILES = [
  "packages/runtime/src/project-skill-snapshot-acquisition.ts",
  "packages/runtime/src/project-skill-snapshot-anchor.ts",
  "packages/runtime/src/project-skill-snapshot-memory.ts",
  "packages/runtime/src/project-skill-snapshot-model.ts",
  "scripts/check-linux-host-product-acceptance.mjs",
  "scripts/check-linux-host-product-acceptance.test.mjs",
  "scripts/linux-host-product-acceptance-artifact.mjs",
  "scripts/linux-host-product-acceptance-guest.mjs",
  "scripts/linux-host-product-acceptance-live.mjs",
];

export async function runLinuxHostProductAcceptance(input) {
  const sourcePaths = await sourceSnapshotPaths(input.repoRoot);
  const temporaryRoot = await mkdtemp(
    path.join(input.repoRoot, ".napier-linux-host-"),
  );
  const archivePath = path.join(temporaryRoot, "source.tar");
  let result;
  let failure;
  try {
    await writeSourceArchive(input.repoRoot, sourcePaths, archivePath);
    const sourceArchiveSha256 = sha256(await readFile(archivePath));
    const runName = `napier-linux-host-${randomBytes(8).toString("hex")}`;
    const command = linuxGuestCommand({
      archivePath,
      runName,
      nodeVersion: NODE_VERSION,
    });
    const execution = await runBounded("colima", [
      "ssh",
      "--",
      "bash",
      "-lc",
      command,
    ]);
    await runBounded("colima", [
      "ssh",
      "--",
      "bash",
      "-lc",
      `test ! -e /tmp/${runName}`,
    ]);
    let guest;
    try {
      guest = JSON.parse(execution.stdout);
    } catch {
      throw new Error("Linux host acceptance returned invalid JSON");
    }
    result = {
      backend: "colima",
      hostType: "linux-vm",
      nodeBootstrapVersion: NODE_VERSION,
      sourceArchiveSha256,
      sourceFileCount: sourcePaths.length,
      guest,
      orchestration: {
        status: "passed",
        exitCode: execution.exitCode,
        stdoutSha256: sha256(execution.stdout),
        stdoutBytes: Buffer.byteLength(execution.stdout, "utf8"),
        stderrSha256: sha256(execution.stderr),
        stderrBytes: Buffer.byteLength(execution.stderr, "utf8"),
        durationMs: execution.durationMs,
      },
    };
  } catch (error) {
    failure = error;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true }).catch((error) => {
      failure ??= error;
    });
  }
  const temporaryRootRemoved = await lstat(temporaryRoot).then(
    () => false,
    () => true,
  );
  if (!temporaryRootRemoved) {
    failure ??= new Error("Linux host acceptance source archive was retained");
  }
  if (failure) throw failure;
  return {
    ...result,
    resourceClosure: {
      hostArchiveRemoved: true,
      guestTemporaryRootRemoved: true,
      productResourceBaselineRestored:
        result.guest.product.resourceClosure.exactBaselineRestored === true,
    },
  };
}

async function sourceSnapshotPaths(repoRoot) {
  const output = await runBounded("git", ["ls-files", "--cached", "-z"], {
    cwd: repoRoot,
    binary: true,
    maxOutputBytes: 4 * 1024 * 1024,
  });
  const paths = [
    ...new Set([
      ...output.stdout.split("\0").filter(Boolean),
      ...STAGE19_SOURCE_FILES,
    ]),
  ]
    .filter(
      (candidate) => candidate !== "goal.md" && candidate !== STAGE19_ARTIFACT,
    )
    .sort();
  if (
    paths.length === 0 ||
    paths.some(
      (candidate) =>
        candidate.includes("\n") ||
        path.isAbsolute(candidate) ||
        candidate === ".." ||
        candidate.startsWith(`..${path.sep}`),
    )
  ) {
    throw new Error("Linux host source snapshot path is invalid");
  }
  for (const candidate of paths) {
    const metadata = await lstat(path.join(repoRoot, candidate));
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error("Linux host source snapshot must contain regular files");
    }
  }
  return paths;
}

async function writeSourceArchive(repoRoot, paths, archivePath) {
  const child = spawn(
    "tar",
    ["-cf", archivePath, "-C", repoRoot, "--null", "-T", "-"],
    {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  const stdout = [];
  const stderr = [];
  let outputBytes = 0;
  const observe = (target) => (chunk) => {
    outputBytes += chunk.byteLength;
    if (outputBytes > MAX_OUTPUT_BYTES) {
      child.kill("SIGKILL");
      return;
    }
    target.push(chunk);
  };
  child.stdout.on("data", observe(stdout));
  child.stderr.on("data", observe(stderr));
  child.stdin.end(Buffer.from(`${paths.join("\0")}\0`));
  const outcome = await waitForChild(child, COMMAND_TIMEOUT_MS);
  if (
    outcome.code !== 0 ||
    outcome.signal ||
    outputBytes > MAX_OUTPUT_BYTES ||
    Buffer.concat(stdout).length !== 0 ||
    Buffer.concat(stderr).length !== 0
  ) {
    throw new Error("Linux host source archive failed");
  }
}

function linuxGuestCommand(input) {
  const archive = shellQuote(input.archivePath);
  const runName = shellQuote(input.runName);
  const nodeVersion = shellQuote(input.nodeVersion);
  return [
    "set -euo pipefail",
    `run_root=/tmp/${runName}`,
    'cleanup(){ rm -rf "$run_root"; }',
    "trap cleanup EXIT",
    'rm -rf "$run_root"',
    'mkdir -p "$run_root/source" "$run_root/node" "$run_root/home/.docker" "$run_root/home/.config"',
    'export HOME="$run_root/home"',
    'export XDG_CONFIG_HOME="$run_root/home/.config"',
    'export DOCKER_CONFIG="$run_root/home/.docker"',
    'export NPM_CONFIG_USERCONFIG="$run_root/home/.npmrc"',
    "unset SSH_AUTH_SOCK GH_TOKEN GITHUB_TOKEN NPM_TOKEN NODE_AUTH_TOKEN",
    `tar -xf ${archive} -C "$run_root/source"`,
    'case "$(uname -m)" in',
    "  aarch64) node_arch=arm64 ;;",
    "  x86_64) node_arch=x64 ;;",
    "  *) exit 21 ;;",
    "esac",
    `node_version=${nodeVersion}`,
    'node_file="node-${node_version}-linux-${node_arch}.tar.gz"',
    'node_base="https://nodejs.org/dist/${node_version}"',
    'curl --fail --silent --show-error --location "${node_base}/${node_file}" -o "$run_root/${node_file}"',
    'curl --fail --silent --show-error --location "${node_base}/SHASUMS256.txt" -o "$run_root/SHASUMS256.txt"',
    'grep "  ${node_file}$" "$run_root/SHASUMS256.txt" > "$run_root/node.sha256"',
    '(cd "$run_root" && sha256sum --check node.sha256 >/dev/null)',
    'tar -xzf "$run_root/${node_file}" --strip-components=1 -C "$run_root/node"',
    'export PATH="$run_root/node/bin:$PATH"',
    'cd "$run_root/source"',
    "node scripts/linux-host-product-acceptance-guest.mjs",
  ].join("\n");
}

async function runBounded(command, args, options = {}) {
  const startedAt = Date.now();
  const maxOutputBytes = options.maxOutputBytes ?? MAX_OUTPUT_BYTES;
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const stdout = [];
  const stderr = [];
  let outputBytes = 0;
  let limited = false;
  const observe = (target) => (chunk) => {
    outputBytes += chunk.byteLength;
    if (outputBytes > maxOutputBytes) {
      limited = true;
      child.kill("SIGKILL");
      return;
    }
    target.push(chunk);
  };
  child.stdout.on("data", observe(stdout));
  child.stderr.on("data", observe(stderr));
  const outcome = await waitForChild(child, COMMAND_TIMEOUT_MS);
  const stdoutBuffer = Buffer.concat(stdout);
  const stderrBuffer = Buffer.concat(stderr);
  if (limited || outcome.code !== 0 || outcome.signal) {
    const diagnostic = sha256(
      Buffer.concat([stdoutBuffer, stderrBuffer]),
    ).slice(0, 16);
    throw new Error(`Linux host acceptance failed (${diagnostic})`);
  }
  return {
    exitCode: outcome.code,
    stdout: options.binary
      ? stdoutBuffer.toString("utf8")
      : stdoutBuffer.toString("utf8").trim(),
    stderr: stderrBuffer.toString("utf8"),
    durationMs: Math.max(0, Date.now() - startedAt),
  };
}

function waitForChild(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

function shellQuote(value) {
  if (!/^[A-Za-z0-9_./-]+$/u.test(value)) {
    throw new Error("Linux host command path is invalid");
  }
  return value;
}
