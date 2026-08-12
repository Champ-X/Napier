import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

const SHA256 = /^[a-f0-9]{64}$/u;
const MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024;
const COMMAND_TIMEOUT_MS = 5 * 60 * 1_000;

export async function runLinuxHostGuestAcceptance(repoRoot = process.cwd()) {
  const startedAt = Date.now();
  const source = await inspectCleanSource(repoRoot);
  const install = await runBounded(
    "npm",
    ["ci", "--no-audit", "--no-fund"],
    repoRoot,
  );
  const pty = await verifyPlatformPty(repoRoot);
  const build = await runBounded("npm", ["run", "build"], repoRoot);
  const { collectSandboxProductAcceptance } =
    await import("./check-sandbox-product-acceptance.mjs");
  const product = await collectSandboxProductAcceptance({ repoRoot });
  const host = await inspectLinuxHost();
  const content = {
    host,
    source,
    install,
    pty,
    build,
    product: summarizeProductAcceptance(product),
    durationMs: Math.max(0, Date.now() - startedAt),
  };
  return {
    ...content,
    evidenceSha256: sha256(canonicalJson(content)),
  };
}

async function inspectCleanSource(repoRoot) {
  const [packageLock, entries] = await Promise.all([
    readFile(path.join(repoRoot, "package-lock.json")),
    readdir(repoRoot),
  ]);
  const forbidden = ["node_modules"];
  const distRoots = [
    "apps/cli/dist",
    "apps/server/dist",
    "apps/web/dist",
    "packages/contracts/dist",
    "packages/runtime/dist",
    "packages/sdk/dist",
  ];
  for (const name of forbidden) {
    if (entries.includes(name)) {
      throw new Error("Linux host source snapshot is not clean");
    }
  }
  for (const relative of distRoots) {
    if (await exists(path.join(repoRoot, relative))) {
      throw new Error("Linux host source snapshot contains build output");
    }
  }
  const packageJson = JSON.parse(
    await readFile(
      path.join(repoRoot, "packages/runtime/package.json"),
      "utf8",
    ),
  );
  const ptyVersion = packageJson.dependencies?.["@lydell/node-pty"];
  if (ptyVersion !== "1.2.0-beta.15") {
    throw new Error("Linux host PTY dependency is not locked");
  }
  return {
    cleanSourceSnapshot: true,
    nodeModulesAbsentBeforeInstall: true,
    distAbsentBeforeBuild: true,
    packageLockSha256: sha256(packageLock),
    ptyPackage: "@lydell/node-pty",
    ptyVersion,
  };
}

async function verifyPlatformPty(repoRoot) {
  const platformPackage = `@lydell/node-pty-${process.platform}-${process.arch}`;
  const packageRoot = path.join(
    repoRoot,
    "node_modules",
    ...platformPackage.split("/"),
  );
  const packageJson = JSON.parse(
    await readFile(path.join(packageRoot, "package.json"), "utf8"),
  );
  const binaryPath = path.join(
    packageRoot,
    "prebuilds",
    `${process.platform}-${process.arch}`,
    "pty.node",
  );
  const metadata = await lstat(binaryPath);
  if (
    process.platform !== "linux" ||
    !["arm64", "x64"].includes(process.arch) ||
    packageJson.version !== "1.2.0-beta.15" ||
    !metadata.isFile() ||
    metadata.isSymbolicLink()
  ) {
    throw new Error("Linux host PTY platform package is invalid");
  }
  const nodePty = await import("@lydell/node-pty");
  const marker = "napier_linux_host_pty_v1";
  const result = await new Promise((resolve, reject) => {
    const terminal = nodePty.spawn(
      process.execPath,
      ["-e", `process.stdout.write(${JSON.stringify(marker)})`],
      {
        cwd: repoRoot,
        env: {
          HOME: process.env["HOME"],
          PATH: process.env["PATH"],
          TERM: "xterm-256color",
        },
        cols: 80,
        rows: 24,
        encoding: "utf8",
      },
    );
    let output = "";
    const timer = setTimeout(() => {
      terminal.kill();
      reject(new Error("Linux host PTY probe timed out"));
    }, 5_000);
    terminal.onData((chunk) => {
      output += chunk;
      if (output.length > 256) terminal.kill();
    });
    terminal.onExit((event) => {
      clearTimeout(timer);
      resolve({ event, output });
    });
  });
  if (result.event.exitCode !== 0 || result.output !== marker) {
    throw new Error("Linux host PTY probe failed");
  }
  return {
    package: platformPackage,
    version: packageJson.version,
    nativeBinarySha256: sha256(await readFile(binaryPath)),
    probeOutputSha256: sha256(result.output),
    exitCode: result.event.exitCode,
    passed: true,
  };
}

async function inspectLinuxHost() {
  const [osRelease, initSystem] = await Promise.all([
    readFile("/etc/os-release", "utf8"),
    readFile("/proc/1/comm", "utf8"),
  ]);
  const virtualization = commandOutput("systemd-detect-virt", []);
  const container = commandOutput(
    "systemd-detect-virt",
    ["--container"],
    [0, 1],
  );
  const docker = JSON.parse(
    commandOutput("docker", [
      "version",
      "--format",
      '{"os":"{{.Server.Os}}","arch":"{{.Server.Arch}}","version":"{{.Server.Version}}"}',
    ]),
  );
  const release = Object.fromEntries(
    osRelease
      .split("\n")
      .map((line) => /^([A-Z_]+)=(.*)$/u.exec(line))
      .filter(Boolean)
      .map((match) => [match[1], match[2].replace(/^"(.*)"$/u, "$1")]),
  );
  if (
    process.platform !== "linux" ||
    !["arm64", "x64"].includes(process.arch) ||
    initSystem.trim() !== "systemd" ||
    virtualization === "none" ||
    container !== "none" ||
    docker.os !== "linux" ||
    !["arm64", "amd64"].includes(docker.arch)
  ) {
    throw new Error("Linux host identity is unsupported");
  }
  const identity = {
    platform: process.platform,
    arch: process.arch,
    distribution: release.ID,
    distributionVersion: release.VERSION_ID,
    initSystem: "systemd",
    virtualization,
    virtualized: true,
    containerized: false,
    nodeVersion: process.version,
    npmVersion: commandOutput("npm", ["--version"]),
    dockerServerOs: docker.os,
    dockerServerArch: docker.arch,
    dockerServerVersion: docker.version,
  };
  return {
    ...identity,
    identitySha256: sha256(canonicalJson(identity)),
  };
}

function summarizeProductAcceptance(value) {
  return {
    imagePlatform: value.image.platform,
    imageProvenanceSha256: value.image.provenanceSha256,
    setup: value.setup,
    doctor: value.doctor,
    verification: value.verification,
    service: value.service,
    restart: value.restart,
    firstUse: value.firstUse,
    invalidBindingRepair: value.invalidBindingRepair,
    imageRepair: value.imageRepair,
    uninstall: value.uninstall,
    resourceClosure: value.resourceClosure,
    contentSha256: value.contentSha256,
  };
}

function runBounded(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const hash = createHash("sha256");
    let bytes = 0;
    let limited = false;
    const observe = (chunk) => {
      bytes += chunk.byteLength;
      if (bytes > MAX_COMMAND_OUTPUT_BYTES) {
        limited = true;
        child.kill("SIGKILL");
        return;
      }
      hash.update(chunk);
    };
    child.stdout.on("data", observe);
    child.stderr.on("data", observe);
    const timer = setTimeout(() => child.kill("SIGKILL"), COMMAND_TIMEOUT_MS);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      const outputSha256 = hash.digest("hex");
      if (limited || code !== 0 || signal) {
        reject(
          new Error(`Linux host command failed (${outputSha256.slice(0, 16)})`),
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

function commandOutput(command, args, allowed = [0]) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 64 * 1024,
    timeout: 30_000,
  });
  if (!allowed.includes(result.status ?? -1) || result.stderr !== "") {
    throw new Error("Linux host identity command failed");
  }
  return result.stdout.trim();
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function exists(filePath) {
  return lstat(filePath).then(
    () => true,
    () => false,
  );
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  runLinuxHostGuestAcceptance()
    .then((value) => process.stdout.write(`${JSON.stringify(value)}\n`))
    .catch((error) => {
      const diagnostic = error instanceof Error ? error.message : String(error);
      process.stderr.write(
        `${JSON.stringify({
          status: "failed",
          diagnosticSha256: sha256(diagnostic),
        })}\n`,
      );
      process.exitCode = 1;
    });
}
