import { randomBytes } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  WINDOWS_ACCEPTANCE_IMAGE,
  WINDOWS_ACCEPTANCE_NODE_VERSION,
  WINDOWS_ACCEPTANCE_PTY_VERSION,
  canonicalJson,
  createWindowsHostProductAcceptanceReceipt,
  sha256,
  windowsHostProductAcceptanceImplementation,
} from "./windows-host-product-acceptance-artifact.mjs";
import {
  WINDOWS_BUILD_ROOTS,
  WINDOWS_DEPENDENCY_ROOTS,
  WINDOWS_PROVENANCE_PATH,
  WINDOWS_SBOM_PATH,
  backupWindowsImageEvidence,
  cleanupWindowsDockerDelta,
  optionalWindowsDockerOutput,
  removeWindowsWorkspaceOutput,
  restoreWindowsImageEvidence,
  restoreWindowsOfficialImage,
  runWindowsAcceptanceCli,
  runWindowsAcceptanceCommand,
  sameStringSet,
  snapshotWindowsDockerResources,
  withWindowsAcceptanceEnvironment,
  windowsCommandOutput,
  windowsDockerOutput,
  windowsProbeEnvironment,
  windowsRootsAbsent,
  windowsSourceStatus,
} from "./windows-host-product-acceptance-support.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(scriptPath), "..");
const MAX_DOCKER_OUTPUT_BYTES = 4 * 1024 * 1024;
const DOCKER_ENDPOINT = "tcp://127.0.0.1:2375";

export async function runWindowsHostProductAcceptance(input) {
  const receiptInput = await withWindowsAcceptanceEnvironment(() =>
    runWindowsHostProductAcceptanceIsolated(input),
  );
  return createWindowsHostProductAcceptanceReceipt({
    ...receiptInput,
    resourceClosure: {
      ...receiptInput.resourceClosure,
      temporaryEnvironmentRemoved: true,
    },
  });
}

async function runWindowsHostProductAcceptanceIsolated(input) {
  const repoRoot = path.resolve(input.repoRoot ?? defaultRepoRoot);
  const sourceSha = String(input.sourceSha ?? "");
  const startedAt = Date.now();
  const source = await inspectCleanSource(repoRoot, sourceSha);
  const npmCli = await resolveWindowsNpmCli();
  const host = inspectWindowsHost(npmCli);
  const baseline = snapshotWindowsDockerResources();
  const evidenceBackup = await backupWindowsImageEvidence(repoRoot);
  const previousOfficialImage = optionalWindowsDockerOutput([
    "image",
    "inspect",
    "--format",
    "{{.Id}}",
    WINDOWS_ACCEPTANCE_IMAGE,
  ]);
  const temporaryImage = `napier-windows-acceptance:${randomBytes(12).toString("hex")}`;
  let product;
  let image;
  let install;
  let pty;
  let build;
  let failure;
  try {
    install = await runWindowsAcceptanceCommand(
      process.execPath,
      [npmCli, "ci", "--no-audit", "--no-fund"],
      repoRoot,
    );
    pty = await verifyWindowsPty(repoRoot);
    build = await runWindowsAcceptanceCommand(
      process.execPath,
      [npmCli, "run", "build"],
      repoRoot,
    );
    image = await buildAcceptanceImage(repoRoot, temporaryImage);
    windowsDockerOutput(["tag", temporaryImage, WINDOWS_ACCEPTANCE_IMAGE]);
    await writeLocalImageEvidence(repoRoot, image);
    const { collectSandboxProductAcceptance } =
      await import("./check-sandbox-product-acceptance.mjs");
    const liveProduct = await collectSandboxProductAcceptance({ repoRoot });
    product = summarizeProductAcceptance(liveProduct);
  } catch (error) {
    failure = error;
  } finally {
    failure = await restoreWindowsOfficialImage(
      WINDOWS_ACCEPTANCE_IMAGE,
      temporaryImage,
      previousOfficialImage,
      failure,
    );
    failure = await restoreWindowsImageEvidence(
      repoRoot,
      evidenceBackup,
      failure,
    );
    failure = await removeWindowsWorkspaceOutput(repoRoot, failure);
    failure = cleanupWindowsDockerDelta(baseline, failure);
  }
  const finalResources = snapshotWindowsDockerResources();
  const cleanCheckoutRestored = windowsSourceStatus(repoRoot) === "";
  const dependenciesRemoved = await windowsRootsAbsent(
    repoRoot,
    WINDOWS_DEPENDENCY_ROOTS,
  );
  const buildOutputRemoved = await windowsRootsAbsent(
    repoRoot,
    WINDOWS_BUILD_ROOTS,
  );
  const resourceClosure = {
    productResourceBaselineRestored:
      product?.resourceClosure?.exactBaselineRestored === true,
    hostContainerBaselineRestored: sameStringSet(
      baseline.containers,
      finalResources.containers,
    ),
    hostNetworkBaselineRestored: sameStringSet(
      baseline.networks,
      finalResources.networks,
    ),
    hostImageBaselineRestored: sameStringSet(
      baseline.images,
      finalResources.images,
    ),
    officialImageTagRestored:
      optionalWindowsDockerOutput([
        "image",
        "inspect",
        "--format",
        "{{.Id}}",
        WINDOWS_ACCEPTANCE_IMAGE,
      ]) === previousOfficialImage,
    repositoryEvidenceRestored:
      evidenceBackup.sbomSha256 ===
        sha256(await readFile(path.join(repoRoot, WINDOWS_SBOM_PATH))) &&
      evidenceBackup.provenanceSha256 ===
        sha256(await readFile(path.join(repoRoot, WINDOWS_PROVENANCE_PATH))),
    cleanCheckoutRestored,
    dependenciesRemoved,
    buildOutputRemoved,
  };
  if (Object.values(resourceClosure).some((value) => value !== true)) {
    failure ??= new Error("Windows host resource closure failed");
  }
  if (failure) throw failure;
  const implementation =
    await windowsHostProductAcceptanceImplementation(repoRoot);
  return {
    workflowRunId: requiredEnvironment("GITHUB_RUN_ID"),
    workflowRunAttempt: requiredEnvironment("GITHUB_RUN_ATTEMPT"),
    sourceSha,
    implementation,
    host,
    source,
    install,
    pty,
    build,
    image,
    product,
    durationMs: Math.max(0, Date.now() - startedAt),
    resourceClosure,
  };
}

async function inspectCleanSource(repoRoot, sourceSha) {
  if (
    process.platform !== "win32" ||
    process.arch !== "x64" ||
    !/^[a-f0-9]{40}$/u.test(sourceSha)
  ) {
    throw new Error("Windows x64 host identity is required");
  }
  const gitHead = windowsCommandOutput(
    "git.exe",
    ["rev-parse", "HEAD"],
    repoRoot,
  );
  const mainTip = windowsCommandOutput(
    "git.exe",
    ["rev-parse", "refs/remotes/origin/main"],
    repoRoot,
  );
  const status = windowsSourceStatus(repoRoot);
  const tracked = windowsCommandOutput(
    "git.exe",
    ["ls-files", "--cached"],
    repoRoot,
  )
    .split("\n")
    .filter(Boolean);
  if (
    gitHead !== sourceSha ||
    mainTip !== sourceSha ||
    status !== "" ||
    !(await windowsRootsAbsent(repoRoot, ["node_modules"])) ||
    !(await windowsRootsAbsent(repoRoot, WINDOWS_BUILD_ROOTS)) ||
    tracked.length < 1_000
  ) {
    throw new Error("Windows host source checkout is not exact and clean");
  }
  return {
    cleanCheckout: true,
    gitHead,
    mainTip,
    nodeModulesAbsentBeforeInstall: true,
    distAbsentBeforeBuild: true,
    trackedFileCount: tracked.length,
    packageLockSha256: sha256(
      await readFile(path.join(repoRoot, "package-lock.json")),
    ),
  };
}

function inspectWindowsHost(npmCli) {
  const endpoint = requiredEnvironment("DOCKER_HOST").toLowerCase();
  const docker = JSON.parse(
    windowsCommandOutput("docker.exe", [
      "version",
      "--format",
      '{"os":"{{.Server.Os}}","arch":"{{.Server.Arch}}","version":"{{.Server.Version}}"}',
    ]),
  );
  const identity = {
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    runnerEnvironment: requiredEnvironment("RUNNER_ENVIRONMENT"),
    runnerOs: requiredEnvironment("RUNNER_OS"),
    runnerArch: requiredEnvironment("RUNNER_ARCH"),
    nodeVersion: process.version,
    npmVersion: windowsCommandOutput(process.execPath, [npmCli, "--version"]),
    dockerEndpointKind: "wsl2-loopback-linux-docker-engine",
    dockerEndpointSha256: sha256(endpoint),
    dockerServerOs: docker.os,
    dockerServerArch: docker.arch,
    dockerServerVersion: docker.version,
  };
  if (
    identity.runnerEnvironment !== "github-hosted" ||
    identity.runnerOs !== "Windows" ||
    identity.runnerArch !== "X64" ||
    identity.nodeVersion !== WINDOWS_ACCEPTANCE_NODE_VERSION ||
    endpoint !== DOCKER_ENDPOINT ||
    docker.os !== "linux" ||
    docker.arch !== "amd64"
  ) {
    throw new Error("Windows Docker host identity is unsupported");
  }
  return {
    ...identity,
    identitySha256: sha256(canonicalJson(identity)),
  };
}

async function resolveWindowsNpmCli() {
  const cliPath = path.resolve(
    path.dirname(process.execPath),
    "node_modules/npm/bin/npm-cli.js",
  );
  const metadata = await lstat(cliPath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("Windows npm CLI is invalid");
  }
  return cliPath;
}

async function verifyWindowsPty(repoRoot) {
  const packageRoot = path.join(
    repoRoot,
    "node_modules/@lydell/node-pty-win32-x64",
  );
  const packageJson = JSON.parse(
    await readFile(path.join(packageRoot, "package.json"), "utf8"),
  );
  const binaryRelative = "prebuilds/win32-x64/conpty.node";
  const binaryPath = path.join(packageRoot, binaryRelative);
  const metadata = await lstat(binaryPath);
  if (
    packageJson.version !== WINDOWS_ACCEPTANCE_PTY_VERSION ||
    !metadata.isFile() ||
    metadata.isSymbolicLink()
  ) {
    throw new Error("Windows ConPTY package is invalid");
  }
  const nodePty = await import("@lydell/node-pty");
  const marker = "napier_windows_host_conpty_v1";
  const result = await new Promise((resolve, reject) => {
    const terminal = nodePty.spawn(
      process.execPath,
      ["-e", `process.stdout.write(${JSON.stringify(marker)})`],
      {
        cwd: repoRoot,
        env: windowsProbeEnvironment(),
        cols: 80,
        rows: 24,
        encoding: "utf8",
      },
    );
    let output = "";
    const timer = setTimeout(() => {
      terminal.kill();
      reject(new Error("Windows ConPTY probe timed out"));
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
    throw new Error("Windows ConPTY probe failed");
  }
  return {
    package: "@lydell/node-pty-win32-x64",
    version: packageJson.version,
    binary: binaryRelative,
    nativeBinarySha256: sha256(await readFile(binaryPath)),
    probeOutputSha256: sha256(result.output),
    exitCode: result.event.exitCode,
    passed: true,
  };
}

async function buildAcceptanceImage(repoRoot, temporaryImage) {
  const { sandboxImageSourceEvidence } =
    await import("./check-sandbox-image-sbom.mjs");
  const source = await sandboxImageSourceEvidence(repoRoot);
  await runWindowsAcceptanceCommand(
    "docker.exe",
    [
      "build",
      "--quiet",
      "--pull",
      "--platform",
      "linux/amd64",
      "--file",
      path.join(repoRoot, "docker/napier-sandbox/Dockerfile"),
      "--tag",
      temporaryImage,
      "--label",
      `io.napier.sandbox.context-sha256=${source.contextSha256}`,
      path.join(repoRoot, "docker/napier-sandbox"),
    ],
    repoRoot,
    MAX_DOCKER_OUTPUT_BYTES,
  );
  const inspect = JSON.parse(
    windowsDockerOutput(["image", "inspect", temporaryImage]),
  )[0];
  if (
    !/^sha256:[a-f0-9]{64}$/u.test(inspect?.Id ?? "") ||
    inspect.Os !== "linux" ||
    inspect.Architecture !== "amd64"
  ) {
    throw new Error("Windows host Sandbox image identity is invalid");
  }
  return {
    reference: WINDOWS_ACCEPTANCE_IMAGE,
    id: inspect.Id,
    platform: "linux/amd64",
    contextSha256: source.contextSha256,
  };
}

async function writeLocalImageEvidence(repoRoot, image) {
  const { collectSandboxImageEvidence, verifySandboxImageArtifacts } =
    await import("./check-sandbox-image-sbom.mjs");
  const collected = await collectSandboxImageEvidence({
    repoRoot,
    image: WINDOWS_ACCEPTANCE_IMAGE,
    sbomPath: WINDOWS_SBOM_PATH,
  });
  if (!collected.ok) {
    throw new Error("Windows host image evidence collection failed");
  }
  await Promise.all([
    writeFile(
      path.join(repoRoot, WINDOWS_SBOM_PATH),
      `${JSON.stringify(collected.sbom, null, 2)}\n`,
    ),
    writeFile(
      path.join(repoRoot, WINDOWS_PROVENANCE_PATH),
      `${JSON.stringify(collected.receipt, null, 2)}\n`,
    ),
  ]);
  const verification = await verifySandboxImageArtifacts({
    repoRoot,
    image: WINDOWS_ACCEPTANCE_IMAGE,
    live: true,
  });
  if (!verification.valid) {
    throw new Error("Windows host image evidence verification failed");
  }
  image.sbomSha256 = verification.sbomSha256;
  image.provenanceSha256 = verification.receiptSha256;
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
    uninstall: value.uninstall,
    resourceClosure: value.resourceClosure,
    contentSha256: value.contentSha256,
  };
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value)
    throw new Error(`Required Windows runner identity is unavailable`);
  return value;
}

if (path.resolve(process.argv[1] ?? "") === scriptPath) {
  await runWindowsAcceptanceCli({
    args: process.argv.slice(2),
    repoRoot: defaultRepoRoot,
    run: runWindowsHostProductAcceptance,
    stdout: process.stdout,
    stderr: process.stderr,
  });
}
