import { spawn, spawnSync } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { sha256 } from "./windows-host-product-acceptance-artifact.mjs";

export const WINDOWS_SBOM_PATH =
  "docs/artifacts/sandbox-image-sbom-0.1.0.cdx.json";
export const WINDOWS_PROVENANCE_PATH =
  "docs/artifacts/sandbox-image-provenance-0.1.0.json";
export const WINDOWS_BUILD_ROOTS = [
  "apps/cli/dist",
  "apps/server/dist",
  "apps/web/dist",
  "packages/contracts/dist",
  "packages/runtime/dist",
  "packages/sdk/dist",
];
export const WINDOWS_DEPENDENCY_ROOTS = [
  "node_modules",
  "apps/cli/node_modules",
  "apps/server/node_modules",
  "apps/web/node_modules",
  "packages/contracts/node_modules",
  "packages/runtime/node_modules",
  "packages/sdk/node_modules",
];

const COMMAND_TIMEOUT_MS = 15 * 60 * 1_000;
const MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024;
const MAX_SYNC_OUTPUT_BYTES = 4 * 1024 * 1024;

export async function withWindowsAcceptanceEnvironment(run) {
  const runnerTemp = process.env["RUNNER_TEMP"];
  if (!runnerTemp || !path.isAbsolute(runnerTemp)) {
    throw new Error("Windows runner temporary root is unavailable");
  }
  const original = { ...process.env };
  const root = await mkdtemp(
    path.join(runnerTemp, "napier-windows-host-environment-"),
  );
  try {
    const environment = await createWindowsAcceptanceEnvironment(
      original,
      root,
    );
    replaceProcessEnvironment(environment);
    return await run();
  } finally {
    replaceProcessEnvironment(original);
    await rm(root, { recursive: true, force: true });
  }
}

export async function runWindowsAcceptanceCli(input) {
  let options;
  try {
    options = parseWindowsAcceptanceOptions(input.args, input.repoRoot);
    const receipt = await input.run({
      repoRoot: input.repoRoot,
      sourceSha: options.sourceSha,
    });
    await writeFile(
      options.outputPath,
      `${JSON.stringify(receipt, null, 2)}\n`,
      {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      },
    );
    input.stdout.write(
      `Windows host product acceptance passed: ${receipt.sourceSha.slice(0, 12)}\n`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    input.stderr.write(
      `Windows host product acceptance failed: ${sha256(message).slice(0, 16)}\n`,
    );
    process.exitCode = 1;
  }
}

function parseWindowsAcceptanceOptions(args, repoRoot) {
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!["--output", "--source-sha"].includes(name) || !value) {
      throw new Error("Windows host acceptance arguments are invalid");
    }
    values[name] = value;
  }
  if (!values["--output"] || !values["--source-sha"]) {
    throw new Error(
      "Windows host acceptance output and source SHA are required",
    );
  }
  const outputPath = path.resolve(values["--output"]);
  const outputRelative = path.relative(repoRoot, outputPath);
  if (
    outputRelative === "" ||
    (!outputRelative.startsWith(`..${path.sep}`) &&
      outputRelative !== ".." &&
      !path.isAbsolute(outputRelative))
  ) {
    throw new Error(
      "Windows host receipt must be written outside the checkout",
    );
  }
  return {
    outputPath,
    sourceSha: values["--source-sha"],
  };
}

export async function createWindowsAcceptanceEnvironment(environment, root) {
  const home = path.join(root, "home");
  const temporary = path.join(root, "temp");
  const npmCache = path.join(root, "npm-cache");
  const dockerConfig = path.join(root, "docker");
  const npmUserConfig = path.join(root, "npm-user.conf");
  const npmGlobalConfig = path.join(root, "npm-global.conf");
  await Promise.all([
    mkdir(home, { recursive: true }),
    mkdir(temporary, { recursive: true }),
    mkdir(npmCache, { recursive: true }),
    mkdir(dockerConfig, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      npmUserConfig,
      "registry=https://registry.npmjs.org/\nalways-auth=false\n",
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    ),
    writeFile(npmGlobalConfig, "", {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    }),
    writeFile(path.join(dockerConfig, "config.json"), '{"auths":{}}\n', {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    }),
  ]);
  const inherited = [
    "ComSpec",
    "PATH",
    "PATHEXT",
    "SystemRoot",
    "WINDIR",
    "GITHUB_RUN_ID",
    "GITHUB_RUN_ATTEMPT",
    "RUNNER_ENVIRONMENT",
    "RUNNER_OS",
    "RUNNER_ARCH",
    "RUNNER_TEMP",
    "NAPIER_CONTAINER_WINDOWS_WSL_MOUNTS",
    "NAPIER_CONTAINER_SANDBOX_SCRATCH_DIR",
  ];
  return {
    ...Object.fromEntries(
      inherited.flatMap((name) =>
        environment[name] === undefined ? [] : [[name, environment[name]]],
      ),
    ),
    CI: "true",
    HOME: home,
    USERPROFILE: home,
    TEMP: temporary,
    TMP: temporary,
    DOCKER_CONFIG: dockerConfig,
    DOCKER_HOST: environment.DOCKER_HOST ?? "npipe:////./pipe/docker_engine",
    NPM_CONFIG_USERCONFIG: npmUserConfig,
    NPM_CONFIG_GLOBALCONFIG: npmGlobalConfig,
    NPM_CONFIG_CACHE: npmCache,
    NPM_CONFIG_REGISTRY: "https://registry.npmjs.org/",
    NPM_CONFIG_AUDIT: "false",
    NPM_CONFIG_FUND: "false",
  };
}

function replaceProcessEnvironment(environment) {
  for (const name of Object.keys(process.env)) delete process.env[name];
  Object.assign(process.env, environment);
}

export async function runWindowsAcceptanceCommand(
  command,
  args,
  cwd,
  maxOutputBytes = MAX_COMMAND_OUTPUT_BYTES,
) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const chunks = [];
    let bytes = 0;
    let limited = false;
    const observe = (chunk) => {
      bytes += chunk.byteLength;
      if (bytes > maxOutputBytes) {
        limited = true;
        killWindowsAcceptanceProcess(child);
        return;
      }
      chunks.push(chunk);
    };
    child.stdout.on("data", observe);
    child.stderr.on("data", observe);
    const timer = setTimeout(
      () => killWindowsAcceptanceProcess(child),
      COMMAND_TIMEOUT_MS,
    );
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      const output = Buffer.concat(chunks);
      const outputSha256 = sha256(output);
      if (limited || code !== 0 || signal) {
        reject(
          new Error(
            `Windows host command failed (${outputSha256.slice(0, 16)})`,
          ),
        );
        return;
      }
      resolve({
        status: "passed",
        exitCode: code,
        outputBytes: bytes,
        outputSha256,
        durationMs: Math.max(0, Date.now() - startedAt),
      });
    });
  });
}

export function windowsProcessTreeKillCommand(
  pid,
  platform = process.platform,
) {
  return platform === "win32"
    ? { command: "taskkill.exe", args: ["/PID", String(pid), "/T", "/F"] }
    : undefined;
}

function killWindowsAcceptanceProcess(child) {
  const tree = windowsProcessTreeKillCommand(child.pid);
  if (!tree) {
    child.kill("SIGKILL");
    return;
  }
  spawnSync(tree.command, tree.args, {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 64 * 1024,
    timeout: 30_000,
    windowsHide: true,
  });
}

export function windowsCommandOutput(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: process.env,
    maxBuffer: MAX_SYNC_OUTPUT_BYTES,
    timeout: 30_000,
    windowsHide: true,
  });
  if (result.status !== 0 || result.signal || result.stderr !== "") {
    throw new Error("Windows host identity command failed");
  }
  return result.stdout.trim();
}

export function windowsDockerOutput(args) {
  return windowsCommandOutput("docker.exe", args);
}

export function optionalWindowsDockerOutput(args) {
  const result = spawnSync("docker.exe", args, {
    encoding: "utf8",
    env: process.env,
    maxBuffer: MAX_SYNC_OUTPUT_BYTES,
    timeout: 30_000,
    windowsHide: true,
  });
  return result.status === 0 && !result.signal ? result.stdout.trim() : "";
}

export function windowsSourceStatus(repoRoot) {
  return windowsCommandOutput(
    "git.exe",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    repoRoot,
  );
}

export function snapshotWindowsDockerResources() {
  return {
    containers: outputLines(
      windowsDockerOutput([
        "container",
        "ls",
        "--all",
        "--no-trunc",
        "--format",
        "{{.ID}}",
      ]),
    ),
    networks: outputLines(
      windowsDockerOutput([
        "network",
        "ls",
        "--no-trunc",
        "--format",
        "{{.ID}}",
      ]),
    ),
    images: outputLines(
      windowsDockerOutput([
        "image",
        "ls",
        "--all",
        "--no-trunc",
        "--format",
        "{{.ID}}",
      ]),
    ),
  };
}

export function cleanupWindowsDockerDelta(baseline, failure) {
  const current = snapshotWindowsDockerResources();
  if (
    !sameStringSet(baseline.containers, current.containers) ||
    !sameStringSet(baseline.networks, current.networks)
  ) {
    return failure ?? new Error("Windows host Docker resources leaked");
  }
  for (const imageId of current.images.filter(
    (value) => !baseline.images.includes(value),
  )) {
    try {
      optionalWindowsDockerOutput(["image", "rm", "--force", imageId]);
    } catch (error) {
      failure ??= error;
    }
  }
  return failure;
}

export async function backupWindowsImageEvidence(repoRoot) {
  const [sbom, provenance] = await Promise.all([
    readFile(path.join(repoRoot, WINDOWS_SBOM_PATH)),
    readFile(path.join(repoRoot, WINDOWS_PROVENANCE_PATH)),
  ]);
  return {
    sbom,
    provenance,
    sbomSha256: sha256(sbom),
    provenanceSha256: sha256(provenance),
  };
}

export async function restoreWindowsImageEvidence(repoRoot, backup, failure) {
  try {
    await Promise.all([
      writeFile(path.join(repoRoot, WINDOWS_SBOM_PATH), backup.sbom),
      writeFile(
        path.join(repoRoot, WINDOWS_PROVENANCE_PATH),
        backup.provenance,
      ),
    ]);
  } catch (error) {
    return failure ?? error;
  }
  return failure;
}

export async function restoreWindowsOfficialImage(
  imageReference,
  temporaryImage,
  previousImage,
  failure,
) {
  try {
    if (previousImage) {
      windowsDockerOutput(["tag", previousImage, imageReference]);
    } else {
      optionalWindowsDockerOutput(["image", "rm", "--force", imageReference]);
    }
    optionalWindowsDockerOutput(["image", "rm", "--force", temporaryImage]);
  } catch (error) {
    return failure ?? error;
  }
  return failure;
}

export async function removeWindowsWorkspaceOutput(repoRoot, failure) {
  for (const relative of [
    ...WINDOWS_DEPENDENCY_ROOTS,
    ...WINDOWS_BUILD_ROOTS,
  ]) {
    try {
      await rm(path.join(repoRoot, relative), {
        recursive: true,
        force: true,
      });
    } catch (error) {
      failure ??= error;
    }
  }
  return failure;
}

export async function windowsRootsAbsent(repoRoot, roots) {
  const found = await Promise.all(
    roots.map((relative) => pathExists(path.join(repoRoot, relative))),
  );
  return found.every((value) => value === false);
}

export function sameStringSet(left, right) {
  return left.join("\n") === right.join("\n");
}

export function windowsProbeEnvironment() {
  const names = ["PATH", "PATHEXT", "SystemRoot", "TEMP", "TMP"];
  return Object.fromEntries(
    names.flatMap((name) =>
      process.env[name] === undefined ? [] : [[name, process.env[name]]],
    ),
  );
}

function outputLines(value) {
  return [
    ...new Set(
      value
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ].sort();
}

function pathExists(filePath) {
  return lstat(filePath).then(
    () => true,
    () => false,
  );
}
